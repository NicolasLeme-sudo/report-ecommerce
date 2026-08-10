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

// Formata uma Date como "yyyy-mm-dd" usando horário UTC — necessário para datas
// vindas de seriais do Excel (excelSerialParaData), que são criadas à meia-noite UTC.
// Se usarmos getFullYear/getMonth/getDate (local), em fusos negativos como BRT (UTC-3)
// a data cai 1 dia atrás (meia-noite UTC = 21h do dia anterior em BRT).
function paraDataISOUTC(date) {
  const ano = date.getUTCFullYear();
  const mes = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(date.getUTCDate()).padStart(2, "0");
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

  // 03 - Aguardando NF: enviado para faturamento mas NF ainda não emitida
  if (wms === "ENVIADO PARA FATURAMENTO" && !p.faturado_em) {
    return "03 - Separado - Aguardando NF";
  }

  // 04 - Conferir: NF emitida (faturado_em preenchido) mas conferência pendente
  if (wms === "ENVIADO PARA FATURAMENTO" && p.faturado_em && !p.conferido_em) {
    return "04 - Separado - Conferir";
  }
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
    const descricaoProduto = normalizarEncoding(r["Produto"] || r["Descrição do item"] || "");
    const marcaItem = (emb && emb.marca) ? emb.marca : inferirMarcaPorDescricao(descricaoProduto);
    itensPorPedido.get(chave).push({
      codigo_produto: r["Código do Produto"],
      produto: descricaoProduto,
      barra: barra,
      quantidade: Number(r["Quantidade"]) || 0,
      qtde_faturada: Number(r["Qtde. Faturada"]) || 0,
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
      marca: sap["Marca"] || null, // fallback aplicado abaixo
      marketplace_acronimo: sap["Marketplace"] || null,

      situacao: linha.origem === "Acompanhamento_Exp"
        ? (linha["Status da Nota Fiscal"] === "CANCELADO" ? "CANCELADO" : "EXPEDIDO")
        : "ABERTO",
      origem_arquivo: linha.origem,
    };

    // Fallback de marca: se SAP não retornou, inferir pelos itens do pedido
    if (!p.marca) {
      var itensP = itensPorPedido.get(String(pedidoVenda)) || [];
      for (var ii = 0; ii < itensP.length; ii++) {
        if (itensP[ii].marca_item) { p.marca = itensP[ii].marca_item; break; }
      }
    }
    // Segundo fallback: inferir pelo campo produto/descrição dos itens
    if (!p.marca) {
      var itensP2 = itensPorPedido.get(String(pedidoVenda)) || [];
      for (var jj = 0; jj < itensP2.length; jj++) {
        var inf = inferirMarcaPorDescricao(itensP2[jj].produto);
        if (inf) { p.marca = inf; break; }
      }
    }

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

  // DEDUPLICAÇÃO: o arquivo de origem pode trazer o mesmo produto mais de uma vez
  // no mesmo pedido (ex: mesmo SKU em endereços/lotes diferentes da NF). Quando isso
  // acontece, o insert() do Postgres rejeita o lote inteiro com erro 409 (conflito de
  // chave), mesmo com o delete prévio, porque a duplicidade ocorre dentro do próprio
  // lote sendo inserido. Aqui somamos a quantidade de duplicatas em um único registro
  // por pedido+produto, evitando o conflito sem perder volume.
  const dedupMap = new Map();
  registros.forEach(function(r){
    const chave = r.pedido_venda + "||" + (r.codigo_produto || r.barra || "");
    if (dedupMap.has(chave)) {
      const existente = dedupMap.get(chave);
      existente.quantidade = (Number(existente.quantidade) || 0) + (Number(r.quantidade) || 0);
      existente.qtde_faturada = (Number(existente.qtde_faturada) || 0) + (Number(r.qtde_faturada) || 0);
    } else {
      dedupMap.set(chave, r);
    }
  });
  const registrosDedup = Array.from(dedupMap.values());

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
  for (let i = 0; i < registrosDedup.length; i += TAMANHO_LOTE) {
    const lote = registrosDedup.slice(i, i + TAMANHO_LOTE);
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
// -------------------------------------------------------------------------
// FORECAST MENSAL — estrutura simplificada (a partir de ago/2026):
//   Linha 1 (índice 0): marcas — MZ, OLY, UA, TOTAL ECOM (colunas C, D, E, F)
//   Linha 2 (índice 1): cabeçalhos — "Data" (col B) e "Itens" repetido nas demais
//   Linha 3+ (índice 2+): dados — col B(1)=Data serial, C(2)=MZ, D(3)=OLY, E(4)=UA, F(5)=TOTAL
// O card "Expedição x Forecast" usa exclusivamente a coluna TOTAL (índice 5).
// As colunas por marca (C/D/E) são gravadas apenas para uso futuro, sem uso no
// dashboard hoje.
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

  // Validação: linha de marcas (índice 0) deve conter "MZ" e "TOTAL ECOM"
  const linhaMarcas = linhas[0] || [];
  const temMZ    = linhaMarcas.some(function(v){ return String(v||'').toUpperCase() === 'MZ'; });
  const temTotal = linhaMarcas.some(function(v){ return String(v||'').toUpperCase().includes('TOTAL ECOM'); });
  if (!temMZ || !temTotal) {
    throw new Error(
      'Arquivo inválido para Forecast. Esperado "MZ" e "TOTAL ECOM" na 1ª linha da planilha. ' +
      'Verifique se selecionou o arquivo correto (Acompanhamento_Faturamento_CD).' +
      '\nEncontrado na linha 1: ' + JSON.stringify(linhaMarcas.slice(0,8))
    );
  }

  const registros = [];
  let linhasLidas = 0;

  for (let i = 2; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha) continue;

    // Localiza a coluna com o serial de data dinamicamente (o SheetJS pode ou não
    // incluir uma coluna vazia inicial, dependendo de como a planilha foi salva).
    let colData = -1, serial = null;
    for (let c = 0; c < 4; c++) {
      const v = Number(linha[c]);
      if (!isNaN(v) && v >= 40000 && v <= 60000) { colData = c; serial = v; break; }
    }
    if (colData < 0) continue;

    // A coluna TOTAL fica 3 posições à direita da coluna de Data
    // (Data, MZ, OLY, UA, TOTAL — 4 colunas de marca entre Data e Total)
    const colTotal = colData + 4;

    const data = excelSerialParaData(serial);
    const dataISO = paraDataISOUTC(data); // UTC obrigatório: serial do Excel é meia-noite UTC
    const diaSemana = data.getUTCDay(); // 0=domingo, 6=sábado (serial já é UTC-based)

    // Sábados e domingos não têm expedição programada — zera independente do
    // que a planilha trouxer (proteção contra fórmulas de rateio semanal que
    // eventualmente preencham essas células com valor residual).
    const totalItens = (diaSemana === 0 || diaSemana === 6)
      ? 0
      : Math.round(Number(linha[colTotal]) || 0);

    registros.push({ data: dataISO, marca: "TOTAL", itens_forecast: totalItens, pedidos_forecast: 0, faturamento_forecast: 0 });

    linhasLidas++;
  }

  if (linhasLidas === 0) {
    throw new Error('Nenhuma linha de dados válida encontrada no arquivo de forecast. Verifique se o arquivo tem dados a partir da linha 3.');
  }

  onProgress(`${linhasLidas} dias de forecast lidos. Gravando ${registros.length} registros...`);

  // DELETE completo antes de inserir — garante que dados corrigidos sempre sobrescrevem
  // os anteriores, sem depender do upsert resolver conflitos corretamente.
  await supabaseClient.from("forecast_diario").delete().neq("id", 0);

  let erros = 0;
  const TAMANHO_LOTE = 200;
  for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
    const lote = registros.slice(i, i + TAMANHO_LOTE);
    const resultado = await supabaseClient.from("forecast_diario").insert(lote);
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

  // Filtra apenas pedidos EXPEDIDOS (vindos do Acompanhamento_Exp) e não cancelados
  // para não contaminar o total com pedidos ainda em aberto que tenham processado_em preenchido
  pedidos
    .filter(function(p){ return p.situacao === "EXPEDIDO" && p.status_calculado !== "Cancelado"; })
    .forEach(function(p){
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

// Segmento predominante de um pedido: soma quantidade por segmento entre os itens
// da NF e retorna o segmento com maior volume (fallback "Calçados" se sem itens)
function segmentoPredominante(itensP) {
  if (!itensP || itensP.length === 0) return "Calçados";
  const somaPorSeg = {};
  itensP.forEach(function(it){
    const seg = it.segmento || "Calçados";
    somaPorSeg[seg] = (somaPorSeg[seg] || 0) + (Number(it.quantidade) || 0);
  });
  let melhor = "Calçados", melhorValor = -1;
  Object.keys(somaPorSeg).forEach(function(seg){
    if (somaPorSeg[seg] > melhorValor) { melhor = seg; melhorValor = somaPorSeg[seg]; }
  });
  return melhor;
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

  // Só pedidos em operação real: ABERTO e não cancelado
  const pedidosOp = pedidos.filter(function(p){
    return p.situacao === "ABERTO" && p.status_calculado !== "Cancelado";
  });

  // Status por etapa x Marca (itens e pedidos)
  // OBS: "06 - Despachado" fica de fora dessas tabelas — só entra no
  // gráfico de Expedição x Forecast, aqui é só o que está em fluxo.
  const marcasSet = {};
  pedidosOp.forEach(function(p){ if (p.marca) marcasSet[p.marca] = true; });
  const marcas = Object.keys(marcasSet);

  const etapasOperacionais = ["01 - Gerar", "02 - Em Separação", "03 - Separado - Aguardando NF",
                  "04 - Separado - Conferir", "05 - Conferido - Despachar"];

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

  // Forecast e Integração — permanecem como séries de 7 dias, fora do escopo dos filtros
  const forecastRows = await buscarForecastUltimos7Dias();
  const expedicao_semana = computarExpedicaoSemana(pedidos, forecastRows);
  const integracao_7dias = computarIntegracao7Dias(pedidos);

  // MARKETPLACE: calculado diretamente dos pedidos abertos (marketplace_acronimo já vem do SAP)
  // NÃO usa mais a view vw_marketplace_resumo — permite reaproveitar o mesmo dado no filtro.
  const mktContador = {};
  pedidosOp.forEach(function(p){
    const nome = p.marketplace_acronimo || "Não identificado";
    mktContador[nome] = (mktContador[nome] || 0) + (p.qtd_total_produto || 0);
  });
  const marketplaces = Object.keys(mktContador)
    .map(function(nome){ return { nome: nome, valor: mktContador[nome] }; })
    .sort(function(a,b){ return b.valor - a.valor; });

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

  // PEDIDOS_DETALHE: dado de nível fino para filtros funcionais (Marca, Marketplace, Backlog FIFO)
  // recalculados no navegador sem nova consulta ao Supabase. Só pedidos abertos/não cancelados.
  const pedidos_detalhe = pedidosOp.map(function(p){
    const itensP = itensPorPedido ? itensPorPedido.get(String(p.pedido_venda)) : null;
    return {
      pedido_venda: p.pedido_venda,
      marca: p.marca || "Sem Marca",
      marketplace: p.marketplace_acronimo || "Não identificado",
      backlog_fifo_bucket: p.backlog_fifo_bucket,
      status_calculado: p.status_calculado,
      qtd_total_produto: p.qtd_total_produto || 0,
      otif: p.otif,
      leadtime_sap_wms_horas: p.leadtime_sap_wms_horas,
      leadtime_nf_horas: p.leadtime_nf_horas,
      leadtime_cd_horas: p.leadtime_cd_horas,
      segmento_predominante: segmentoPredominante(itensP),
    };
  });

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
    pedidos_detalhe: pedidos_detalhe,
  };
}

// =========================================================
// INBOUND — funções de ingestão
// Adicionar ao final do ingest.js (antes do fechamento, se houver)
// =========================================================

// Colunas obrigatórias por arquivo do Inbound
const COLUNAS_INBOUND = {
  nf_recebs:    ["idNotaFiscal", "Nota Fiscal", "Status", "Data de Emissão"],
  itens_entrada:["idNotaFiscal", "Código do Produto", "Barra", "Quantidade"],
  gerenciador:  ["Nota Fiscal", "Data da Conferência", "Qtde. de Volumes"],
  kardex:       ["Data", "Local", "Estoque Antes", "Estoque Após"],
  stage:        ["Local", "Barra", "Produto", "Estoque (UN)"],
};

function validarColunasInbound(header, tipo) {
  const obrigatorias = COLUNAS_INBOUND[tipo] || [];
  const faltando = obrigatorias.filter(function(c){ return !header.includes(c); });
  if (faltando.length > 0) {
    throw new Error(
      "Arquivo inválido para " + tipo + ".\n" +
      "Colunas faltando: " + faltando.join(", ") + "\n" +
      "Encontradas: " + header.slice(0,8).join(", ")
    );
  }
}

// Normaliza segmento para Calçados ou Vestuário (agrupamento do Inbound)
// Calçados = Calçados + Chinelos
// Vestuário = Vestuários + Meias + Acessórios
function normalizarSegmentoInbound(segmento) {
  const s = normalizarEncoding(segmento || "").toLowerCase();
  if (s.includes("chin") || s.includes("cal")) return "Calçados";
  return "Vestuário";
}

// -------------------------------------------------------------------------
// PROCESSAMENTO DO INBOUND
// -------------------------------------------------------------------------
async function processarRelatoriosInbound(files, options) {
  const onProgress = (options && options.onProgress) || function(){};

  onProgress("Lendo arquivos do Inbound...");
  const textoRecebs  = await files.arquivoRecebs.text();
  const textoItens   = await files.arquivoItens.text();
  const textoOR      = await files.arquivoOR.text();
  const textoKardex  = await files.arquivoKardex.text();
  const textoStage   = await files.arquivoStage.text();

  // Parsear cada arquivo
  const linhasRecebs  = parseTSVSelecionado(textoRecebs,  ["idNotaFiscal","Nota Fiscal","Status","Data de Emissão","Data de Cadastro","Data de Processamento","Emitente","Ordem de Recebimento"]);
  const linhasItens   = parseTSVSelecionado(textoItens,   ["idNotaFiscal","Código do Produto","Produto","Barra","Quantidade"]);
  const linhasOR      = parseTSVSelecionado(textoOR,      ["Nota Fiscal","Data da Conferência","Qtde. de Volumes"]);
  const linhasKardex  = parseTSVSelecionado(textoKardex,  ["Data","Local","Estoque Antes","Estoque Após"]);
  const linhasStage   = parseTSVSelecionado(textoStage,   ["Local","Barra","Produto","Estoque (UN)"]);

  // Validar colunas
  const hRecebs  = Object.keys(linhasRecebs[0]  || {});
  const hItens   = Object.keys(linhasItens[0]   || {});
  const hOR      = Object.keys(linhasOR[0]      || {});
  const hKardex  = Object.keys(linhasKardex[0]  || {});
  const hStage   = Object.keys(linhasStage[0]   || {});
  validarColunasInbound(hRecebs,  "nf_recebs");
  validarColunasInbound(hItens,   "itens_entrada");
  validarColunasInbound(hOR,      "gerenciador");
  validarColunasInbound(hKardex,  "kardex");
  validarColunasInbound(hStage,   "stage");

  // Carregar embalas do Supabase para cruzamento
  onProgress("Carregando base de embalagem...");
  const embalasMap = new Map();
  let offset = 0;
  while (true) {
    const { data: lote } = await supabaseClient.from("dim_embalas").select("codigo_barra,segmento,marca").range(offset, offset + 999);
    if (!lote || lote.length === 0) break;
    lote.forEach(function(e){ embalasMap.set(String(e.codigo_barra).trim(), e); });
    if (lote.length < 1000) break;
    offset += 1000;
  }
  onProgress(embalasMap.size + " SKUs carregados.");

  // ---- 1) NFs de recebimento ----
  const statusValidos = ["IMPORTADA", "EM CARGA/OR", "PROCESSADA"];
  const nfRegistros = linhasRecebs
    .filter(function(r){ return statusValidos.includes(r["Status"]); })
    .map(function(r){
      return {
        id_nota_fiscal:     Number(r["idNotaFiscal"]),
        nota_fiscal:        r["Nota Fiscal"],
        status:             r["Status"],
        data_emissao:       r["Data de Emissão"]    ? paraDataISOLocal(parseDataBR(r["Data de Emissão"]))    : null,
        data_cadastro:      r["Data de Cadastro"]   ? paraDataISOLocal(parseDataBR(r["Data de Cadastro"]))   : null,
        data_processamento: r["Data de Processamento"] ? paraDataISOLocal(parseDataBR(r["Data de Processamento"])) : null,
        emitente:           r["Emitente"],
        ordem_recebimento:  r["Ordem de Recebimento"],
      };
    });

  onProgress("Gravando " + nfRegistros.length + " NFs...");
  // Limpa e reinsere (base mensal — sempre substitui)
  await supabaseClient.from("inbound_nfs").delete().neq("id_nota_fiscal", 0);
  for (let i = 0; i < nfRegistros.length; i += 500) {
    const { error } = await supabaseClient.from("inbound_nfs").insert(nfRegistros.slice(i, i+500));
    if (error) console.error("Erro inbound_nfs:", error);
  }

  // ---- 2) Itens das NFs ----
  const nfIds = new Set(nfRegistros.map(function(r){ return String(r.id_nota_fiscal); }));
  const itensRegistros = linhasItens
    .filter(function(r){ return nfIds.has(r["idNotaFiscal"]); })
    .map(function(r){
      const barra = String(r["Barra"] || "").trim();
      const emb   = embalasMap.get(barra);
      const seg   = emb ? normalizarSegmentoInbound(emb.segmento) : "Calçados";
      const produtoDescricao = normalizarEncoding(r["Produto"]);
      // Marca: 1ª tentativa dim_embalas (via Barra); só se não localizado, cai no fallback por Descrição
      const marca = (emb && emb.marca) ? emb.marca : inferirMarcaPorDescricao(produtoDescricao);
      return {
        id_nota_fiscal: Number(r["idNotaFiscal"]),
        codigo_produto:  r["Código do Produto"],
        produto:         produtoDescricao,
        barra:           barra,
        quantidade:      Number(r["Quantidade"]) || 0,
        segmento:        seg,
        marca:           marca,
      };
    });

  onProgress("Gravando " + itensRegistros.length + " itens...");
  await supabaseClient.from("inbound_itens").delete().neq("id", 0);
  for (let i = 0; i < itensRegistros.length; i += 500) {
    const { error } = await supabaseClient.from("inbound_itens").insert(itensRegistros.slice(i, i+500));
    if (error) console.error("Erro inbound_itens:", error);
  }

  // ---- 3) Recebimento diário (Gerenciador de OR) ----
  const recebPorDia = {};
  linhasOR.forEach(function(r){
    const d = parseDataBR(r["Data da Conferência"]);
    if (!d) return;
    const iso = paraDataISOLocal(d);
    if (!recebPorDia[iso]) recebPorDia[iso] = { nfs: 0, itens: 0 };
    recebPorDia[iso].nfs++;
    recebPorDia[iso].itens += Number(r["Qtde. de Volumes"]) || 0;
  });
  const recebRegistros = Object.keys(recebPorDia).map(function(d){
    return { data_conferencia: d, nfs_recebidas: recebPorDia[d].nfs, itens_recebidos: recebPorDia[d].itens };
  });
  for (let i = 0; i < recebRegistros.length; i += 200) {
    const { error } = await supabaseClient.from("inbound_recebimento_diario")
      .upsert(recebRegistros.slice(i, i+200), { onConflict: "data_conferencia" });
    if (error) console.error("Erro recebimento_diario:", error);
  }

  // ---- 4) Armazenagem diária (Kardex de End — endereços H, I, J) ----
  const armPorDia = {};
  linhasKardex.forEach(function(r){
    const local = String(r["Local"] || "").toUpperCase();
    if (!local.startsWith("H") && !local.startsWith("I") && !local.startsWith("J")) return;
    const d = parseDataBR(r["Data"]);
    if (!d) return;
    const iso = paraDataISOLocal(d);
    const qtde = (Number(r["Estoque Antes"]) || 0) - (Number(r["Estoque Após"]) || 0);
    if (!armPorDia[iso]) armPorDia[iso] = 0;
    armPorDia[iso] += qtde;
  });
  const armRegistros = Object.keys(armPorDia).map(function(d){
    return { data_alocacao: d, itens_armazenados: armPorDia[d] };
  });
  for (let i = 0; i < armRegistros.length; i += 200) {
    const { error } = await supabaseClient.from("inbound_armazenagem_diario")
      .upsert(armRegistros.slice(i, i+200), { onConflict: "data_alocacao" });
    if (error) console.error("Erro armazenagem_diario:", error);
  }

  // ---- 5) Stage pendente (Recebimento Stage — endereços H, I, J) ----
  const stageRegistros = linhasStage
    .filter(function(r){
      const local = String(r["Local"] || "").toUpperCase();
      return local.startsWith("H") || local.startsWith("I") || local.startsWith("J");
    })
    .map(function(r){
      const barra = String(r["Barra"] || "").trim();
      const emb   = embalasMap.get(barra);
      const produtoDescricao = normalizarEncoding(r["Produto"]);
      // Marca: 1ª tentativa dim_embalas (via Barra); só se não localizado, cai no fallback por Descrição
      const marca = (emb && emb.marca) ? emb.marca : inferirMarcaPorDescricao(produtoDescricao);
      return {
        local:       r["Local"],
        barra:       barra,
        produto:     produtoDescricao,
        estoque_un:  Number(r["Estoque (UN)"]) || 0,
        segmento:    emb ? normalizarSegmentoInbound(emb.segmento) : "Calçados",
        marca:       marca,
      };
    });

  await supabaseClient.from("inbound_stage").delete().neq("id", 0);
  for (let i = 0; i < stageRegistros.length; i += 500) {
    const { error } = await supabaseClient.from("inbound_stage").insert(stageRegistros.slice(i, i+500));
    if (error) console.error("Erro inbound_stage:", error);
  }

  // ---- Gerar payload do dashboard Inbound ----
  onProgress("Gerando snapshot do Inbound...");
  const payload = await gerarPayloadInbound(nfRegistros, itensRegistros, recebPorDia, armPorDia, stageRegistros);
  await salvarSnapshot("inbound", "auto", payload);
  await registrarLog("inbound", "Relatórios Inbound", nfRegistros.length);

  onProgress("✓ Inbound atualizado! " + nfRegistros.length + " NFs | " + itensRegistros.length + " itens | " + stageRegistros.length + " endereços no stage.");
}

// -------------------------------------------------------------------------
// PAYLOAD DO DASHBOARD INBOUND
// -------------------------------------------------------------------------
async function gerarPayloadInbound(nfRegistros, itensRegistros, recebPorDia, armPorDia, stageRegistros) {
  const hoje = new Date();
  const mesAtual = hoje.getMonth();
  const anoAtual = hoje.getFullYear();

  // KPIs de NFs
  // Pendente de recebimento = IMPORTADA (não recebida) + EM CARGA/OR (recebida, aguardando armazenagem)
  // O "pendente" no seu report representa tudo que ainda não foi PROCESSADA
  const nfsPendReceb = nfRegistros.filter(function(n){ return n.status === "IMPORTADA"; });
  const nfsPendArm   = nfRegistros.filter(function(n){ return n.status === "EM CARGA/OR"; });
  const nfIdsReceb   = new Set(nfsPendReceb.map(function(n){ return n.id_nota_fiscal; }));
  // Armazenagem pendente vem do Stage (já definido), NFs EM CARGA/OR são subconjunto do pendente receb
  const nfIdsArm     = new Set(nfsPendArm.map(function(n){ return n.id_nota_fiscal; }));

  // KPIs de itens
  const itensPendReceb = itensRegistros
    .filter(function(i){ return nfIdsReceb.has(i.id_nota_fiscal); })
    .reduce(function(s, i){ return s + i.quantidade; }, 0);
  const itensPendArmNF = itensRegistros
    .filter(function(i){ return nfIdsArm.has(i.id_nota_fiscal); })
    .reduce(function(s, i){ return s + i.quantidade; }, 0);
  const itensPendArm = itensPendArmNF + stageRegistros
    .reduce(function(s, i){ return s + i.estoque_un; }, 0);
  // Últimos 7 dias
  const dias7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() - i);
    dias7.push(paraDataISOLocal(d));
  }
  const labelsDias = dias7.map(function(d){ return d.slice(8,10) + "/" + d.slice(5,7); });
  const receb7dias = dias7.map(function(d){ return recebPorDia[d] ? recebPorDia[d].itens : 0; });
  const arm7dias   = dias7.map(function(d){ return armPorDia[d] || 0; });

  // Acumulado mensal (soma do histórico)
  const { data: acumReceb } = await supabaseClient
    .from("inbound_recebimento_diario")
    .select("itens_recebidos, data_conferencia")
    .gte("data_conferencia", anoAtual + "-" + String(mesAtual+1).padStart(2,"0") + "-01");
  const { data: acumArm } = await supabaseClient
    .from("inbound_armazenagem_diario")
    .select("itens_armazenados, data_alocacao")
    .gte("data_alocacao", anoAtual + "-" + String(mesAtual+1).padStart(2,"0") + "-01");

  const totalRecebMes = (acumReceb||[]).reduce(function(s,r){ return s + r.itens_recebidos; }, 0);
  const totalArmMes   = (acumArm||[]).reduce(function(s,r){ return s + r.itens_armazenados; }, 0);

  // Top 10 NFs por FIFO (IMPORTADA + EM CARGA/OR, mais antigas primeiro)
  const nfsPendentes = nfRegistros
    .filter(function(n){ return n.status === "IMPORTADA" || n.status === "EM CARGA/OR"; })
    .sort(function(a,b){ return new Date(a.data_emissao) - new Date(b.data_emissao); })
    .slice(0, 10)
    .map(function(n){
      const itensNF = itensRegistros.filter(function(i){ return i.id_nota_fiscal === n.id_nota_fiscal; });
      const totalItens = itensNF.reduce(function(s,i){ return s + i.quantidade; }, 0);
      const marcas = [...new Set(itensNF.map(function(i){ return i.marca; }).filter(Boolean))].join(", ");
      const segs   = [...new Set(itensNF.map(function(i){ return i.segmento; }).filter(Boolean))].join(", ");
      return {
        nota_fiscal:   n.nota_fiscal,
        status:        n.status,
        data_emissao:  n.data_emissao,
        total_itens:   totalItens,
        marcas:        marcas,
        segmentos:     segs,
      };
    });

  // Pendente por Marca (colunas) x Segmento (linhas: Calçados / Vestuário)
  // Considera IMPORTADA + EM CARGA/OR + Stage
  const marcasSet = {};
  itensRegistros.forEach(function(i){
    if ((nfIdsReceb.has(i.id_nota_fiscal) || nfIdsArm.has(i.id_nota_fiscal)) && i.marca) {
      marcasSet[i.marca] = true;
    }
  });
  stageRegistros.forEach(function(i){ if (i.marca) marcasSet[i.marca] = true; });
  const marcas = Object.keys(marcasSet).sort();
  const segmentos = ["Calçados", "Vestuário"];

  function somarPendente(seg, marca) {
    // Itens das NFs IMPORTADA
    const deNFs = itensRegistros
      .filter(function(i){ return (nfIdsReceb.has(i.id_nota_fiscal) || nfIdsArm.has(i.id_nota_fiscal)) && i.segmento === seg && i.marca === marca; })
      .reduce(function(s,i){ return s + i.quantidade; }, 0);
    // Itens no Stage
    const doStage = stageRegistros
      .filter(function(i){ return i.segmento === seg && i.marca === marca; })
      .reduce(function(s,i){ return s + i.estoque_un; }, 0);
    return deNFs + doStage;
  }

  const matrizPendente = segmentos.map(function(seg){
    const valores = marcas.map(function(m){ return somarPendente(seg, m); });
    const total   = valores.reduce(function(a,b){ return a+b; }, 0);
    return { segmento: seg, marcas: marcas, valores: valores, total: total };
  });

  return {
    gerado_em:         new Date().toISOString(),
    kpis: {
      nfs_pend_recebimento:  nfsPendReceb.length,
      itens_pend_recebimento: itensPendReceb,
      nfs_pend_armazenagem:  nfsPendArm.length,
      itens_pend_armazenagem: itensPendArm,
      acumulado_recebimento_mes: totalRecebMes,
      acumulado_armazenagem_mes: totalArmMes,
    },
    recebimento_7dias: { dias: labelsDias, itens: receb7dias },
    armazenagem_7dias: { dias: labelsDias, itens: arm7dias },
    top10_nfs_fifo:    nfsPendentes,
    matriz_pendente:   matrizPendente,
    analise_automatica: null, // depende do Estoque — implementar depois
  };
}
// =========================================================
// ESTOQUE (OPERAÇÃO) + BALANÇO (GESTÃO)
// =========================================================

const CAPACIDADES = {
  "PISO 1 - A": 63840,  "PISO 1 - B": 85440,  "PISO 1 - C": 53920,
  "PISO 2 - A": 72960,  "PISO 2 - B": 87240,  "PISO 2 - C": 76360,
  "PISO 3 - A": 72960,  "PISO 3 - B": 93720,  "PISO 3 - C": 76360,
  "PISO 4 - A": 72960,  "PISO 4 - B": 93720,  "PISO 4 - C": 76000,
  "PISO 1 - E": 130464, "PISO 1 - F": 157248, "PISO 1 - G": 130176,
};

const CLASS_SAP = {
  "009-01": "Aguardando ação fiscal (Emissão NF-D)",
  "009-02": "Aguardando ação fiscal (Pedidos Loja)",
  "009-03": "Avaria (Incineração)",
  "009-04": "Material de 2° qualidade (Outlet)",
  "009-05": "Não Comercializável",
  "009-07": "Vendável Under Armour",
  "009-10": "Material em Análise",
  "009-11": "Faltas de Recebimento",
  "009-14": "Vendável Olympikus",
  "009-18": "Vendável Mizuno",
  "009-24": "Integração de NFs Reversa",
};

// Classificação WMS baseada no Setor (mapeamento da planilha de referência)
// Mapa completo de prefixo de endereço → classificação (Gabarito_Endereços_E-comm)
var GABARITO_PREFIX = {
  "K01":"Não Comercializável",
  "L05":"DExPARA (Aguardando ação fiscal)",
  "T02":"Avaria (Incineração)","T07":"Avaria (Incineração)","T08":"Avaria (Incineração)",
  "T03":"Faltas de Recebimento","V03":"Faltas de Recebimento","V04":"Faltas de Recebimento",
  "S01":"Integração de NFs Reversa","S02":"Integração de NFs Reversa","S03":"Integração de NFs Reversa",
  "S04":"Integração de NFs Reversa","S08":"Integração de NFs Reversa",
  "T01":"Integração de NFs Reversa","T04":"Integração de NFs Reversa","T05":"Integração de NFs Reversa",
  "T06":"Material de 2° qualidade (Outlet)","D02":"Material de 2° qualidade (Outlet)",
  "V05":"Material em análise","V08":"Material em análise",
};

// Classificação WMS via gabarito de endereços
// B01, B02, D01 são ambíguos: PICKING=Vendável, PULMÃO=Outlet
function classificarEnderecoWMS(local, tipoLocal) {
  var prefix = (local || "").substring(0, 3).toUpperCase();
  var tipo   = normalizarEncoding(tipoLocal || "").toUpperCase().trim();

  if (prefix === "B01" || prefix === "B02" || prefix === "D01") {
    return tipo.includes("PICKING") ? "Vendável" : "Material de 2° qualidade (Outlet)";
  }
  if (GABARITO_PREFIX[prefix]) return GABARITO_PREFIX[prefix];
  if (tipo.includes("PICKING")) return "Vendável";
  return "Outros";
}


// Helper: resolve encoding quebrado nas colunas XLSX
function montarKeyMap(linhas) {
  if (!linhas || linhas.length === 0) return {};
  var mapa = {};
  Object.keys(linhas[0]).forEach(function(k) {
    mapa[normalizarEncoding(k).toLowerCase()] = k;
  });
  return mapa;
}
function coluna(row, keyMap, nome) {
  var realKey = keyMap[normalizarEncoding(nome).toLowerCase()] || nome;
  return row[realKey];
}

// Mapeamento fixo WMS × SAP (todas as classificações, não só vendáveis)
var CROSS_MAP = [
  { bin: "009-18", sap: "Vendável Mizuno",                       wms: "Vendável Mizuno" },
  { bin: "009-14", sap: "Vendável Olympikus",                    wms: "Vendável Olympikus" },
  { bin: "009-07", sap: "Vendável Under Armour",                 wms: "Vendável Under Armour" },
  { bin: "009-03", sap: "Avaria (Incineração)",                  wms: "Avaria (Incineração)" },
  { bin: "009-10", sap: "Material em Análise",                   wms: "Material em análise" },
  { bin: "009-11", sap: "Faltas de Recebimento",                 wms: "Faltas de Recebimento" },
  { bin: "009-24", sap: "Integração de NFs Reversa",             wms: "Integração de NFs Reversa" },
  { bin: "009-04", sap: "Material de 2° qualidade (Outlet)",     wms: "Material de 2° qualidade (Outlet)" },
  { bin: "009-05", sap: "Não Comercializável",                   wms: "Não Comercializável" },
  { bin: "009-01", sap: "Aguardando ação fiscal (Emissão NF-D)", wms: "Aguardando ação fiscal" },
  { bin: "009-02", sap: "Aguardando ação fiscal (Pedidos Loja)", wms: "DExPARA (Aguardando ação fiscal)" },
];

// -------------------------------------------------------------------------
// ESTOQUE (OPERAÇÃO) — Estoque_Picking.tsv
// -------------------------------------------------------------------------
async function processarEstoqueOperacao(files, options) {
  const onProgress = (options && options.onProgress) || function(){};
  onProgress("Lendo Estoque Picking...");
  const texto = await files.arquivoEstoque.text();
  const linhas = parseTSVSelecionado(texto, ["Região", "Tipo do Local", "Barra", "Estoque (UN)"]);

  const saldoPorPiso = {};
  linhas.forEach(function(r) {
    const tipo = normalizarEncoding(r["Tipo do Local"] || "");
    if (!tipo.toUpperCase().includes("PICKING")) return;
    const regiao = normalizarEncoding(r["Região"] || "").toUpperCase().trim();
    if (!regiao.startsWith("PISO")) return;
    saldoPorPiso[regiao] = (saldoPorPiso[regiao] || 0) + (Number(r["Estoque (UN)"]) || 0);
  });

  const registros = Object.keys(CAPACIDADES).map(function(pb) {
    const saldo = saldoPorPiso[pb] || 0;
    const cap   = CAPACIDADES[pb];
    return { piso_bloco: pb, saldo: saldo, capacidade: cap, pct_ocupacao: cap > 0 ? Math.round((saldo / cap) * 100) : 0 };
  });

  onProgress("Gravando " + registros.length + " pisos/blocos...");
  await supabaseClient.from("estoque_picking").delete().neq("id", 0);
  const { error } = await supabaseClient.from("estoque_picking").insert(registros);
  if (error) console.error("Erro estoque_picking:", error);

  await salvarSnapshot("estoque", "auto", gerarPayloadEstoque(registros));
  await registrarLog("estoque", "Estoque_Picking", registros.length);
  onProgress("✓ Estoque atualizado! " + registros.length + " pisos/blocos gravados.");
}

function gerarPayloadEstoque(registros) {
  const totalSaldo = registros.reduce(function(s,r){ return s + r.saldo; }, 0);
  const totalCap   = registros.reduce(function(s,r){ return s + r.capacidade; }, 0);
  return {
    gerado_em: new Date().toISOString(),
    pisos: registros,
    total: { saldo: totalSaldo, capacidade: totalCap, pct_ocupacao: totalCap > 0 ? Math.round((totalSaldo / totalCap) * 100) : 0 },
  };
}

// -------------------------------------------------------------------------
// BALANÇO (GESTÃO) — Estoque_completo_WMS.tsv + Estoque_SAP.xlsx
// Lê WMS como TSV (mais leve que XLSX) e filtra só PICKING e PULMÃO BLOCADO
// -------------------------------------------------------------------------
async function processarBalanco(files, options) {
  const onProgress = (options && options.onProgress) || function(){};
  onProgress("Carregando bases auxiliares do Supabase...");

  // --- dim_embalas: barcode → marca  E  sku → marca ---
  const embalasBarraMap = new Map();
  const embalasSkuMap   = new Map();
  var off = 0;
  while (true) {
    const { data } = await supabaseClient.from("dim_embalas").select("codigo_barra,sku,marca").range(off, off+999);
    if (!data || data.length === 0) break;
    data.forEach(function(e) {
      if (e.codigo_barra) embalasBarraMap.set(String(e.codigo_barra).trim(), e.marca);
      if (e.sku)          embalasSkuMap.set(String(e.sku).trim(), e.marca);
    });
    if (data.length < 1000) break;
    off += 1000;
  }

  // --- dim_custo: sku → custo unitário ---
  const custoMap = new Map();
  off = 0;
  while (true) {
    const { data } = await supabaseClient.from("dim_custo").select("sku,custo_unitario").range(off, off+999);
    if (!data || data.length === 0) break;
    data.forEach(function(c) { custoMap.set(String(c.sku).trim(), Number(c.custo_unitario) || 0); });
    if (data.length < 1000) break;
    off += 1000;
  }
  onProgress("Embalas: " + embalasBarraMap.size + " barcodes | Custo: " + custoMap.size + " itens.");

  // ==================== WMS (TSV) ====================
  onProgress("Lendo Estoque WMS (TSV)...");
  const textoWMS = await files.arquivoWMS.text();
  const linhasWMS = parseTSVSelecionado(textoWMS, [
    "Setor", "Local", "Tipo do Local", "Barra", "Código do Produto", "Estoque (UN)"
  ]);
  if (!linhasWMS || linhasWMS.length === 0) { onProgress("✗ Arquivo WMS vazio."); return; }
  onProgress("WMS: " + linhasWMS.length + " linhas lidas. Classificando...");

  var wmsPorClass = {};
  linhasWMS.forEach(function(r) {
    var tipoLoc = normalizarEncoding(String(r["Tipo do Local"] || "")).toUpperCase().trim();

    // Filtrar: só PICKING e PULMÃO BLOCADO
    var isPicking = tipoLoc.includes("PICKING");
    var isPulmao  = tipoLoc.includes("PULM");
    if (!isPicking && !isPulmao) return;

    var setor   = String(r["Setor"] || "");
    var local   = String(r["Local"] || "");
    var barra   = String(r["Barra"] || "").trim();
    var codProd = String(r["Código do Produto"] || "").trim();
    var qtde    = Number(r["Estoque (UN)"]) || 0;
    if (qtde === 0) return;

    // Classificar
    var classif = classificarEnderecoWMS(local, tipoLoc);

    // Se Vendável → buscar marca
    if (classif === "Vendável") {
      var marca = embalasBarraMap.get(barra) || embalasSkuMap.get(codProd) || null;
      classif = marca ? "Vendável " + marca : "Vendável (sem marca)";
    }

    var custo = custoMap.get(codProd) || 0;
    if (!wmsPorClass[classif]) wmsPorClass[classif] = { qtde: 0, valor: 0 };
    wmsPorClass[classif].qtde  += qtde;
    wmsPorClass[classif].valor += qtde * custo;
  });

  var totalWMSQtde  = Object.values(wmsPorClass).reduce(function(s,v){ return s + v.qtde; }, 0);
  var totalWMSValor = Object.values(wmsPorClass).reduce(function(s,v){ return s + v.valor; }, 0);
  var wmsRegistros = Object.keys(wmsPorClass).map(function(c) {
    return {
      classificacao: c,
      qtde:  wmsPorClass[c].qtde,
      valor: Math.round(wmsPorClass[c].valor * 100) / 100,
      pct:   totalWMSQtde > 0 ? (wmsPorClass[c].qtde / totalWMSQtde * 100) : 0,
    };
  }).sort(function(a,b){ return b.qtde - a.qtde; });
  onProgress("WMS: " + totalWMSQtde.toLocaleString('pt-BR') + " itens em " + wmsRegistros.length + " classificações.");

  // ==================== SAP (XLSX) ====================
  onProgress("Lendo Estoque SAP...");
  const sapLinhas = await parseXLSX(files.arquivoSAP);
  var kmSap = montarKeyMap(sapLinhas);
  var sapPorBin = {};

  sapLinhas.forEach(function(r) {
    var bin  = String(coluna(r, kmSap, "Posição no depósito") || "").trim();
    var sku  = String(coluna(r, kmSap, "Nº do item") || "").trim();
    var qtde = Number(coluna(r, kmSap, "Quantidade do item")) || 0;
    if (!bin || !sku || qtde === 0) return;

    var custo   = custoMap.get(sku) || 0;
    var classif = CLASS_SAP[bin] || ("BIN " + bin);
    if (!sapPorBin[bin]) sapPorBin[bin] = { classificacao: classif, qtde: 0, valor: 0 };
    sapPorBin[bin].qtde  += qtde;
    sapPorBin[bin].valor += qtde * custo;
  });

  var totalSAPQtde  = Object.values(sapPorBin).reduce(function(s,v){ return s + v.qtde; }, 0);
  var totalSAPValor = Object.values(sapPorBin).reduce(function(s,v){ return s + v.valor; }, 0);
  var sapRegistros = Object.keys(sapPorBin).map(function(bin) {
    return {
      bin: bin, classificacao: sapPorBin[bin].classificacao,
      qtde: sapPorBin[bin].qtde, valor: Math.round(sapPorBin[bin].valor * 100) / 100,
      pct: totalSAPQtde > 0 ? (sapPorBin[bin].qtde / totalSAPQtde * 100) : 0,
    };
  }).sort(function(a,b){ return b.qtde - a.qtde; });
  onProgress("SAP: " + totalSAPQtde.toLocaleString('pt-BR') + " itens em " + sapRegistros.length + " BINs.");

  // ==================== Gravar no Supabase ====================
  onProgress("Gravando balanço...");
  await supabaseClient.from("balanco_wms").delete().neq("id", 0);
  await supabaseClient.from("balanco_sap").delete().neq("id", 0);
  for (var i = 0; i < wmsRegistros.length; i += 200) {
    var r1 = await supabaseClient.from("balanco_wms").insert(wmsRegistros.slice(i, i + 200));
    if (r1.error) console.error("Erro balanco_wms:", r1.error);
  }
  for (var j = 0; j < sapRegistros.length; j += 200) {
    var r2 = await supabaseClient.from("balanco_sap").insert(sapRegistros.slice(j, j + 200));
    if (r2.error) console.error("Erro balanco_sap:", r2.error);
  }

  // ==================== Snapshot ====================
  var payload = gerarPayloadBalanco(wmsRegistros, wmsPorClass, sapRegistros, sapPorBin, totalWMSQtde, totalWMSValor, totalSAPQtde, totalSAPValor);
  await salvarSnapshot("balanco", "auto", payload);
  await registrarLog("balanco", "Estoque_WMS.tsv + Estoque_SAP", wmsRegistros.length + sapRegistros.length);
  onProgress("✓ Balanço atualizado! WMS: " + totalWMSQtde.toLocaleString('pt-BR') + " | SAP: " + totalSAPQtde.toLocaleString('pt-BR'));
}

function gerarPayloadBalanco(wmsReg, wmsPorClass, sapReg, sapPorBin, totWMSQ, totWMSV, totSAPQ, totSAPV) {
  var cruzamento = CROSS_MAP.map(function(m) {
    var wmsD = wmsPorClass[m.wms] || { qtde: 0, valor: 0 };
    var sapD = sapPorBin[m.bin]   || { qtde: 0, valor: 0 };
    var dQ = wmsD.qtde - sapD.qtde;
    var dV = wmsD.valor - sapD.valor;
    var pct = sapD.qtde > 0 ? (dQ / sapD.qtde * 100) : (wmsD.qtde > 0 ? 100 : 0);
    return {
      classificacao: m.sap, bin: m.bin, wms_class: m.wms,
      wms_qtde: wmsD.qtde, wms_valor: Math.round(wmsD.valor * 100) / 100,
      sap_qtde: sapD.qtde, sap_valor: Math.round(sapD.valor * 100) / 100,
      diff_qtde: dQ, diff_valor: Math.round(dV * 100) / 100,
      pct: Math.round(pct * 100) / 100,
    };
  });
  return {
    gerado_em: new Date().toISOString(), cruzamento: cruzamento,
    total_wms: { qtde: totWMSQ, valor: Math.round(totWMSV * 100) / 100 },
    total_sap: { qtde: totSAPQ, valor: Math.round(totSAPV * 100) / 100 },
    estoque_wms: wmsReg, estoque_sap: sapReg,
  };
}

// -------------------------------------------------------------------------
// BASE DE CUSTO (Bases Gerais)
// -------------------------------------------------------------------------
async function processarBaseCusto(file, options) {
  const onProgress = (options && options.onProgress) || function(){};
  onProgress("Lendo Base de Custo...");
  const linhas = await parseXLSX(file);
  const registros = linhas
    .filter(function(r){ return r["Item"] && r["Custo"]; })
    .map(function(r){
      return { sku: String(r["Item"]).trim(), custo_unitario: Number(r["Custo"]) || 0 };
    });
  onProgress("Gravando " + registros.length + " SKUs de custo...");
  const LOTE = 1000;
  for (let i = 0; i < registros.length; i += LOTE) {
    const { error } = await supabaseClient.from("dim_custo").upsert(registros.slice(i, i+LOTE), { onConflict: "sku" });
    if (error) console.error("Erro dim_custo:", error);
  }
  await registrarLog("custo", file.name, registros.length);
  onProgress("✓ Base de Custo atualizada! " + registros.length + " SKUs.");
}

// =========================================================
// REVERSA — Controle_NF_Reversa.tsv + Itens_de_NF_de_Entrada.tsv
// =========================================================
async function processarRelatoriosReversa(files, options) {
  const onProgress = (options && options.onProgress) || function(){};
  onProgress("Carregando dim_embalas do Supabase...");

  // --- dim_embalas: barcode → marca, sku → marca ---
  var embalasBarraMap = new Map();
  var embalasSkuMap   = new Map();
  var off = 0;
  while (true) {
    var { data: emData } = await supabaseClient.from("dim_embalas").select("codigo_barra,sku,marca").range(off, off+999);
    if (!emData || emData.length === 0) break;
    emData.forEach(function(e) {
      if (e.codigo_barra) embalasBarraMap.set(String(e.codigo_barra).trim(), e.marca);
      if (e.sku)          embalasSkuMap.set(String(e.sku).trim(), e.marca);
    });
    if (emData.length < 1000) break;
    off += 1000;
  }
  onProgress("Embalas: " + embalasBarraMap.size + " barcodes carregados.");

  // ---- CONTROLE NF REVERSA (1 linha por NF) ----
  onProgress("Lendo Controle NF Reversa...");
  var textoControle = await files.arquivoControle.text();
  var linhasControle = parseTSVSelecionado(textoControle, [
    "Nota Fiscal", "Status", "Data de Cadastro"
  ]);

  var STATUS_PEND = { "IMPORTADA": true, "EM CARGA/OR": true };

  // Mapas auxiliares
  var nfStatusMap   = {};   // nf → status
  var nfDataMap     = {};   // nf → data de cadastro (string dd/mm/aaaa ou iso)
  var integ15dias   = {};   // "dd/mm" → {nfs: Set, itens: 0}
  var acumMensal    = {};   // "YYYY-MM" → {nfs: Set, itens: 0}

  // Calcular janela dos últimos 15 dias
  var hoje = new Date();
  var d15  = new Date(hoje); d15.setDate(hoje.getDate() - 14);

  function parseDateBR(str) {
    if (!str) return null;
    str = str.trim();
    // dd/mm/aaaa ou dd/mm/aa
    var m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
      var y = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
      return new Date(y, parseInt(m[2])-1, parseInt(m[1]));
    }
    // ISO
    var d = new Date(str);
    return isNaN(d) ? null : d;
  }

  function fmtDDMM(d) {
    return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
  }
  function fmtYYYYMM(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
  }

  linhasControle.forEach(function(r) {
    var nf     = (r["Nota Fiscal"] || "").trim();
    var status = (r["Status"] || "").trim().toUpperCase();
    var dataCadStr = r["Data de Cadastro"] || "";
    var dataCad = parseDateBR(dataCadStr);
    if (!nf) return;

    nfStatusMap[nf] = status;
    if (dataCad) nfDataMap[nf] = dataCad;

    // Integração últimos 15 dias — TODAS as NFs (IMPORTADA, EM CARGA/OR, PROCESSADA, CANCELADA)
    if (dataCad && dataCad >= d15 && dataCad <= hoje) {
      var key = fmtDDMM(dataCad);
      if (!integ15dias[key]) integ15dias[key] = { nfs: new Set(), itens: 0 };
      integ15dias[key].nfs.add(nf);
    }

    // Acumulado mensal (todas as NFs)
    if (dataCad) {
      var mes = fmtYYYYMM(dataCad);
      if (!acumMensal[mes]) acumMensal[mes] = { nfs: new Set(), itens: 0 };
      acumMensal[mes].nfs.add(nf);
    }
  });

  // Conjuntos de NFs pendentes por status
  var nfsImportada  = new Set();
  var nfsEmCarga    = new Set();
  Object.keys(nfStatusMap).forEach(function(nf) {
    var s = nfStatusMap[nf];
    if (s === "IMPORTADA")   nfsImportada.add(nf);
    if (s === "EM CARGA/OR") nfsEmCarga.add(nf);
  });
  var nfsPendentes = new Set([...nfsImportada, ...nfsEmCarga]);

  onProgress("Controle: " + nfsPendentes.size + " NFs pendentes. Lendo Itens...");

  // ---- ITENS NF ENTRADA (1 linha por item/SKU) ----
  var textoItens = await files.arquivoItens.text();
  var linhasItens = parseTSVSelecionado(textoItens, [
    "Nota Fiscal", "Status", "Quantidade", "Barra", "Código do Produto"
  ]);

  // KPIs por marca
  var kpiMarca = {};   // marca → {nfs_vinc, itens_vinc, nfs_arm, itens_arm}
  var nfsMarcaMap = {}; // nf → marca (primeira encontrada)

  // Montante pendente por marca (Bloco 3b)
  var montanteMarca = {}; // marca → {itens_vinc, itens_arm}

  var itensVinc = 0, itensArm = 0;

  // Set de TODAS as NFs do Controle (não só pendentes) para integração
  var todasNfsSet = new Set(Object.keys(nfStatusMap));

  linhasItens.forEach(function(r) {
    var nf      = (r["Nota Fiscal"] || "").trim();
    var status  = (r["Status"] || "").trim().toUpperCase();
    var qtde    = Number(r["Quantidade"]) || 0;
    var barra   = String(r["Barra"] || "").trim();
    var codProd = String(r["Código do Produto"] || "").trim();
    if (qtde === 0) return;

    // Buscar marca via embalas (para todas as NFs de reversa)
    if (todasNfsSet.has(nf)) {
      var marca = embalasBarraMap.get(barra) || embalasSkuMap.get(codProd) || "Outros";
      if (!nfsMarcaMap[nf]) nfsMarcaMap[nf] = marca;

      // Itens no gráfico integração 15 dias e acumulado mensal (TODAS as NFs)
      var dataCad = nfDataMap[nf];
      if (dataCad && dataCad >= d15 && dataCad <= hoje) {
        var key = fmtDDMM(dataCad);
        if (integ15dias[key]) integ15dias[key].itens += qtde;
      }
      if (dataCad) {
        var mes = fmtYYYYMM(dataCad);
        if (acumMensal[mes]) acumMensal[mes].itens += qtde;
      }
    }

    // KPIs e Montante: só NFs pendentes
    if (!nfsPendentes.has(nf)) return;

    // Itens globais (pendentes)
    if (status === "IMPORTADA")   itensVinc += qtde;
    if (status === "EM CARGA/OR") itensArm  += qtde;

    // Montante por marca (pendentes)
    var marcaPend = embalasBarraMap.get(barra) || embalasSkuMap.get(codProd) || "Outros";
    if (!montanteMarca[marcaPend]) montanteMarca[marcaPend] = { itens_vinc: 0, itens_arm: 0 };
    if (status === "IMPORTADA")   montanteMarca[marcaPend].itens_vinc += qtde;
    if (status === "EM CARGA/OR") montanteMarca[marcaPend].itens_arm  += qtde;
  });

  // KPIs por marca (baseado em nfsMarcaMap)
  nfsImportada.forEach(function(nf) {
    var marca = nfsMarcaMap[nf] || "Outros";
    if (!kpiMarca[marca]) kpiMarca[marca] = {nfs_vinc:0,itens_vinc:0,nfs_arm:0,itens_arm:0};
    kpiMarca[marca].nfs_vinc++;
  });
  nfsEmCarga.forEach(function(nf) {
    var marca = nfsMarcaMap[nf] || "Outros";
    if (!kpiMarca[marca]) kpiMarca[marca] = {nfs_vinc:0,itens_vinc:0,nfs_arm:0,itens_arm:0};
    kpiMarca[marca].nfs_arm++;
  });
  // Itens já contados acima — reatribuir por marca
  Object.keys(montanteMarca).forEach(function(marca) {
    if (!kpiMarca[marca]) kpiMarca[marca] = {nfs_vinc:0,itens_vinc:0,nfs_arm:0,itens_arm:0};
    kpiMarca[marca].itens_vinc = montanteMarca[marca].itens_vinc;
    kpiMarca[marca].itens_arm  = montanteMarca[marca].itens_arm;
  });

  onProgress("Itens processados. Lendo Troca E-comm...");

  // ---- TROCA E-COMM (CSV/TSV) — encoding Latin-1/CP1252 ----
  // O arquivo exportado pelo Troca E-comm usa Latin-1, não UTF-8
  var textoTroca = await new Promise(function(resolve) {
    var r = new FileReader();
    r.onload = function(e){ resolve(e.target.result); };
    r.readAsText(files.arquivoTroca, 'latin-1');
  });
  // Detectar separador (o arquivo usa TAB)
  var primLinha = textoTroca.split('\n')[0];
  var sep = primLinha.includes('\t') ? '\t' : ',';
  // Leitura do Troca E-comm por ÍNDICE FIXO (evita problemas de encoding nos nomes com acento)
  // Col 0=Loja, 1=Reversa, 2=Data de criação, 8=Status, 16=Previsão entrega, 30=Estado, 63=NF Devolução
  var linhasTrocaRaw = textoTroca.split('\n');
  var linhasTroca = [];
  for (var ti = 1; ti < linhasTrocaRaw.length; ti++) {
    var cols = linhasTrocaRaw[ti].split(sep);
    if (cols.length < 9) continue;
    linhasTroca.push({
      "Loja":            (cols[0]||"").trim(),
      "Reversa":         (cols[1]||"").trim(),
      "Data de criacao":  (cols[2]||"").trim(),
      "Status":          (cols[8]||"").trim(),
      "Previsao":        (cols[16]||"").trim(),
      "Estado":          (cols[30]||"").trim(),
      "NF Devolucao":    (cols[63]||"").trim()
    });
  }
  console.log("Troca E-comm:", linhasTroca.length, "linhas lidas por indice fixo");

  // Previsão de entrega (próximos 15 dias) — exceto Cancelado
  var prevEntrega = {}; // "dd/mm" → count
  var hoje15 = new Date(hoje); hoje15.setDate(hoje.getDate() + 14);

  // Mapa estado → {nfs: Set} para mapa do Brasil
  var mapaEstados = {};

  // Reversas pendentes por marca (Bloco 3c)
  var reversasPend = {}; // marca → count

  linhasTroca.forEach(function(r) {
    var status = (r["Status"] || "").trim();
    if (status === "Cancelado") return;

    var loja   = (r["Loja"] || "").trim();
    var reversa= (r["Reversa"] || "").trim();
    var estado = (r["Estado"] || "").trim();
    var nfDev  = (r["NF Devolucao"] || "").trim();

    // Marca a partir da Loja (remove " - Marketplace", aspas, etc.)
    var marca = loja.replace(/\s*-\s*Marketplace/i,'').replace(/\s*-\s*Pedidos manuais.*/i,'').replace(/["\']/g,'').trim();
    if (!marca) marca = "Outros";

    // Reversas pendentes de chegada
    if (!reversasPend[marca]) reversasPend[marca] = 0;
    reversasPend[marca]++;

    // Mapa estados (acumulado)
    if (estado) {
      if (!mapaEstados[estado]) mapaEstados[estado] = { count: 0 };
      mapaEstados[estado].count++;
    }

    // Previsão de entrega
    var prevStr = (r["Previsao"] || "").trim();
    var dataCriacao = parseDateBR(r["Data de criacao"]);
    var dataPrevisao;
    if (prevStr) {
      dataPrevisao = parseDateBR(prevStr);
    } else if (dataCriacao) {
      dataPrevisao = new Date(dataCriacao);
      dataPrevisao.setDate(dataPrevisao.getDate() + 7);
    }
    if (dataPrevisao && dataPrevisao >= hoje && dataPrevisao <= hoje15) {
      var key = fmtDDMM(dataPrevisao);
      prevEntrega[key] = (prevEntrega[key] || 0) + 1;
    }
  });

  // ---- Montar séries de datas para gráficos ----
  // Integração 15 dias: gerar array de 15 dias corridos
  var integSerie = [];
  for (var d = 0; d < 15; d++) {
    var dt = new Date(d15);
    dt.setDate(d15.getDate() + d);
    var key = fmtDDMM(dt);
    var bucket = integ15dias[key] || { nfs: new Set(), itens: 0 };
    integSerie.push({ data: key, nfs: bucket.nfs.size, itens: bucket.itens });
  }

  // Previsão 15 dias: gerar array de 15 dias futuros
  var prevSerie = [];
  for (var d2 = 0; d2 < 15; d2++) {
    var dt2 = new Date(hoje);
    dt2.setDate(hoje.getDate() + d2);
    var key2 = fmtDDMM(dt2);
    prevSerie.push({ data: key2, reversas: prevEntrega[key2] || 0 });
  }

  // Acumulado mensal: ordenar por mês
  var acumSerie = Object.keys(acumMensal).sort().map(function(mes) {
    return { mes: mes, nfs: acumMensal[mes].nfs.size, itens: acumMensal[mes].itens };
  });

  // Montante por marca como array ordenado
  var montanteArr = Object.keys(montanteMarca).map(function(m) {
    return {
      marca: m,
      itens_vinc: montanteMarca[m].itens_vinc,
      itens_arm:  montanteMarca[m].itens_arm,
      total: montanteMarca[m].itens_vinc + montanteMarca[m].itens_arm
    };
  }).sort(function(a,b){ return b.total - a.total; });

  // Reversas pendentes como array
  var reversasPendArr = Object.keys(reversasPend).map(function(m) {
    return { marca: m, qtde: reversasPend[m] };
  }).sort(function(a,b){ return b.qtde - a.qtde; });

  // ---- Payload final ----
  var payload = {
    gerado_em: new Date().toISOString(),
    kpis: {
      total: {
        nfs_vinculacao:   nfsImportada.size,
        itens_vinculacao: itensVinc,
        nfs_armazenagem:  nfsEmCarga.size,
        itens_armazenagem: itensArm,
        nfs_total:   nfsPendentes.size,
        itens_total: itensVinc + itensArm,
      },
      por_marca: kpiMarca,
    },
    integracao_15dias: integSerie,
    previsao_15dias:   prevSerie,
    acumulado_mensal:  acumSerie,
    montante_marca:    montanteArr,
    reversas_pendentes: reversasPendArr,
    mapa_estados:      mapaEstados,
  };

  await salvarSnapshot("reversa", "auto", payload);
  await registrarLog("reversa", "Controle_NF_Reversa + Itens_NF_Entrada + Troca_Ecomm", nfsPendentes.size);

  onProgress("✓ Reversa atualizada! " + nfsPendentes.size + " NFs pendentes | " + (itensVinc+itensArm).toLocaleString('pt-BR') + " itens.");
}

// Helper: parseTSV com separador customizável
// Matching robusto: remove acentos para comparar nomes de colunas
function stripAccents(s) {
  return (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// Fallback: inferir marca pelo nome/descrição do item quando dim_embalas não retorna marca
function inferirMarcaPorDescricao(descricao) {
  var d = normalizarEncoding(String(descricao || "")).toUpperCase();
  if (/MIZUNO|\bMIZ\b/.test(d))                    return "Mizuno";
  if (/UNDER ARMOUR|\bUA\b|UNDERARMOUR/.test(d))   return "Under Armour";
  if (/OLYMPIKUS|\bOLY\b|\bOLK\b/.test(d))       return "Olympikus";
  if (/OPANKA/.test(d))                              return "Opanka";
  return null;
}
function parseTSVComSep(texto, sep, colsDesejadas) {
  var linhas = texto.split('\n');
  if (linhas.length === 0) return [];
  var header = linhas[0].split(sep).map(function(h){ return h.trim().replace(/^\ufeff/,''); });
  var idxMap = {};
  colsDesejadas.forEach(function(col) {
    var normCol = stripAccents(col);
    var idx = header.findIndex(function(h){ return stripAccents(h) === normCol; });
    if (idx >= 0) idxMap[col] = idx;
  });
  console.log("parseTSVComSep — colunas encontradas:", Object.keys(idxMap).join(", "), "| não encontradas:", colsDesejadas.filter(function(c){ return !(c in idxMap); }).join(", ") || "nenhuma");
  var resultado = [];
  for (var i = 1; i < linhas.length; i++) {
    var row = linhas[i].split(sep);
    if (row.length < 2) continue;
    var obj = {};
    colsDesejadas.forEach(function(col) {
      var idx = idxMap[col];
      obj[col] = idx !== undefined ? (row[idx] || "").trim() : "";
    });
    resultado.push(obj);
  }
  return resultado;
}
