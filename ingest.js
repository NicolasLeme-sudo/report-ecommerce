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


// Converte um número serial de data do Excel (ex: 46235) em Date
function excelSerialParaData(serial) {
  const epoch = new Date(Date.UTC(1899, 11, 30));
  return new Date(epoch.getTime() + serial * 86400000);
}

// Formata uma Date como "yyyy-mm-dd" usando o horário LOCAL (evita bug de
// fuso horário que o toISOString() causaria, já que ele converte pra UTC)
function paraDataISOLocal(date) {
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, "0");
  const dia = String(date.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}



// -------------------------------------------------------------------------
// NORMALIZAÇÃO DE ENCODING
// Alguns exports chegam com encoding quebrado (ANSI lido como UTF-8).
// Ex: "CALÃ‡ADOS" em vez de "CALÇADOS". Esta função corrige para garantir
// que o cruzamento com dim_embalas funcione corretamente.
// -------------------------------------------------------------------------
function normalizarEncoding(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/CALÃ‡ADOS/gi, 'Calçados')
    .replace(/CONFECÃ‡ÃƒO/gi, 'Confecção')
    .replace(/VESTUÃ\u0081RIOS/gi, 'Vestuários')
    .replace(/ACESSÃ"RIOS/gi, 'Acessórios')
    .replace(/Ã§/g, 'ç').replace(/Ã£/g, 'ã').replace(/Ã¢/g, 'â')
    .replace(/Ã©/g, 'é').replace(/Ã¡/g, 'á').replace(/Ã³/g, 'ó')
    .replace(/Ãª/g, 'ê').replace(/Ã­/g, 'í').replace(/Ãº/g, 'ú')
    .trim();
}

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

// Colunas mínimas obrigatórias para validar cada fonte antes de processar.
// São menos que CAMPOS_ACOMPANHAMENTO porque só precisamos confirmar que
// o arquivo é o certo — não precisamos de todas as colunas pra isso.
const COLUNAS_OBRIGATORIAS = {
  op:       ["Pedido de Venda", "Importado em", "Status da Nota Fiscal", "Cancelado Pelo ERP"],
  exp:      ["Pedido de Venda", "Importado em", "Status da Nota Fiscal", "Processado em"],
  itensNF:  ["Pedido de Venda", "Barra", "Quantidade", "Qtde. Faturada"],
  ecomm:    ["Primário", "Marketplace", "Marca"],
  embalas:  ["MARCA", "SEGMENTO"],
  acronimos:["Acronimo", "Razão Social"],
};

// Lê só o cabeçalho de um arquivo TSV (primeira linha) e retorna o array de colunas.
function lerCabecalhoTSV(texto) {
  const primeira = texto.split("\n")[0];
  return primeira.split("\t").map(c => c.trim().replace(/\r/g, ""));
}

// Valida se as colunas obrigatórias existem no cabeçalho.
// Retorna { ok: true } ou { ok: false, faltando: [...], encontradas: [...] }
function validarColunas(cabecalho, tipo) {
  const obrigatorias = COLUNAS_OBRIGATORIAS[tipo] || [];
  const faltando = obrigatorias.filter(c => !cabecalho.includes(c));
  if (faltando.length === 0) return { ok: true };
  return {
    ok: false,
    faltando: faltando,
    encontradas: cabecalho.slice(0, 8), // mostra as primeiras 8 pra ajudar no diagnóstico
  };
}

// Valida um arquivo TSV completo: lê o texto, extrai o cabeçalho e valida.
// Lança um erro com mensagem clara se a validação falhar.
async function validarArquivoTSV(file, tipo, nomeAmigavel) {
  const texto = await file.text();
  const cabecalho = lerCabecalhoTSV(texto);
  const resultado = validarColunas(cabecalho, tipo);
  if (!resultado.ok) {
    throw new Error(
      `Arquivo inválido para "${nomeAmigavel}".\n` +
      `Colunas obrigatórias não encontradas:\n  • ${resultado.faltando.join("\n  • ")}\n\n` +
      `Primeiras colunas encontradas no arquivo:\n  ${resultado.encontradas.join(", ")}\n\n` +
      `Verifique se o arquivo correto foi selecionado.`
    );
  }
  return texto; // retorna o texto já lido, pra não ler duas vezes
}

// Valida um arquivo XLSX: lê as colunas do cabeçalho (primeira linha) e valida.
async function validarArquivoXLSX(file, tipo, nomeAmigavel) {
  const linhas = await parseXLSX(file);
  if (!linhas || linhas.length === 0) {
    throw new Error(`Arquivo "${nomeAmigavel}" está vazio ou não pôde ser lido.`);
  }
  // As chaves da primeira linha são os nomes das colunas (o parseXLSX já usa a 1ª linha como header)
  const cabecalho = Object.keys(linhas[0]);
  const resultado = validarColunas(cabecalho, tipo);
  if (!resultado.ok) {
    throw new Error(
      `Arquivo inválido para "${nomeAmigavel}".\n` +
      `Colunas obrigatórias não encontradas:\n  • ${resultado.faltando.join("\n  • ")}\n\n` +
      `Primeiras colunas encontradas no arquivo:\n  ${resultado.encontradas.join(", ")}\n\n` +
      `Verifique se o arquivo correto foi selecionado.`
    );
  }
  return linhas; // retorna as linhas já lidas
}



// -------------------------------------------------------------------------
// 4) CÁLCULO DO STATUS — combina Status da NF (WMS) com datas
//
// Por que não usar só as datas?
// Pedidos em "01 - Gerar" já têm Importado em preenchido (eles chegaram
// no WMS mas ainda não foram liberados para roteirização). O campo que
// define isso é o Status da Nota Fiscal: "IMPORTADO" e
// "AG. FORMAÇÃO DE ROMANEIO/ONDA" são os status de Gerar.
// -------------------------------------------------------------------------
function calcularStatus(p) {
  if (p.cancelado_pelo_erp) return "Cancelado";

  const wms = (p.status_nf || "").toUpperCase();

  // 01 - Gerar: pedido importado mas ainda não liberado para separação
  if (wms === "IMPORTADO" || wms === "AG. FORMAÇÃO DE ROMANEIO/ONDA" ||
      wms === "AG. FORMACAO DE ROMANEIO/ONDA" || wms === "QUARENTENA") {
    return "01 - Gerar";
  }

  // 02 - Em Separação: onda gerada ou separação em andamento
  if (wms === "AG. SEPARAÇÃO" || wms === "AG. SEPARACAO" ||
      wms === "SEPARAÇÃO INICIADA" || wms === "SEPARACAO INICIADA" ||
      wms === "AG. RESOLUÇÃO QUEBRA - SEPARAÇÃO" ||
      wms === "AG. RESOLUCAO QUEBRA - SEPARACAO") {
    return "02 - Em Separação";
  }

  // 03 - Aguardando NF: separado, enviado para faturamento, mas NF não emitida
  if (wms === "ENVIADO PARA FATURAMENTO" && !p.faturado_em) {
    return "03 - Separado - Aguardando NF";
  }

  // 04 - Conferir: NF emitida, aguardando conferência
  if (wms === "FATURADO" && !p.conferido_em) {
    return "04 - Separado - Conferir";
  }

  // 05 - Despachar: conferido, aguardando coleta/processamento
  if (!p.processado_em) return "05 - Conferido - Despachar";

  // 06 - Despachado: processado (coletado pela transportadora)
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
//
// REGRA: o prazo é de 2 dias úteis. Um pedido importado hoje OU ontem
// ainda está no dia 01 (dentro do prazo do dia corrente).
// Importado 2 dias úteis atrás = dia 02 (1 dia de atraso), e assim por diante.
//
// Exemplo numa sexta-feira:
//   importado na sexta ou quinta → 01
//   importado na quarta          → 02
//   importado na terça           → 03
//   importado na segunda ou antes → 04+
// -------------------------------------------------------------------------
function calcularBucketFifo(importadoEm, hoje) {
  const dias = diferencaDiasUteis(importadoEm, hoje);
  // 0 dias = importado hoje; 1 dia = importado ontem → ambos são "01"
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

  onProgress("Validando e lendo Acompanhamento_Op...");
  const textoOp = await validarArquivoTSV(arquivoOp, "op", "Acompanhamento_Op");
  const linhasOp = parseTSVSelecionado(textoOp, CAMPOS_ACOMPANHAMENTO).map(function(r){ return Object.assign({}, r, {origem: "Acompanhamento_Op"}); });

  onProgress("Validando e lendo Acompanhamento_Exp...");
  const textoExp = await validarArquivoTSV(arquivoExp, "exp", "Acompanhamento_Exp");
  const linhasExp = parseTSVSelecionado(textoExp, CAMPOS_ACOMPANHAMENTO).map(function(r){ return Object.assign({}, r, {origem: "Acompanhamento_Exp"}); });

  onProgress("Validando e lendo Itens de NF de Saída...");
  const textoItens = await validarArquivoTSV(arquivoItensNF, "itensNF", "Itens de NF de Saída");
  const linhasItens = parseTSVSelecionado(textoItens, CAMPOS_ITENS_NF);

  onProgress("Validando e lendo Pedidos E-comm Geral...");
  const linhasSap = await validarArquivoXLSX(arquivoPedidosEcomm, "ecomm", "Pedidos E-comm Geral");

  // ---- Índice do SAP por "Pedido de Venda" (campo "Primário") ----
  const sapPorPedido = new Map();
  for (const r of linhasSap) {
    sapPorPedido.set(String(r["Primário"]), r);
  }

  // ---- Índice de segmento por código de barras (via dim_embalas no Supabase) ----
  // Busca a tabela inteira em lotes de 1000 (limite da API) e monta um Map local.
  // Fallback: se a barra não for encontrada, usa "Calçados" (segmento dominante)
  // para garantir que os totais sempre fechem independente da base de embalagem.
  onProgress("Carregando base de embalagem do Supabase...");
  const embalasMap = new Map();
  let embalasOffset = 0;
  const LOTE_EMBALAS = 1000;
  while (true) {
    const { data: loteEmbalas, error: erroEmbalas } = await supabaseClient
      .from("dim_embalas")
      .select("codigo_barra, segmento, marca")
      .range(embalasOffset, embalasOffset + LOTE_EMBALAS - 1);
    if (erroEmbalas || !loteEmbalas || loteEmbalas.length === 0) break;
    loteEmbalas.forEach(function(e) {
      embalasMap.set(String(e.codigo_barra).trim(), { segmento: e.segmento, marca: e.marca });
    });
    if (loteEmbalas.length < LOTE_EMBALAS) break;
    embalasOffset += LOTE_EMBALAS;
  }
  onProgress("Base de embalagem: " + embalasMap.size + " SKUs carregados.");

  // ---- Índice de itens por pedido (com segmento resolvido) ----
  const itensPorPedido = new Map();
  for (const r of linhasItens) {
    const chave = r["Pedido de Venda"];
    if (!itensPorPedido.has(chave)) itensPorPedido.set(chave, []);
    const barra = String(r["Barra"] || "").trim();
    const emb = embalasMap.get(barra);
    // Fallback para "Calçados" se não encontrar na base de embalagem
    const segmento = emb ? emb.segmento : "Calçados";
    const marcaItem = emb ? emb.marca : null;
    itensPorPedido.get(chave).push({
      codigo_produto: r["Código do Produto"],
      produto: normalizarEncoding(r["Produto"]),
      barra: barra,
      quantidade: r["Quantidade"],
      qtde_faturada: r["Qtde. Faturada"],
      segmento: segmento,
      marca_item: marcaItem,
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
    p.otif = p.on_time === null ? null : (p.on_time === true && p.in_full === true);

    if (p.situacao === "ABERTO" && p.importado_em) {
      p.backlog_fifo_bucket = calcularBucketFifo(p.importado_em, hoje);
    } else {
      p.backlog_fifo_bucket = null;
    }

    pedidosProcessados.push(p);
  }

  // Contagens para diagnóstico
  const pedidosAbertos    = pedidosProcessados.filter(function(p){ return p.situacao === "ABERTO"; }).length;
  const pedidosExpedidos  = pedidosProcessados.filter(function(p){ return p.situacao === "EXPEDIDO"; }).length;
  const pedidosCancelados = pedidosProcessados.filter(function(p){ return p.situacao === "CANCELADO"; }).length;
  const totalItens = Array.from(itensPorPedido.values()).reduce(function(a,b){ return a+b.length; }, 0);

  onProgress(
    "Processados " + pedidosProcessados.length + " pedidos " +
    "(" + pedidosAbertos + " abertos, " + pedidosExpedidos + " expedidos, " + pedidosCancelados + " cancelados). " +
    totalItens + " itens. Enviando para o Supabase..."
  );

  await upsertPedidos(pedidosProcessados);
  await upsertPedidoItens(itensPorPedido);

  onProgress("Gerando payload do dashboard...");
  const payload = await gerarPayloadOutbound(pedidosProcessados, itensPorPedido);

  // Diagnóstico de segmento — verificar quantos itens têm barra na dim_embalas
  const { data: segCheck } = await supabaseClient
    .from("pedido_itens")
    .select("segmento")
    .limit(1000);
  const comSegmento = (segCheck||[]).filter(function(r){ return r.segmento; }).length;
  const semSegmento = (segCheck||[]).length - comSegmento;

  await salvarSnapshot("outbound", "auto", payload);
  await registrarLog("operacao", "Acompanhamento_Op/Exp + Itens NF + Pedidos E-comm", pedidosProcessados.length);

  onProgress(
    "✓ Concluído! " + pedidosProcessados.length + " pedidos | " + totalItens + " itens | " +
    "Segmento: " + comSegmento + " identificados, " + semSegmento + " sem correspondência na base de embalagem."
  );
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
  const pedidosAfetados = [];
  for (const par of itensPorPedido) {
    const pedidoVenda = par[0];
    const itens = par[1];
    pedidosAfetados.push(Number(pedidoVenda));
    for (const it of itens) {
      registros.push(Object.assign({ pedido_venda: Number(pedidoVenda) }, it));
    }
  }

  // CORREÇÃO ANTI-DUPLICAÇÃO: antes de inserir, apaga os itens já
  // gravados desses mesmos pedidos. Sem isso, cada clique em "Atualizar"
  // acumulava uma cópia nova de cada item (insert puro não substitui).
  // O delete é feito em lotes porque a URL da API tem limite de tamanho
  // e não comporta uma lista de milhares de pedidos de uma vez.
  const LOTE_DELETE = 200;
  for (let i = 0; i < pedidosAfetados.length; i += LOTE_DELETE) {
    const lote = pedidosAfetados.slice(i, i + LOTE_DELETE);
    const resultado = await supabaseClient.from("pedido_itens").delete().in("pedido_venda", lote);
    if (resultado.error) console.error("Erro ao limpar pedido_itens:", resultado.error);
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
  onProgress("Validando e lendo Embalas.xlsx...");
  const linhas = await validarArquivoXLSX(file, "embalas", "Base de Embalagem");

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
  onProgress("Validando e lendo Base_Acrônimos.xlsx...");
  const linhas = await validarArquivoXLSX(file, "acronimos", "Base de Acrônimos");

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
// 12) FORECAST MENSAL (botão próprio — atualiza mensalmente)
//     Layout do arquivo: aba do mês (sempre a 1ª aba), linha de dados a
//     partir da linha 4 (índice 3). Colunas fixas (0-indexado):
//       1  = Data (serial Excel ou Date)
//       2,3,4   = Mizuno: Itens, Pedidos, Faturamento
//       6,7,8   = Olympikus: Itens, Pedidos, Faturamento
//       10,11,12 = Under Armour: Itens, Pedidos, Faturamento
//       14,15,16 = TOTAL ECOM: Itens, Pedidos, Faturamento
// -------------------------------------------------------------------------
// -------------------------------------------------------------------------
// 12) FORECAST MENSAL — corrigido com índices reais confirmados no arquivo:
//   Linha 1: vazia
//   Linha 2: marcas (MZ, OLY, UA, TOTAL ECOM)
//   Linha 3: cabeçalhos (Data, Itens, Pedidos, Faturamento...)
//   Linha 4+: dados (col 1=Data serial, 2=MZ Itens, 6=OLY Itens,
//             10=UA Itens, 14=TOTAL Itens, 15=TOTAL Pedidos, 16=TOTAL Fat.)
// -------------------------------------------------------------------------
async function processarForecastMensal(file, options) {
  const onProgress = (options && options.onProgress) || function(){};
  onProgress("Lendo arquivo de forecast...");

  const buffer = await file.arrayBuffer();

  // O SheetJS lê .xlsb com o mesmo método do .xlsx
  // raw:true mantém os seriais de data como número (processamos com excelSerialParaData)
  const wb = XLSX.read(buffer, { type: "array", raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  // Validação: linha 4 (índice 3) deve ter "MZ" na posição 2 e "TOTAL ECOM" na posição 14
  // (Estrutura: linha 1=vazia, linha 2=info extra, linha 3=vazia, linha 4=marcas, linha 5=cabeçalhos, linha 6+=dados)
  // Procura a linha que contém 'MZ' nas primeiras 8 linhas (estrutura pode variar entre meses)
let linhasMarcas = [];
let linhasDados = 6; // padrão
for (let r = 0; r < 8; r++) {
  const l = linhas[r] || [];
  const temMZ = l.some(function(v){ return String(v||'').toUpperCase().includes('MZ'); });
  if (temMZ) { linhasMarcas = l; linhasDados = r + 2; break; }
}
  const temMZ    = linhasMarcas.some(function(v){ return String(v||'').toUpperCase() === 'MZ'; });
  const temTotal = linhasMarcas.some(function(v){ return String(v||'').toUpperCase().includes('TOTAL ECOM'); });
  if (!temMZ && !temTotal) {
    throw new Error(
      'Arquivo inválido para Forecast. Esperado: "MZ" na coluna C e "TOTAL ECOM" na coluna O da linha 4. ' +
      'Verifique se selecionou o arquivo correto (Acompanhamento_Faturamento_CD).' +
      '\nEncontrado na linha 4: ' + JSON.stringify(linhasMarcas.slice(0,16))
    );
  }

  const registros = [];
  let linhasLidas = 0;

  // Dados começam na linha 6 (índice 5) — pula cabeçalhos e linhas de marcas
  for (let i = linhasDados; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha) continue;

    // Procura o serial de data em qualquer posição da linha (SheetJS pode deslocar colunas)
    let serial = null;
    for (let c = 0; c < 5; c++) {
      const v = Number(linha[c]);
      if (!isNaN(v) && v >= 40000 && v <= 60000) { serial = v; break; }
    }
    if (!serial) continue;

    const data = excelSerialParaData(serial);
    const dataISO = paraDataISOLocal(data);

    // Total ECOM (índices 14, 15, 16)
    const totalItens = Number(linha[14]) || 0;
    const totalPedidos = Number(linha[15]) || 0;
    const totalFat = Number(linha[16]) || 0;

    registros.push({ data: dataISO, marca: "TOTAL",        itens_forecast: totalItens,           pedidos_forecast: totalPedidos,        faturamento_forecast: totalFat });
    registros.push({ data: dataISO, marca: "Mizuno",       itens_forecast: Number(linha[2])||0,  pedidos_forecast: Number(linha[3])||0,  faturamento_forecast: Number(linha[4])||0 });
    registros.push({ data: dataISO, marca: "Olympikus",    itens_forecast: Number(linha[6])||0,  pedidos_forecast: Number(linha[7])||0,  faturamento_forecast: Number(linha[8])||0 });
    registros.push({ data: dataISO, marca: "Under Armour", itens_forecast: Number(linha[10])||0, pedidos_forecast: Number(linha[11])||0, faturamento_forecast: Number(linha[12])||0 });

    linhasLidas++;
  }

  if (linhasLidas === 0) {
    throw new Error('Nenhuma linha de dados válida encontrada no arquivo de forecast. Verifique se o arquivo tem dados a partir da linha 4.');
  }

  onProgress(`${linhasLidas} dias de forecast lidos. Gravando ${registros.length} registros...`);

  let erros = 0;
  const TAMANHO_LOTE = 200;
  for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
    const lote = registros.slice(i, i + TAMANHO_LOTE);
    const resultado = await supabaseClient.from("forecast_diario").upsert(lote, { onConflict: "data,marca" });
    if (resultado.error) { console.error("Erro ao gravar forecast_diario:", resultado.error); erros++; }
  }

  await registrarLog("forecast", file.name, registros.length);

  if (erros > 0) {
    onProgress(`⚠ Forecast parcialmente gravado — ${erros} lote(s) com erro. Verifique o console.`);
  } else {
    onProgress(`✓ ${linhasLidas} dias de forecast gravados com sucesso.`);
  }
}


// -------------------------------------------------------------------------
// 13) BUSCAR FORECAST + MARKETPLACE + SEGMENTO (views já prontas no Supabase)
// -------------------------------------------------------------------------
async function buscarForecastUltimos7Dias() {
  const hoje = new Date();
  const seteDiasAtras = new Date(hoje);
  seteDiasAtras.setDate(hoje.getDate() - 6);

  const resultado = await supabaseClient
    .from("forecast_diario")
    .select("*")
    .eq("marca", "TOTAL")
    .gte("data", paraDataISOLocal(seteDiasAtras))
    .lte("data", paraDataISOLocal(hoje));

  if (resultado.error) {
    console.error("Erro ao buscar forecast:", resultado.error);
    return [];
  }
  return resultado.data;
}

async function buscarMarketplaces() {
  const resultado = await supabaseClient.from("vw_marketplace_resumo").select("*");
  if (resultado.error) {
    console.error("Erro ao buscar marketplaces:", resultado.error);
    return [];
  }
  return resultado.data;
}

async function buscarSegmentos() {
  const resultado = await supabaseClient.from("vw_segmento_resumo").select("*");
  if (resultado.error) {
    console.error("Erro ao buscar segmentos:", resultado.error);
    return [];
  }
  return resultado.data;
}

function computarIntegracao7Dias(pedidos) {
  // CORREÇÃO: conta ITENS integrados (qtd_total_produto), não pedidos.
  // Itens são o que move o faturamento — dado mais relevante operacionalmente.
  const hoje = new Date();
  const dias = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() - i);
    dias.push(paraDataISOLocal(d));
  }

  const itensPorDia = {};
  dias.forEach(function(d){ itensPorDia[d] = 0; });
  pedidos.forEach(function(p){
    if (p.importado_em) {
      const diaISO = paraDataISOLocal(p.importado_em);
      if (itensPorDia[diaISO] !== undefined) {
        itensPorDia[diaISO] += (p.qtd_total_produto || 0);
      }
    }
  });

  return {
    dias: dias.map(function(d){ return d.slice(8,10) + "/" + d.slice(5,7); }),
    itens_integrados: dias.map(function(d){ return itensPorDia[d]; }),
  };
}

function computarExpedicaoSemana(pedidos, forecastRows) {  const hoje = new Date();
  const dias = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() - i);
    dias.push(paraDataISOLocal(d));
  }

  const expedidoPorDia = {};
  dias.forEach(function(d){ expedidoPorDia[d] = 0; });
  pedidos.forEach(function(p){
    if (p.processado_em) {
      const diaISO = paraDataISOLocal(p.processado_em);
      if (expedidoPorDia[diaISO] !== undefined) {
        expedidoPorDia[diaISO] += p.qtd_total_produto;
      }
    }
  });

  const forecastPorDia = {};
  forecastRows.forEach(function(r){ forecastPorDia[r.data] = r.itens_forecast; });

  return {
    dias: dias.map(function(d){ return d.slice(8,10) + "/" + d.slice(5,7); }),
    expedido: dias.map(function(d){ return expedidoPorDia[d]; }),
    forecast: dias.map(function(d){ return forecastPorDia[d] || 0; }),
  };
}



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

async function gerarPayloadOutbound(pedidos, itensPorPedido) {
  const abertos = pedidos.filter(function(p){
    return p.situacao === "ABERTO" && p.status_calculado !== "Cancelado";
  });

  // KPIs simples
  const comOtifDefinido = pedidos.filter(function(p){ return p.status_calculado === "06 - Despachado"; });
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
  // OBS: "06 - Despachado" fica de fora dessas tabelas — só entra no
  // gráfico de Expedição x Forecast, aqui é só o que está em fluxo.
  const marcasSet = {};
  pedidosOp.forEach(function(p){ marcasSet[p.marca || "Sem Marca"] = true; });
  const marcas = Object.keys(marcasSet);

  const etapasOperacionais = ["01 - Gerar", "02 - Em Separação", "03 - Separado - Aguardando NF",
                  "04 - Separado - Conferir", "05 - Conferido - Despachar"];

// Só pedidos em operação real: ABERTO e não cancelado
  const pedidosOp = pedidos.filter(function(p){
    return p.situacao === "ABERTO" && p.status_calculado !== "Cancelado";
  });

  function tabelaStatusPorMarca(unidade) {
    return etapasOperacionais.map(function(etapa){
      const valores = marcas.map(function(marca){
        return pedidosOp
          .filter(function(p){ return p.status_calculado === etapa && p.marca === marca; })
          .reduce(function(s, p){ return s + (unidade === "itens" ? (p.qtd_total_produto || 0) : 1); }, 0);
      });
      const totalEtapa = valores.reduce(function(a, b){ return a + b; }, 0);
      return { status: etapa, marcas: marcas, valores: valores, total: totalEtapa };
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

  // Forecast, Marketplace e Segmento — vêm de fontes/views separadas do Supabase
  const forecastRows = await buscarForecastUltimos7Dias();
  const expedicao_semana = computarExpedicaoSemana(pedidos, forecastRows);
  const integracao_7dias = computarIntegracao7Dias(pedidos);

  const marketplacesRaw = await buscarMarketplaces();
  const marketplaces = marketplacesRaw.map(function(m){
    return { nome: m.marketplace_nome, valor: m.itens };
  });

  // SEGMENTO: calculado diretamente dos itens já processados (com fallback Calçados)
  // NÃO usa mais a view vw_segmento_resumo — o cruzamento já foi feito na ingestão.
  // Só considera pedidos ABERTOS para refletir o estado atual da operação.
  const segContador = {};
  abertos.forEach(function(p) {
    const itensP = itensPorPedido ? itensPorPedido.get(String(p.pedido_venda)) : null;
    if (itensP && itensP.length > 0) {
      itensP.forEach(function(it) {
        const seg = it.segmento || "Calçados"; // fallback garantido
        segContador[seg] = (segContador[seg] || 0) + (Number(it.quantidade) || 0);
      });
    } else {
      // Pedido sem itens na base de NF: soma pelo total do pedido como Calçados
      segContador["Calçados"] = (segContador["Calçados"] || 0) + (p.qtd_total_produto || 0);
    }
  });
  const totalItensSegmento = Object.values(segContador).reduce(function(a,b){ return a+b; }, 0) || 1;
  const segmentos = Object.keys(segContador).map(function(nome) {
    return { nome: nome, pct: (segContador[nome] / totalItensSegmento) * 100 };
  }).sort(function(a,b){ return b.pct - a.pct; });

  return {
    gerado_em: new Date().toISOString(),
    kpis: kpis,
    leadtimes: leadtimes,
    status_por_etapa_itens: status_por_etapa_itens,
    status_por_etapa_pedidos: status_por_etapa_pedidos,
    backlog_fifo: backlog_fifo,
    expedicao_semana: expedicao_semana,
    integracao_7dias: integracao_7dias,
    marketplaces: marketplaces,
    segmentos: segmentos,
  };
}
