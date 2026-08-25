/* ============================================================================
   REPORT DISTRIBUIDORA — ingest.js
   ============================================================================
   RESPONSABILIDADE ÚNICA: ler o arquivo-fonte, cruzar/agregar os dados e
   GRAVAR o resultado já pronto no Supabase.

   Este arquivo NUNCA desenha nada na tela. Não há document.querySelector,
   não há innerHTML, não há manipulação de DOM aqui. A comunicação com a
   interface acontece por callback (onProgresso), passado pelo index.html.
   Regra herdada do Report E-commerce (README seção 1) e tratada como
   inegociável: se um ajuste é sobre COMO algo aparece, ele pertence ao
   index.html; se é sobre COMO o número é calculado, ele pertence aqui.
   ============================================================================ */

/* ----------------------------------------------------------------------------
   PARSE DO ARQUIVO — "POSICAO DO STOCK - LOCAIS STOCKAGEM" (EX000914)
   ----------------------------------------------------------------------------
   O arquivo é um relatório de terminal em LARGURA FIXA, paginado, com um
   cabeçalho repetido a cada página. Não é CSV, não é TSV: separar por espaço
   quebra, porque a descrição do artigo tem espaços dentro dela.

   As colunas foram medidas na própria linha de régua do relatório
   (a linha de underscores logo abaixo do cabeçalho das colunas):

     0-1     St            VS | VN | IN | IS
     4-94    Artigo        campo composto, ver COLUNAS_ARTIGO abaixo
     97-100  Um            PAR | UN
     103-114 Armazem       "EXTRE/AC190"  (estabelecimento / armazém)
     117-130 Local         (vem vazio nesta extração)
     133-148 Stock Mínimo
     151-167 Qtd. Stock
     170-181 Preço Médio
     184-200 Valor Stock

   Dentro do campo "Artigo" (largura 90) há quatro subcampos de largura fixa:
     0-13    código do artigo   ("43224430", "OBMA261923", "BFR0402N")
     13-20   cor                ("ARENIT", "PRETO", "BCO/BD")
     20-26   tamanho            ("38", "39/44", "GG", "U")
     26-fim  descrição

   A família NÃO está na linha do produto: ela vem em uma linha "Familia ...:"
   no cabeçalho de cada página e vale para todas as linhas seguintes até a
   próxima. Por isso o parser mantém `familiaAtual` como estado enquanto varre.
   ---------------------------------------------------------------------------- */

const COLUNAS_LINHA = {
  st:        [0, 2],
  artigo:    [4, 94],
  um:        [97, 100],
  armazem:   [103, 114],
  local:     [117, 130],
  stockMin:  [133, 148],
  qtd:       [151, 167],
  precoMed:  [170, 181],
  valor:     [184, 200],
};

const COLUNAS_ARTIGO = {
  codigo:    [0, 13],
  cor:       [13, 20],
  tamanho:   [20, 26],
  descricao: [26, 90],
};

const STATUS_VALIDOS = ['VS', 'VN', 'IN', 'IS'];

/* Número no formato brasileiro do relatório: "1.502,490" → 1502.49
   Campo vazio vira 0 (e não NaN, que contaminaria toda a soma a jusante). */
function numeroBR(texto) {
  const s = String(texto || '').trim();
  if (!s) return 0;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function fatia(linha, faixa) {
  return linha.substring(faixa[0], faixa[1]).trim();
}

/* Mês abreviado em português do cabeçalho ("Ago.25,26" = 25/ago/2026). */
const MESES_ABREV = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5,
  jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
};

function parsearDataCabecalho(texto) {
  const m = String(texto).match(/([A-Za-z]{3})\.(\d{1,2}),(\d{2,4})/);
  if (!m) return null;
  const mes = MESES_ABREV[m[1].toLowerCase()];
  if (mes === undefined) return null;
  const dia = Number(m[2]);
  let ano = Number(m[3]);
  if (ano < 100) ano += 2000;
  // Data-calendário pura (sem hora): montada em UTC para não escorregar de dia
  // quando o navegador do operador estiver em outro fuso.
  return new Date(Date.UTC(ano, mes, dia));
}

/**
 * Varre o TXT inteiro e devolve as linhas de produto + os metadados do
 * relatório. Não toca no banco e não depende de nada externo — é uma função
 * pura, o que a torna fácil de testar isoladamente quando um número divergir.
 */
function parsearRelatorioEstoque(textoArquivo) {
  const linhas = textoArquivo.split(/\r?\n/);
  const registros = [];
  const familiasVistas = new Map();

  let familiaAtual = null;
  let dataExtracao = null;
  let estabelecimento = null;
  let totalGeralQtd = null;
  let totalGeralValor = null;
  let totaisFamiliaSistema = new Map();

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim()) continue;

    // --- cabeçalho: família corrente ---
    const mFam = linha.match(/^Familia\s*\.*:\s*(\S+)\s+(.*)$/);
    if (mFam) {
      familiaAtual = { codigo: mFam[1].trim(), nome: mFam[2].trim() };
      familiasVistas.set(familiaAtual.codigo, familiaAtual.nome);
      continue;
    }

    // --- cabeçalho: data da extração e estabelecimento (repetem a cada página) ---
    if (!dataExtracao) {
      const d = parsearDataCabecalho(linha);
      if (d) dataExtracao = d;
    }
    if (!estabelecimento) {
      const mEst = linha.match(/Estabel\s*\.*:\s*(\S+)/);
      if (mEst) estabelecimento = mEst[1].trim();
    }

    // --- linhas de total impressas pelo próprio sistema ---
    // São usadas só para CONFERÊNCIA (o parser soma por conta própria).
    // Se batem, temos prova de que a leitura de largura fixa está correta.
    if (linha.indexOf('**') !== -1) {
      const mGeral = linha.match(/\*\* TOTAL GERAL[\s.]*:\s*([\d.,]+)\s+([\d.,]+)/);
      if (mGeral) {
        totalGeralQtd = numeroBR(mGeral[1]);
        totalGeralValor = numeroBR(mGeral[2]);
      }
      const mFamTot = linha.match(/\*\* TOTAL FAMILIA\s+(\S+)[\s.]*:\s*([\d.,]+)\s+([\d.,]+)/);
      if (mFamTot) {
        totaisFamiliaSistema.set(mFamTot[1], {
          qtd: numeroBR(mFamTot[2]),
          valor: numeroBR(mFamTot[3]),
        });
      }
      continue;
    }

    // --- linha de produto ---
    const st = fatia(linha, COLUNAS_LINHA.st);
    if (STATUS_VALIDOS.indexOf(st) === -1) continue;
    if (!familiaAtual) continue; // defensivo: produto antes de qualquer família

    const campoArtigo = linha.substring(COLUNAS_LINHA.artigo[0], COLUNAS_LINHA.artigo[1]);
    const armazemBruto = fatia(linha, COLUNAS_LINHA.armazem); // "EXTRE/AC190"
    const partesArm = armazemBruto.split('/');
    const estab = (partesArm[0] || '').trim();
    // Há linhas no arquivo real em que o armazém vem em branco ("EXTRE/").
    // Elas NÃO são descartadas: viram SEM_ARMAZEM e aparecem no dashboard como
    // um bloco próprio. Estoque escondido é pior do que estoque estranho.
    const armazem = (partesArm[1] || '').trim() || 'SEM_ARMAZEM';

    registros.push({
      status_artigo:   st,
      familia_codigo:  familiaAtual.codigo,
      familia_nome:    familiaAtual.nome,
      estabelecimento: estab,
      armazem:         armazem,
      artigo_codigo:   fatia(campoArtigo, COLUNAS_ARTIGO.codigo),
      cor:             fatia(campoArtigo, COLUNAS_ARTIGO.cor),
      tamanho:         fatia(campoArtigo, COLUNAS_ARTIGO.tamanho),
      descricao:       fatia(campoArtigo, COLUNAS_ARTIGO.descricao),
      unidade:         fatia(linha, COLUNAS_LINHA.um),
      qtd:             numeroBR(fatia(linha, COLUNAS_LINHA.qtd)),
      preco_medio:     numeroBR(fatia(linha, COLUNAS_LINHA.precoMed)),
      valor:           numeroBR(fatia(linha, COLUNAS_LINHA.valor)),
    });
  }

  return {
    registros: registros,
    familias: familiasVistas,
    data_extracao: dataExtracao,
    estabelecimento: estabelecimento,
    total_geral_sistema: { qtd: totalGeralQtd, valor: totalGeralValor },
    totais_familia_sistema: totaisFamiliaSistema,
  };
}

/* ----------------------------------------------------------------------------
   DEDUPLICAÇÃO ANTES DO INSERT (README 3.2)
   ----------------------------------------------------------------------------
   No arquivo real de 25.371 linhas a chave natural
   (status × família × armazém × artigo × cor × tamanho) é única — foi
   conferido. Mas o relatório é paginado e o layout pode mudar; se uma extração
   futura repetir a chave, o insert em lote estouraria 409 de conflito.

   Diferença importante em relação ao caso do e-commerce: lá o correto era
   MANTER o registro "mais avançado" por prioridade de status. Aqui as linhas
   repetidas seriam duas posições do MESMO SKU no MESMO armazém, então o
   correto é SOMAR as quantidades e os valores — descartar uma delas perderia
   estoque real. O preço médio é recalculado como média ponderada pela
   quantidade, não simplesmente sobrescrito.
   ---------------------------------------------------------------------------- */
function deduplicarPosicoes(registros) {
  const porChave = new Map();
  let colisoes = 0;

  registros.forEach(function (r) {
    const chave = [
      r.status_artigo, r.familia_codigo, r.armazem,
      r.artigo_codigo, r.cor, r.tamanho,
    ].join('|');

    const existente = porChave.get(chave);
    if (!existente) {
      porChave.set(chave, Object.assign({}, r));
      return;
    }
    colisoes++;
    const qtdTotal = existente.qtd + r.qtd;
    existente.preco_medio = qtdTotal > 0
      ? (existente.preco_medio * existente.qtd + r.preco_medio * r.qtd) / qtdTotal
      : existente.preco_medio;
    existente.qtd = qtdTotal;
    existente.valor += r.valor;
  });

  return { registros: Array.from(porChave.values()), colisoes: colisoes };
}

/* ----------------------------------------------------------------------------
   PAGINAÇÃO SEGURA (README 3.1)
   ----------------------------------------------------------------------------
   O PostgREST tem um teto próprio de linhas por resposta (tipicamente 1000),
   INDEPENDENTE do tamanho pedido em .range(). Comparar "voltou menos do que
   pedi" com "acabou" foi a causa raiz do bug em que um card mostrava 100% de
   um único segmento no report do e-commerce. Aqui a regra é: só para quando a
   página vier VAZIA, e o offset avança pelo tamanho REAL retornado.
   ---------------------------------------------------------------------------- */
async function lerTudoPaginado(supabaseClient, tabela, colunas, aplicarFiltros) {
  const LOTE = 5000;
  let offset = 0;
  const tudo = [];
  while (true) {
    let q = supabaseClient.from(tabela).select(colunas).range(offset, offset + LOTE - 1);
    if (aplicarFiltros) q = aplicarFiltros(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;   // só "voltou zero" significa "acabou"
    tudo.push.apply(tudo, data);
    offset += data.length;                   // avança pelo que voltou de verdade
  }
  return tudo;
}

/* ----------------------------------------------------------------------------
   UPLOAD DO ARQUIVO ORIGINAL COMPRIMIDO (README 3.4)
   ----------------------------------------------------------------------------
   O TXT bruto tem ~10 MB. Comprimido em gzip cai para uma fração disso, o que
   evita o erro 400 de "tamanho excede o limite" do Storage. O fallback para o
   upload cru cobre navegador sem CompressionStream.
   ---------------------------------------------------------------------------- */
async function uploadArquivoOriginal(supabaseClient, caminho, file) {
  try {
    const cs = new CompressionStream('gzip');
    const comprimido = await new Response(file.stream().pipeThrough(cs)).blob();
    const { error } = await supabaseClient.storage
      .from('backups')
      .upload(caminho + '.gz', comprimido, { contentType: 'application/gzip', upsert: true });
    if (error) throw error;
    return caminho + '.gz';
  } catch (e) {
    try {
      const { error } = await supabaseClient.storage
        .from('backups').upload(caminho, file, { upsert: true });
      if (error) throw error;
      return caminho;
    } catch (e2) {
      // Backup é auditoria, não é o dado. Falhar aqui não pode derrubar a
      // ingestão inteira — o snapshot ainda vale. Registra e segue.
      console.warn('Backup do arquivo original falhou:', e2);
      return null;
    }
  }
}

/* ----------------------------------------------------------------------------
   AGREGAÇÃO — MONTAGEM DO SNAPSHOT
   ----------------------------------------------------------------------------
   Aqui é onde o índice do dashboard nasce PRONTO. A hierarquia definida com a
   operação é: 1º Armazém → 2º Marca → 3º Família.

   Toda linha da árvore carrega qtd, valor e o % de participação EM RELAÇÃO AO
   PAI (não ao total geral): dentro de um armazém, os percentuais das marcas
   somam 100%; dentro de uma marca, os das famílias somam 100%. Foi a leitura
   que o modelo do dash financeiro sugere e a que responde à pergunta que a
   gestão faz de verdade ("quanto desse armazém é Mizuno?").
   ---------------------------------------------------------------------------- */
function pct(parte, total) {
  return total > 0 ? (parte / total) * 100 : 0;
}

function novoNo(codigo, nome) {
  // `st` guarda o mesmo total quebrado por status do artigo (VS/VN/IN/IS).
  // Existe para que o filtro de status do dashboard seja uma SOMA de baldes já
  // calculados, e não um recálculo de regra de negócio no navegador — o
  // index.html continua só somando o que já veio pronto (README seção 1.2).
  return { codigo: codigo, nome: nome, qtd: 0, valor: 0, skus: 0, st: {}, filhos: new Map() };
}

function acumular(no, r) {
  no.qtd += r.qtd;
  no.valor += r.valor;
  no.skus += 1;
  const b = no.st[r.status_artigo] || (no.st[r.status_artigo] = { qtd: 0, valor: 0, skus: 0 });
  b.qtd += r.qtd;
  b.valor += r.valor;
  b.skus += 1;
}

function construirSnapshotEstoque(registros, mapaFamilias, mapaArmazens, meta) {
  // --- árvore Armazém → Marca → Família ---
  const raiz = new Map();
  const porStatus = new Map();
  const porMarca = new Map();
  const familiasNaoMapeadas = new Set();

  registros.forEach(function (r) {
    const infoFam = mapaFamilias.get(r.familia_codigo);
    const marca = infoFam ? infoFam.marca : 'NAO MAPEADA';
    if (!infoFam) familiasNaoMapeadas.add(r.familia_codigo);
    const nomeFam = (infoFam && infoFam.nome) || r.familia_nome || r.familia_codigo;

    if (!raiz.has(r.armazem)) raiz.set(r.armazem, novoNo(r.armazem, r.armazem));
    const nArm = raiz.get(r.armazem);
    acumular(nArm, r);

    if (!nArm.filhos.has(marca)) nArm.filhos.set(marca, novoNo(marca, marca));
    const nMarca = nArm.filhos.get(marca);
    acumular(nMarca, r);

    if (!nMarca.filhos.has(r.familia_codigo)) {
      nMarca.filhos.set(r.familia_codigo, novoNo(r.familia_codigo, nomeFam));
    }
    acumular(nMarca.filhos.get(r.familia_codigo), r);

    if (!porStatus.has(r.status_artigo)) porStatus.set(r.status_artigo, novoNo(r.status_artigo, r.status_artigo));
    acumular(porStatus.get(r.status_artigo), r);

    if (!porMarca.has(marca)) porMarca.set(marca, novoNo(marca, marca));
    acumular(porMarca.get(marca), r);
  });

  const totalQtd = registros.reduce(function (s, r) { return s + r.qtd; }, 0);
  const totalValor = registros.reduce(function (s, r) { return s + r.valor; }, 0);

  // Ordem dos armazéns vem do gabarito (dim_armazens.ordem) — decisão de
  // negócio, não alfabética. Armazém desconhecido cai no fim, mas aparece.
  function ordemArmazem(cod) {
    const info = mapaArmazens.get(cod);
    return info ? info.ordem : 95;
  }

  const armazens = Array.from(raiz.values())
    .sort(function (a, b) { return ordemArmazem(a.codigo) - ordemArmazem(b.codigo); })
    .map(function (nArm) {
      const infoArm = mapaArmazens.get(nArm.codigo);
      return {
        codigo: nArm.codigo,
        nome: (infoArm && infoArm.descricao) || 'Armazém não cadastrado no gabarito',
        categoria: (infoArm && infoArm.categoria) || 'NAO_MAPEADO',
        qtd: nArm.qtd,
        valor: nArm.valor,
        skus: nArm.skus,
        st: nArm.st,
        pct_qtd: pct(nArm.qtd, totalQtd),
        pct_valor: pct(nArm.valor, totalValor),
        marcas: Array.from(nArm.filhos.values())
          .sort(function (a, b) { return b.valor - a.valor; })
          .map(function (nMarca) {
            return {
              codigo: nMarca.codigo,
              nome: nMarca.nome,
              qtd: nMarca.qtd,
              valor: nMarca.valor,
              skus: nMarca.skus,
              st: nMarca.st,
              pct_qtd: pct(nMarca.qtd, nArm.qtd),
              pct_valor: pct(nMarca.valor, nArm.valor),
              familias: Array.from(nMarca.filhos.values())
                .sort(function (a, b) { return b.valor - a.valor; })
                .map(function (nFam) {
                  return {
                    codigo: nFam.codigo,
                    nome: nFam.nome,
                    qtd: nFam.qtd,
                    valor: nFam.valor,
                    skus: nFam.skus,
                    st: nFam.st,
                    pct_qtd: pct(nFam.qtd, nMarca.qtd),
                    pct_valor: pct(nFam.valor, nMarca.valor),
                  };
                }),
            };
          }),
      };
    });

  function listaSimples(mapa, total) {
    return Array.from(mapa.values())
      .sort(function (a, b) { return b.valor - a.valor; })
      .map(function (n) {
        return {
          codigo: n.codigo, nome: n.nome, qtd: n.qtd, valor: n.valor, skus: n.skus, st: n.st,
          pct_qtd: pct(n.qtd, total.qtd), pct_valor: pct(n.valor, total.valor),
        };
      });
  }

  // --- conferência contra o total impresso pelo próprio sistema ---
  // Uma diferença de centavos é esperada: o sistema soma os valores já
  // arredondados linha a linha. Uma diferença de QUANTIDADE, não — essa
  // significaria linha perdida no parse, e o dashboard mostra o alerta.
  const sis = meta.total_geral_sistema || {};
  const conferencia = {
    qtd_parseada: totalQtd,
    valor_parseado: totalValor,
    qtd_sistema: sis.qtd,
    valor_sistema: sis.valor,
    diff_qtd: sis.qtd != null ? totalQtd - sis.qtd : null,
    diff_valor: sis.valor != null ? totalValor - sis.valor : null,
    ok: sis.qtd != null ? Math.abs(totalQtd - sis.qtd) < 0.001 : null,
  };

  return {
    versao: 1,
    gerado_em: new Date().toISOString(),          // UTC puro (README 3.3)
    arquivo: meta.arquivo_nome,
    data_extracao: meta.data_extracao ? meta.data_extracao.toISOString().slice(0, 10) : null,
    estabelecimento: meta.estabelecimento,
    total: {
      qtd: totalQtd,
      valor: totalValor,
      skus: registros.length,
      artigos: new Set(registros.map(function (r) { return r.artigo_codigo; })).size,
      preco_medio: totalQtd > 0 ? totalValor / totalQtd : 0,
    },
    armazens: armazens,
    por_marca: listaSimples(porMarca, { qtd: totalQtd, valor: totalValor }),
    por_status: listaSimples(porStatus, { qtd: totalQtd, valor: totalValor }),
    familias_nao_mapeadas: Array.from(familiasNaoMapeadas),
    conferencia: conferencia,
  };
}

/* ----------------------------------------------------------------------------
   ORQUESTRAÇÃO
   ----------------------------------------------------------------------------
   Fluxo completo de uma atualização de estoque. O index.html chama só isto.
   `onProgresso` é o único canal de saída para a interface — nenhuma escrita
   direta no DOM acontece aqui.
   ---------------------------------------------------------------------------- */
const LOTE_INSERT = 500;

async function processarEstoque(supabaseClient, file, onProgresso) {
  const avisar = onProgresso || function () {};

  avisar('Lendo arquivo…');
  const texto = await file.text();

  avisar('Interpretando o relatório (largura fixa)…');
  const parsed = parsearRelatorioEstoque(texto);
  if (parsed.registros.length === 0) {
    throw new Error(
      'Nenhuma linha de produto reconhecida. Confira se o arquivo é a extração ' +
      'EX000914 "POSICAO DO STOCK - LOCAIS STOCKAGEM" sem reformatação.'
    );
  }

  const dedup = deduplicarPosicoes(parsed.registros);
  avisar(
    parsed.registros.length.toLocaleString('pt-BR') + ' linhas lidas' +
    (dedup.colisoes ? ' (' + dedup.colisoes + ' somadas por chave repetida)' : '') + '.'
  );

  // --- dimensões (com paginação segura, mesmo sendo tabelas pequenas hoje) ---
  avisar('Carregando gabaritos de armazém e família…');
  const [linhasArm, linhasFam] = await Promise.all([
    lerTudoPaginado(supabaseClient, 'dim_armazens', 'codigo, descricao, categoria, ordem'),
    lerTudoPaginado(supabaseClient, 'dim_familias', 'codigo, nome, marca, categoria'),
  ]);
  const mapaArmazens = new Map(linhasArm.map(function (a) { return [a.codigo, a]; }));
  const mapaFamilias = new Map(linhasFam.map(function (f) { return [f.codigo, f]; }));

  // --- cabeçalho da extração ---
  const totQtd = dedup.registros.reduce(function (s, r) { return s + r.qtd; }, 0);
  const totValor = dedup.registros.reduce(function (s, r) { return s + r.valor; }, 0);

  avisar('Registrando a extração…');
  const { data: extracao, error: errExtracao } = await supabaseClient
    .from('estoque_extracoes')
    .insert({
      arquivo_nome: file.name,
      data_extracao: parsed.data_extracao ? parsed.data_extracao.toISOString().slice(0, 10) : null,
      estabelecimento: parsed.estabelecimento,
      gerado_em: new Date().toISOString(),        // UTC — conversão só na exibição
      linhas_lidas: dedup.registros.length,
      qtd_total_parseada: totQtd,
      valor_total_parseado: totValor,
      qtd_total_sistema: parsed.total_geral_sistema.qtd,
      valor_total_sistema: parsed.total_geral_sistema.valor,
    })
    .select('id')
    .single();
  if (errExtracao) throw errExtracao;

  // --- fato, em lotes ---
  const paraInserir = dedup.registros.map(function (r) {
    const infoFam = mapaFamilias.get(r.familia_codigo);
    return {
      extracao_id: extracao.id,
      status_artigo: r.status_artigo,
      familia_codigo: r.familia_codigo,
      marca: infoFam ? infoFam.marca : 'NAO MAPEADA',
      armazem: r.armazem,
      estabelecimento: r.estabelecimento,
      artigo_codigo: r.artigo_codigo,
      cor: r.cor,
      tamanho: r.tamanho,
      descricao: r.descricao,
      unidade: r.unidade,
      qtd: r.qtd,
      preco_medio: r.preco_medio,
      valor: r.valor,
    };
  });

  for (let i = 0; i < paraInserir.length; i += LOTE_INSERT) {
    const lote = paraInserir.slice(i, i + LOTE_INSERT);
    const { error } = await supabaseClient.from('estoque_posicoes').insert(lote);
    if (error) throw error;
    avisar('Gravando posições… ' +
      Math.min(i + LOTE_INSERT, paraInserir.length).toLocaleString('pt-BR') +
      ' / ' + paraInserir.length.toLocaleString('pt-BR'));
  }

  // --- snapshot pronto para renderizar ---
  avisar('Consolidando o snapshot…');
  const payload = construirSnapshotEstoque(dedup.registros, mapaFamilias, mapaArmazens, {
    arquivo_nome: file.name,
    data_extracao: parsed.data_extracao,
    estabelecimento: parsed.estabelecimento,
    total_geral_sistema: parsed.total_geral_sistema,
  });

  const { error: errSnap } = await supabaseClient.from('dashboard_snapshots').insert({
    pagina: 'estoque',
    payload: payload,
    gerado_em: new Date().toISOString(),
    extracao_id: extracao.id,
  });
  if (errSnap) throw errSnap;

  // --- backup do original (não bloqueia o resultado) ---
  avisar('Enviando backup do arquivo original…');
  const caminho = 'estoque/' + new Date().toISOString().slice(0, 10) + '/' + file.name;
  const storagePath = await uploadArquivoOriginal(supabaseClient, caminho, file);
  if (storagePath) {
    await supabaseClient.from('estoque_extracoes')
      .update({ storage_path: storagePath }).eq('id', extracao.id);
  }

  avisar('Concluído.');
  return payload;
}

/* Exposto no escopo global porque o index.html é single-file sem bundler —
   mesma abordagem do Report E-commerce. */
window.processarEstoque = processarEstoque;
window.parsearRelatorioEstoque = parsearRelatorioEstoque;
window.construirSnapshotEstoque = construirSnapshotEstoque;
window.deduplicarPosicoes = deduplicarPosicoes;
