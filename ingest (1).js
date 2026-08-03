/* =========================================================================
   INGEST.JS — Report E-commerce · Outbound
   ---------------------------------------------------------------------
   O que este script faz:
     1) Lê os arquivos brutos (TSV/XLSX) que o Admin sobe na tela de
        "Abastecimento de Dados"
     2) Cruza tudo (pedidos + itens + embalagem + acrônimos + SAP)
     3) Calcula os indicadores que definimos (status, leadtimes, OTIF,
        backlog FIFO)
     4) Sobe pro Supabase (tabelas pedidos / pedido_itens / dim_* )
     5) Gera o payload consolidado do dashboard e salva em
        dashboard_snapshots (isso é o que vira o "Histórico de Versões")

   Dependência externa (adicionar no <head> da página de Abastecimento):
     <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   ========================================================================= */

// -------------------------------------------------------------------------
// 0) CONEXÃO COM O SUPABASE — troque pelas suas chaves (Project Settings > API)
// -------------------------------------------------------------------------
const SUPABASE_URL = "https://tawliuofpmfohylqdnix.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__a5cJ6yFJIMgf505C4v7vQ_igDbuv5k";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// -------------------------------------------------------------------------
// 1) CALENDÁRIO DE DIAS ÚTEIS — Extrema-MG
//    Pontos facultativos NÃO entram aqui (vocês trabalham normalmente,
//    confirmado). Só feriados oficiais (nacional + municipal).
//    IMPORTANTE: essa lista precisa ser atualizada todo ano.
// -------------------------------------------------------------------------
const FERIADOS_2026 = new Set([
  "2026-01-01", // Confraternização Universal
  "2026-04-18", // Sexta-feira Santa
  "2026-04-21", // Tiradentes
  "2026-05-01", // Dia do Trabalho
  "2026-05-22", // Dia de Santa Rita (municipal — Extrema/MG)
  "2026-09-07", // Independência do Brasil
  "2026-09-16", // Aniversário de Extrema (municipal)
  "2026-10-12", // Nossa Senhora Aparecida
  "2026-11-02", // Finados
  "2026-11-15", // Proclamação da República
  "2026-11-20", // Consciência Negra
  "2026-12-25", // Natal
]);

function ehDiaUtil(date) {
  const dow = date.getDay(); // 0=domingo, 6=sábado
  if (dow === 0 || dow === 6) return false;
  const iso = date.toISOString().slice(0, 10);
  return !FERIADOS_2026.has(iso);
}

// Soma N dias úteis a uma data, preservando o horário
function somarDiasUteis(dataInicial, n) {
  const d = new Date(dataInicial);
  let contados = 0;
  while (contados < n) {
    d.setDate(d.getDate() + 1);
    if (ehDiaUtil(d)) contados++;
  }
  return d;
}

// Diferença em dias úteis completos entre duas datas (usado no Backlog FIFO)
function diferencaDiasUteis(dataInicial, dataFinal) {
  let contados = 0;
  const d = new Date(dataInicial);
  while (d < dataFinal) {
    d.setDate(d.getDate() + 1);
    if (ehDiaUtil(d)) contados++;
  }
  return contados;
}

// NOTA / SUPOSIÇÃO A CONFIRMAR: o prazo de "2 dias úteis" é contado
// preservando o horário de Importado em (ex: importado seg 14h -> prazo
// qua 14h). Se a regra da operação for "até o fim do 2º dia útil"
// (ex: qua 23:59), me avisa que ajusto essa função.


// -------------------------------------------------------------------------
// 2) PARSERS DE ARQUIVO
// -------------------------------------------------------------------------

// Converte "dd/mm/yyyy HH:mm:ss" (ou só "dd/mm/yyyy") em Date. Retorna null se vazio.
function parseDataBR(str) {
  if (!str || !str.trim()) return null;
  const [dataParte, horaParte] = str.trim().split(" ");
  const [dd, mm, yyyy] = dataParte.split("/").map(Number);
  if (!dd || !mm || !yyyy) return null;
  let hh = 0, mi = 0, ss = 0;
  if (horaParte) [hh, mi, ss] = horaParte.split(":").map(Number);
  return new Date(yyyy, mm - 1, dd, hh || 0, mi || 0, ss || 0);
}

// Parser de TSV enxuto: só extrai as colunas que a gente precisa,
// para não estourar memória em arquivos grandes (ex: Acompanhamento_Exp ~164MB)
function parseTSVSelecionado(texto, colunasDesejadas) {
  const linhas = texto.split("\n");
  const header = linhas[0].split("\t");
  const idx = {};
  colunasDesejadas.forEach(c => { idx[c] = header.indexOf(c); });

  const registros = [];
  for (let i = 1; i < linhas.length; i++) {
    if (!linhas[i]) continue;
    const campos = linhas[i].split("\t");
    const registro = {};
    for (const c of colunasDesejadas) {
      registro[c] = campos[idx[c]] ?? "";
    }
    registros.push(registro);
  }
  return registros;
}

// Parser de XLSX usando SheetJS (window.XLSX precisa estar carregado)
async function parseXLSX(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}


// -------------------------------------------------------------------------
// 3) CAMPOS QUE PRECISAMOS DE CADA TSV (Acompanhamento_Op / Acompanhamento_Exp)
// -------------------------------------------------------------------------
const CAMPOS_ACOMPANHAMENTO = [
  "Pedido de Venda", "Nota Fiscal", "Classificação Tipo Pedido",
  "Qtde. Total de Produto", "Status da Nota Fiscal", "Cancelado Pelo ERP",
  "Importado em", "Separado em", "Enviado para Faturamento", "Faturado em",
  "Conferido em", "Coletado em", "Processado em", "Data Esperada para Embarque",
  "Transportadora", "Cidade do Destinatário", "UF Destinatário"
];

const CAMPOS_ITENS_NF = [
  "Pedido de Venda", "Código do Produto", "Produto", "Barra",
  "Quantidade", "Qtde. Atendida", "Qtde. Faturada"
];


// -------------------------------------------------------------------------
// 4) CÁLCULO DO STATUS (funil 01-Gerar ... 06-Despachado / Cancelado)
// -------------------------------------------------------------------------
function calcularStatus(p) {
  if (p.cancelado_pelo_erp) return "Cancelado";
  if (!p.importado_em)           return "01 - Gerar";
  if (!p.separado_em)            return "02 - Em Separação";
  if (!p.faturado_em)            return "03 - Separado - Aguardando NF";
  if (!p.conferido_em)           return "04 - Separado - Conferir";
  if (!p.processado_em)          return "05 - Conferido - Despachar";
  return "06 - Despachado";
}

// -------------------------------------------------------------------------
// 5) LEADTIMES (em horas) — cada um calculado só se as duas datas existirem
// -------------------------------------------------------------------------
function horasEntre(d1, d2) {
  if (!d1 || !d2) return null;
  return (d2 - d1) / 3600000; // ms -> horas
}

function calcularLeadtimes(p) {
  return {
    sap_wms_horas: horasEntre(p.data_pedido_sap, p.importado_em),
    nf_horas:      horasEntre(p.enviado_faturamento_em, p.faturado_em),
    cd_horas:      horasEntre(p.importado_em, p.processado_em),
  };
}

// -------------------------------------------------------------------------
// 6) OTIF — On Time (prazo) + In Full (quantidade)
// -------------------------------------------------------------------------
function calcularOnTime(p) {
  if (!p.importado_em || !p.processado_em) return null; // ainda não despachado
  const prazo = somarDiasUteis(p.importado_em, 2);
  return p.processado_em <= prazo;
}

// itensDoPedido: lista de {quantidade, qtde_faturada} do pedido (Itens de NF)
function calcularInFull(itensDoPedido) {
  if (!itensDoPedido || itensDoPedido.length === 0) return null; // sem NF ainda
  return itensDoPedido.every(it => Number(it.quantidade) === Number(it.qtde_faturada));
}

// -------------------------------------------------------------------------
// 7) BACKLOG FIFO (dias úteis desde Importado em) — só pedidos ainda ABERTOS
// -------------------------------------------------------------------------
function calcularBucketFifo(importadoEm, hoje) {
  const dias = diferencaDiasUteis(importadoEm, hoje);
  if (dias <= 1) return "01";
  if (dias === 2) return "02";
  if (dias === 3) return "03";
  return "04+";
}


// -------------------------------------------------------------------------
// 8) TRANSFORMAÇÃO PRINCIPAL — Acompanhamento_Op + Exp + Pedidos_E-comm_Geral
// -------------------------------------------------------------------------
async function processarRelatoriosDaOperacao(files, options) {
  const onProgress = (options && options.onProgress) || function(){};
  const arquivoOp = files.arquivoOp;
  const arquivoExp = files.arquivoExp;
  const arquivoItensNF = files.arquivoItensNF;
  const arquivoPedidosEcomm = files.arquivoPedidosEcomm;

  onProgress("Lendo Acompanhamento_Op...");
  const textoOp = await arquivoOp.text();
  const linhasOp = parseTSVSelecionado(textoOp, CAMPOS_ACOMPANHAMENTO).map(function(r){ return Object.assign({}, r, {origem: "Acompanhamento_Op"}); });

  onProgress("Lendo Acompanhamento_Exp...");
  const textoExp = await arquivoExp.text();
  const linhasExp = parseTSVSelecionado(textoExp, CAMPOS_ACOMPANHAMENTO).map(function(r){ return Object.assign({}, r, {origem: "Acompanhamento_Exp"}); });

  onProgress("Lendo Itens de NF de Saída...");
  const textoItens = await arquivoItensNF.text();
  const linhasItens = parseTSVSelecionado(textoItens, CAMPOS_ITENS_NF);

  onProgress("Lendo Pedidos E-comm Geral...");
  const linhasSap = await parseXLSX(arquivoPedidosEcomm);

  // ---- Índice do SAP por "Pedido de Venda" (campo "Primário") ----
  const sapPorPedido = new Map();
  for (const r of linhasSap) {
    sapPorPedido.set(String(r["Primário"]), r);
  }

  // ---- Índice de itens por pedido ----
  const itensPorPedido = new Map();
  for (const r of linhasItens) {
    const chave = r["Pedido de Venda"];
    if (!itensPorPedido.has(chave)) itensPorPedido.set(chave, []);
    itensPorPedido.get(chave).push({
      codigo_produto: r["Código do Produto"],
      produto: r["Produto"],
      barra: r["Barra"],
      quantidade: r["Quantidade"],
      qtde_faturada: r["Qtde. Faturada"],
    });
  }

  const hoje = new Date();
  const pedidosProcessados = [];

  const todasLinhas = linhasOp.concat(linhasExp);
  for (const linha of todasLinhas) {
    const pedidoVenda = linha["Pedido de Venda"];
    const sap = sapPorPedido.get(String(pedidoVenda)) || {};

    const p = {
      pedido_venda: Number(pedidoVenda),
      nota_fiscal: linha["Nota Fiscal"],
      classificacao_tipo_pedido: linha["Classificação Tipo Pedido"],
      qtd_total_produto: Number(linha["Qtde. Total de Produto"]) || 0,
      status_nf: linha["Status da Nota Fiscal"],
      cancelado_pelo_erp: linha["Cancelado Pelo ERP"] === "1",

      importado_em: parseDataBR(linha["Importado em"]),
      separado_em: parseDataBR(linha["Separado em"]),
      enviado_faturamento_em: parseDataBR(linha["Enviado para Faturamento"]),
      faturado_em: parseDataBR(linha["Faturado em"]),
      conferido_em: parseDataBR(linha["Conferido em"]),
      coletado_em: parseDataBR(linha["Coletado em"]),
      processado_em: parseDataBR(linha["Processado em"]),
      data_esperada_embarque: parseDataBR(linha["Data Esperada para Embarque"]),

      transportadora: linha["Transportadora"],
      destinatario_cidade: linha["Cidade do Destinatário"],
      destinatario_uf: linha["UF Destinatário"],

      // Vindo do SAP (Pedidos_E-comm_Geral)
      data_pedido_sap: sap["Data do pedido SAP"] ? new Date(sap["Data do pedido SAP"]) : null,
      marca: sap["Marca"] || null,
      marketplace_acronimo: sap["Marketplace"] || null,

      situacao: linha.origem === "Acompanhamento_Exp"
        ? (linha["Status da Nota Fiscal"] === "CANCELADO" ? "CANCELADO" : "EXPEDIDO")
        : "ABERTO",
      origem_arquivo: linha.origem,
    };

    p.status_calculado = calcularStatus(p);

    const lt = calcularLeadtimes(p);
    p.leadtime_sap_wms_horas = lt.sap_wms_horas;
    p.leadtime_nf_horas = lt.nf_horas;
    p.leadtime_cd_horas = lt.cd_horas;

    p.on_time = calcularOnTime(p);
    p.in_full = calcularInFull(itensPorPedido.get(String(pedidoVenda)));
    p.otif = (p.on_time === true && p.in_full === true);

    if (p.situacao === "ABERTO" && p.importado_em) {
      p.backlog_fifo_bucket = calcularBucketFifo(p.importado_em, hoje);
    } else {
      p.backlog_fifo_bucket = null;
    }

    pedidosProcessados.push(p);
  }

  onProgress("Processados " + pedidosProcessados.length + " pedidos. Enviando para o Supabase...");
  await upsertPedidos(pedidosProcessados);
  await upsertPedidoItens(itensPorPedido);

  onProgress("Gerando payload do dashboard...");
  const payload = gerarPayloadOutbound(pedidosProcessados, itensPorPedido);
  await salvarSnapshot("outbound", "auto", payload);

  await registrarLog("operacao", "Acompanhamento_Op/Exp + Itens NF + Pedidos E-comm", pedidosProcessados.length);

  onProgress("Concluído.");
  return payload;
}


// -------------------------------------------------------------------------
// 9) UPSERTS NO SUPABASE
// -------------------------------------------------------------------------
async function upsertPedidos(pedidos) {
  // Envia em lotes de 500 para não estourar o limite de payload da API
  const TAMANHO_LOTE = 500;
  for (let i = 0; i < pedidos.length; i += TAMANHO_LOTE) {
    const lote = pedidos.slice(i, i + TAMANHO_LOTE);
    const resultado = await supabaseClient.from("pedidos").upsert(lote, { onConflict: "pedido_venda" });
    if (resultado.error) console.error("Erro ao gravar pedidos:", resultado.error);
  }
}

async function upsertPedidoItens(itensPorPedido) {
  const registros = [];
  for (const par of itensPorPedido) {
    const pedidoVenda = par[0];
    const itens = par[1];
    for (const it of itens) {
      registros.push(Object.assign({ pedido_venda: Number(pedidoVenda) }, it));
    }
  }
  const TAMANHO_LOTE = 500;
  for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
    const lote = registros.slice(i, i + TAMANHO_LOTE);
    const resultado = await supabaseClient.from("pedido_itens").insert(lote);
    if (resultado.error) console.error("Erro ao gravar pedido_itens:", resultado.error);
  }
}

async function salvarSnapshot(pagina, tipo, payload) {
  const resultado = await supabaseClient.from("dashboard_snapshots").insert({
    pagina: pagina, tipo_snapshot: tipo,
    data_snapshot: new Date().toISOString().slice(0, 10),
    payload: payload,
  });
  if (resultado.error) console.error("Erro ao salvar snapshot:", resultado.error);
}

async function registrarLog(tipoBase, arquivoNome, linhasProcessadas) {
  const resultado = await supabaseClient.from("import_log").insert({
    tipo_base: tipoBase, arquivo_nome: arquivoNome,
    linhas_processadas: linhasProcessadas, status: "sucesso",
    concluido_em: new Date().toISOString(),
  });
  if (resultado.error) console.error("Erro ao gravar log:", resultado.error);
}


// -------------------------------------------------------------------------
// 10) BASE DE EMBALAGEM (botão próprio — atualiza toda terça)
// -------------------------------------------------------------------------
async function processarBaseEmbalagem(file, options) {
  const onProgress = (options && options.onProgress) || function(){};
  onProgress("Lendo Embalas.xlsx...");
  const linhas = await parseXLSX(file);

  const registros = linhas.map(function(r){
    return {
      codigo_barra: String(r["Códigodebarras"]),
      sku: r["SKU"],
      material_vulca: r["MaterialVulca"],
      marca: r["MARCA"],
      segmento: r["SEGMENTO"],
      descricao_item: r["Descrição do item"],
    };
  });

  onProgress("Enviando " + registros.length + " SKUs para o Supabase...");
  const TAMANHO_LOTE = 1000;
  for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
    const lote = registros.slice(i, i + TAMANHO_LOTE);
    const resultado = await supabaseClient.from("dim_embalas").upsert(lote, { onConflict: "codigo_barra" });
    if (resultado.error) console.error("Erro ao gravar dim_embalas:", resultado.error);
  }

  await registrarLog("embalagem", file.name, registros.length);
  onProgress("Concluído.");
}


// -------------------------------------------------------------------------
// 11) BASE DE ACRÔNIMOS (botão próprio — atualiza raramente)
// -------------------------------------------------------------------------
async function processarBaseAcronimos(file, options) {
  const onProgress = (options && options.onProgress) || function(){};
  onProgress("Lendo Base_Acrônimos.xlsx...");
  const linhas = await parseXLSX(file);

  const registros = linhas.map(function(r){
    return {
      acronimo: r["Acronimo"],
      razao_social: r["Razão Social"],
    };
  });

  // Limpa a tabela inteira antes de recarregar (base pequena, ~100 linhas,
  // e o acrônimo não é chave única — ver observação sobre BWY)
  await supabaseClient.from("dim_acronimos").delete().neq("id", 0);

  const resultado = await supabaseClient.from("dim_acronimos").insert(registros);
  if (resultado.error) console.error("Erro ao gravar dim_acronimos:", resultado.error);

  await registrarLog("acronimos", file.name, registros.length);
  onProgress("Concluído.");
}


// -------------------------------------------------------------------------
// 12) MONTAGEM DO PAYLOAD DO DASHBOARD (mesmo formato do outbound.json)
// -------------------------------------------------------------------------
function mediaMaxMin(valores, pedidos) {
  const validos = [];
  for (let i = 0; i < valores.length; i++) {
    const v = valores[i];
    if (v !== null && !isNaN(v)) validos.push({ v: v, pedido: pedidos[i] });
  }
  if (validos.length === 0) return null;
  let soma = 0, max = validos[0], min = validos[0];
  for (const x of validos) {
    soma += x.v;
    if (x.v > max.v) max = x;
    if (x.v < min.v) min = x;
  }
  return {
    media: soma / validos.length,
    max: { valor: max.v, pedido: max.pedido },
    min: { valor: min.v, pedido: min.pedido },
  };
}

function gerarPayloadOutbound(pedidos) {
  const abertos = pedidos.filter(function(p){ return p.situacao === "ABERTO"; });

  // KPIs simples
  const comOtifDefinido = pedidos.filter(function(p){ return p.otif !== null; });
  const kpis = {
    pedidos_em_fluxo: abertos.length,
    itens_em_fluxo: abertos.reduce(function(s, p){ return s + p.qtd_total_produto; }, 0),
    otif_pct: comOtifDefinido.length === 0 ? null :
      (comOtifDefinido.filter(function(p){ return p.otif; }).length / comOtifDefinido.length) * 100,
  };

  // Leadtimes (média + máx/mín com nº do pedido)
  const leadtimes = {
    sap_wms: mediaMaxMin(pedidos.map(function(p){ return p.leadtime_sap_wms_horas; }), pedidos.map(function(p){ return p.pedido_venda; })),
    nf:      mediaMaxMin(pedidos.map(function(p){ return p.leadtime_nf_horas; }), pedidos.map(function(p){ return p.pedido_venda; })),
    cd:      mediaMaxMin(pedidos.map(function(p){ return p.leadtime_cd_horas; }), pedidos.map(function(p){ return p.pedido_venda; })),
  };

  // Status por etapa x Marca (itens e pedidos)
  const marcasSet = {};
  pedidos.forEach(function(p){ if (p.marca) marcasSet[p.marca] = true; });
  const marcas = Object.keys(marcasSet);

  const etapas = ["01 - Gerar", "02 - Em Separação", "03 - Separado - Aguardando NF",
                  "04 - Separado - Conferir", "05 - Conferido - Despachar", "06 - Despachado"];

  function tabelaStatusPorMarca(unidade) {
    return etapas.map(function(etapa){
      const valores = marcas.map(function(marca){
        return pedidos
          .filter(function(p){ return p.status_calculado === etapa && p.marca === marca; })
          .reduce(function(s, p){ return s + (unidade === "itens" ? p.qtd_total_produto : 1); }, 0);
      });
      return { status: etapa, marcas: marcas, valores: valores };
    });
  }

  const status_por_etapa_itens = tabelaStatusPorMarca("itens");
  const status_por_etapa_pedidos = tabelaStatusPorMarca("pedidos");

  // Backlog FIFO em itens (só pedidos abertos)
  const backlog_fifo = ["01", "02", "03", "04+"].map(function(bucket){
    return {
      label: bucket,
      valor: abertos.filter(function(p){ return p.backlog_fifo_bucket === bucket; })
                    .reduce(function(s, p){ return s + p.qtd_total_produto; }, 0),
    };
  });

  // NOTA: "Expedição x Forecast" precisa de uma fonte de dados de meta/forecast
  // que ainda não temos — esse bloco fica pendente até definirmos a origem.

  return {
    gerado_em: new Date().toISOString(),
    kpis: kpis,
    leadtimes: leadtimes,
    status_por_etapa_itens: status_por_etapa_itens,
    status_por_etapa_pedidos: status_por_etapa_pedidos,
    backlog_fifo: backlog_fifo,
    // marketplaces e segmentos exigem o cruzamento com dim_acronimos/dim_embalas,
    // que roda como uma consulta separada no Supabase (view) — ver próximo passo
  };
}
