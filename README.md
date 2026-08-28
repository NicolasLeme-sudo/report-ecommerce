# Report E-commerce — Vulcabras

Dashboard executivo de operação de armazém (CD Vulcabras — Extrema/MG) para
acompanhamento de Outbound, Inbound, Estoque, Reversa e Balanço WMS×SAP do
e-commerce. Este documento não é só um manual de uso: é o registro do
**processo** usado para construir o projeto — decisões de arquitetura, por que
cada padrão técnico existe, quais bugs reais ele resolveu, e como replicar
esse mesmo processo para um novo contexto (ex.: recriar o projeto para uma
distribuidora, com fluxo de dados diferente mas a mesma base tecnológica e a
mesma identidade visual).

Se você está lendo isto para **recriar o projeto em outro contexto**, vá
direto para [Recriando para um novo contexto](#recriando-para-um-novo-contexto-ex-distribuidora).
O restante do documento explica o "porquê" de cada peça, que é o que você vai
precisar decidir de novo lá.

---

## 1. Visão geral da arquitetura

O projeto é deliberadamente simples em número de peças, e deliberadamente
rígido na separação de responsabilidades entre elas:

```
 Planilhas/exports do WMS, SAP, Forecast, etc.
              │
              │  (upload manual, feito pelo operador no navegador)
              ▼
        ┌───────────────┐
        │   ingest.js    │   Lê os arquivos, cruza dados, calcula os
        │  (processa e   │   indicadores, grava tudo já pronto no banco.
        │   só escreve)  │   NUNCA desenha nada na tela.
        └───────┬────────┘
                │  grava
                ▼
        ┌───────────────┐
        │   Supabase     │   Postgres (dados estruturados) +
        │ (Postgres +    │   Storage (backup dos arquivos originais,
        │  Storage)      │   comprimidos em gzip)
        └───────┬────────┘
                │  lê (snapshot já pronto)
                ▼
        ┌───────────────┐
        │  index.html    │   Lê o snapshot mais recente e desenha os
        │ (renderiza e   │   cards/gráficos/tabelas. NUNCA processa ou
        │   só lê)       │   recalcula regra de negócio.
        └───────────────┘
                │
                ▼
         Vercel (hospedagem estática do index.html)
```

**Por que essa separação existe (e por que ela não é opcional):**

No início do projeto, cálculo e renderização estavam misturados no mesmo
arquivo. Isso criava dois problemas recorrentes: (1) qualquer ajuste visual
arriscava re-executar lógica de negócio sem querer, e (2) toda vez que a base
crescia, a tela travava porque o navegador do operador tentava reprocessar
tudo a cada carregamento. A solução foi mover **todo** o processamento pesado
para um script único (`ingest.js`), rodado uma vez por atualização de dados,
que grava o resultado já pronto como um "snapshot" (JSON) no Postgres. O
`index.html` ficou livre para ser burro e rápido: ele só busca o snapshot mais
recente da página que está exibindo e desenha. Essa regra foi reforçada
várias vezes ao longo do desenvolvimento e deve ser tratada como **inegociável**
em qualquer evolução futura — inclusive na recriação para a distribuidora.

### 1.1. `ingest.js` — processamento

- Roda no navegador do operador (upload manual dos arquivos-fonte: NFs,
  pedidos, forecast, posição de estoque, etc.).
- Faz todo o cruzamento de dados: de-duplicação de registros, cálculo de
  KPIs, fechamento de expedição diária, cruzamento WMS×SAP para o Balanço,
  etc.
- Grava o resultado em `dashboard_snapshots` — uma tabela com uma linha por
  `pagina` (`outbound`, `inbound`, `estoque`, `reversa`, `balanco`), cada
  linha contendo o JSON já pronto para renderizar e um timestamp
  `gerado_em` (sempre gravado como `new Date().toISOString()`, ou seja, UTC).
- Também sobe uma cópia comprimida (gzip) do arquivo original para o
  Supabase Storage, para fins de auditoria/histórico — ver
  [3.4](#34-compressão-gzip-para-arquivos-grandes).
- **Nunca** deve conter `document.querySelector`, manipulação de DOM, ou
  qualquer coisa relacionada a exibir informação na tela. Se um ajuste pede
  para "mudar como algo aparece", ele pertence ao `index.html`, não a este
  arquivo — mesmo que pareça mais fácil calcular ali.

### 1.2. `index.html` — renderização

- Single-file: HTML + CSS + JS embutidos (sem build step, sem bundler —
  hospedado como estático puro no Vercel).
- Busca em `dashboard_snapshots` o registro mais recente de cada `pagina` e
  desenha os cards, tabelas e gráficos a partir do JSON já pronto.
- Contém a lógica de UI: troca de tema (claro/escuro), navegação entre
  seções, controle de acesso por perfil (ver [seção 5](#5-controle-de-acesso-por-perfil)),
  formatação de datas para exibição, exportação de tabelas.
- **Nunca** deve recalcular uma regra de negócio que já veio pronta do
  snapshot. Se um número está errado na tela, o primeiro lugar a investigar é
  o `ingest.js` (como o número foi calculado), não o `index.html` (como ele é
  exibido) — essa distinção economizou bastante tempo de debug ao longo do
  projeto.

### 1.3. Supabase (Postgres + Storage)

- Projeto na região `ca-central-1`.
- Tabela central: `dashboard_snapshots` (uma linha "mais recente" por
  `pagina`, versionada por `gerado_em`).
- Tabelas de apoio por domínio (NFs, itens, embalagens/`dim_embalas`, pedidos
  etc.) — o `ingest.js` lê e escreve nelas antes de consolidar o snapshot.
- Storage: bucket para os arquivos originais enviados (comprimidos), usado
  como backup/auditoria — não é lido pelo `index.html`.
- **Segurança de dado de verdade é responsabilidade do Postgres (RLS — Row
  Level Security), não do front-end.** Isso é tratado em detalhe na
  [seção 5](#5-controle-de-acesso-por-perfil) porque é um ponto que ficou
  pendente neste projeto e não deve se repetir na recriação.

### 1.4. Vercel

- Hospeda o `index.html` como site estático. Sem variáveis de ambiente
  sensíveis no build — as credenciais do Supabase usadas pelo `index.html`
  são a `anon key` pública (protegida por RLS no backend, não por estar
  "escondida" no front).
- Deploy automático a partir da branch de produção do repositório GitHub.

---

## 2. Identidade visual

A identidade visual segue a skill **`vulcabras-visual-identity`** como base
oficial (paleta, tipografia, padrão de cards, logos). Ela foi adaptada neste
projeto ao longo de várias rodadas de ajuste solicitadas pela gerência —
essas adaptações **fazem parte do padrão atual do projeto** e devem ser
herdadas por qualquer recriação, não tratadas como "customização única do
report da Vulcabras".

### 2.1. Paleta institucional (estado atual, pós-ajustes)

Os tokens abaixo substituem/estendem os tokens-base da skill. A skill define
o padrão de marca (`--accent-gold`, `--positive`, `--negative`,
`--brand-miz/oly/ua`); o dashboard precisou de tokens adicionais para cobrir
o vocabulário próprio de KPI de armazém (status de NF, ocupação, backlog
FIFO), mantendo a mesma lógica de "cor tem significado, não é decoração".

**Tema escuro (padrão):**

```css
--olive:       #45C645;  /* positivo institucional (equivalente a --positive da skill) */
--olive-soft:  #1B3320;  /* fundo suave para badges/linhas positivas */
--amber:       #F6BD00;  /* atenção / --accent-gold da skill */
--amber-soft:  #332B10;
--red:         #C8102E;  /* negativo institucional (equivalente a --negative da skill) */
--red-soft:    #331015;
--accent:      #297ADF;  /* azul institucional (--brand-oly da skill), usado como
                             accent secundário fora do contexto de marca Olympikus */
--accent-soft: #16283F;
--gelo:        #93A5B8;  /* neutro/"sem dado"/"livre" — --text-secondary da skill */
--laranja:     #E8830D;  /* estado intermediário (alerta antes do vermelho) */
```

**Tema claro (alternativo):**

```css
--olive:       #2E9E2E;
--olive-soft:  #E4F3E4;
--amber:       #C9960A;
--amber-soft:  #FBF0D9;
--red:         #C0392B;
--red-soft:    #FBE4E1;
--accent:      #1A6FC4;
--accent-soft: #EFF6FF;
--gelo:        #8FA3B8;
--laranja:     #C26A00;
```

**Regra de aplicação (decidida em rodada de ajuste com a gerência, "pode
aplicar em tudo"):** qualquer barra de destaque de KPI card, badge de status,
ou indicador de card **deve** usar esses tokens — nunca uma cor solta
hard-coded. Isso vale mesmo para elementos que a skill, no padrão genérico,
recomendaria como "neutros sem cor decorativa" (ex.: a barra lateral de
destaque dos KPI cards, `.kpi-card .bar`) — no caso deste dashboard esse
padrão de barra é anterior à adoção da skill e foi mantido e recolorido em
vez de removido, por já ser uma referência visual reconhecida pelos usuários
do report. Ao recriar o projeto do zero (sem esse legado visual), prefira
seguir a skill à risca e **não** introduzir barras decorativas novas.

### 2.2. Caso especial: paleta do Backlog FIFO (semáforo)

O gráfico de donut "Backlog FIFO" (dias 01 / 02 / 03 / 04+ em aberto) passou
por uma rodada de ajuste dedicada. A primeira proposta (verde-água) foi
rejeitada por gerar confusão visual com o indicador de "positivo". A versão
aprovada usa lógica de **semáforo institucional**, com uma exceção
explicitamente pedida pela gerência:

```js
// Dia 01 fica no tom de oliva ORIGINAL do gráfico (fixo, não usa var(--olive) —
// essa variável virou o verde institucional mais vivo depois do ajuste de
// paleta geral, e a gerência pediu para manter especificamente neste gráfico
// o tom que já existia antes, para não perder a referência visual de quem já
// lê esse card no dia a dia).
// Dia 02/03/04+ seguem a rampa de semáforo institucional.
const cores = {
  '01':  '#6B7F3A',       // oliva fixo, histórico do gráfico — NÃO trocar por var(--olive)
  '02':  'var(--amber)',
  '03':  'var(--laranja)',
  '04+': 'var(--red)',
};
```

**Lição para a recriação:** nem toda paleta institucional se aplica 1:1 a
todo componente. Quando um usuário/gestora já tem uma leitura visual
consolidada de um gráfico específico, vale preservar aquele tom mesmo que ele
destoe levemente do restante da paleta — documentando o motivo no código,
como acima, para que a próxima pessoa não "corrija" isso sem contexto.

### 2.3. Tipografia, cards e logos

Seguem a skill sem alteração:
- Fonte: `Segoe UI` (fallback `"Segoe UI Semibold", Roboto, "Helvetica Neue", Arial, sans-serif`).
- Cards neutros: fundo `--card-bg`, borda 1px `--card-border`, cantos ~8px,
  sem sombra pesada.
- Kicker em caixa alta + linha fina dourada abaixo do título de seção.
- Logos brancas (Vulcabras, Mizuno, Olympikus, Under Armour) — aplicar o
  filtro CSS de tingimento em azul institucional no tema claro (ver skill,
  seção "Logos").

### 2.4. Padrão de "linha de total" em tabelas

Ajuste feito neste projeto (bug real: a última linha de uma tabela era
estilizada como total só por ser a última, mesmo quando era um registro
comum — ex. Top 10 NFs do FIFO mostrava a 10ª NF com aparência de "total
geral"). Corrigido trocando o seletor CSS de posição por uma classe
semântica:

```css
/* ANTES (errado — estilizava por posição): */
table.matrix tbody tr:last-child td { ... }

/* DEPOIS (correto — estilizado por semântica): */
table.matrix tbody tr.total td,
table.matrix tbody tr.total th {
  border-top: 2px solid var(--accent);
  background: var(--bg-input);
  font-weight: 700;
}
```

E a classe `class="total"` foi adicionada explicitamente só nas linhas que
**são de fato** totais/somatórios, em cada função de renderização
(`renderMatriz`, `renderMatrizPendente`, `renderizarBalanco`,
`renderizarEstoque`). **Padrão a seguir em qualquer tabela nova:** nunca
estilizar "a última linha" por CSS posicional — sempre marcar a linha de
total com uma classe explícita no HTML gerado.

---

## 3. Padrões de engenharia (e os bugs reais que cada um resolveu)

Esta seção documenta decisões técnicas que não são óbvias olhando só o código
final — o valor de registrá-las é evitar reintroduzir os mesmos bugs numa
recriação do zero.

### 3.1. Paginação segura contra o limite de linhas do PostgREST

**Sintoma real que isso corrigiu:** o card "Itens por Segmento" (Outbound)
começou a mostrar 100% "Calçados", escondendo os outros 4 segmentos reais
(Chinelos, Acessórios, Vestuários, Meias — confirmado por comparação com
outro sistema). Causa raiz: o Supabase/PostgREST limita a quantidade de
linhas retornadas por requisição a um teto do próprio servidor (comumente
1000), **independente do tamanho pedido em `.range()`**. O código antigo
decidia "acabou a paginação" comparando o tamanho da página retornada com o
tamanho do **lote pedido** — então, ao pedir lotes de 5000, a primeira página
já vinha com só 1000 linhas (o teto do servidor), o código interpretava isso
como "só tem 1000 registros no total" e parava, quando na verdade a tabela
tinha ~263 mil linhas.

**Padrão correto** (usado agora em toda paginação do `ingest.js`): parar
somente quando a página vier **vazia**, e avançar o offset pelo **tamanho
real** retornado, nunca pelo tamanho do lote pedido:

```js
const mapa = new Map();
let offset = 0;
const LOTE = 5000; // tamanho pedido — pode ser maior que o teto do servidor, sem problema
while (true) {
  const { data, error } = await supabaseClient
    .from("dim_embalas")
    .select("codigo_barra, segmento, marca")
    .range(offset, offset + LOTE - 1);
  if (error || !data || data.length === 0) break;   // só para quando NÃO vem nada
  data.forEach(function (e) {
    mapa.set(String(e.codigo_barra).trim(), { segmento: e.segmento, marca: e.marca });
  });
  offset += data.length;   // avança pelo que voltou de verdade, não pelo LOTE pedido
}
```

**Regra para qualquer paginação nova (nesta ou em outra base):** nunca
assumir que "voltou menos que pedi" significa "acabou". Só "voltou zero"
significa "acabou".

### 3.2. Deduplicação antes de inserir (evita 409 de conflito)

**Sintoma real:** erros 409 no console ao reprocessar `inbound_nfs` /
`inbound_itens` — a mesma NF aparecia mais de uma vez no arquivo-fonte, em
estágios de status diferentes (ex.: `IMPORTADA` → `EM CARGA/OR` →
`PROCESSADA`), e o insert em lote tentava gravar a mesma chave duas vezes.

**Padrão:** antes de inserir, reduzir a lista para um registro por chave
natural, mantendo o "mais avançado" segundo uma ordem de prioridade de
status:

```js
const prioridadeStatusNF = { "IMPORTADA": 0, "EM CARGA/OR": 1, "PROCESSADA": 2 };
const nfPorId = new Map();
linhas.forEach(function (r) {
  const reg = { id_nota_fiscal: Number(r["idNotaFiscal"]), status: r["status"], /* ... */ };
  const existente = nfPorId.get(reg.id_nota_fiscal);
  if (!existente || prioridadeStatusNF[reg.status] > prioridadeStatusNF[existente.status]) {
    nfPorId.set(reg.id_nota_fiscal, reg);
  }
});
const nfRegistros = Array.from(nfPorId.values());
```

Esse padrão já existia em outro ponto do `ingest.js` (`pedido_itens`) antes
deste ajuste — a correção foi replicar o mesmo raciocínio para `inbound_nfs`.
**Ao adaptar para outro fluxo de dados:** qualquer entidade que possa
aparecer mais de uma vez no arquivo-fonte por causa de mudança de status
precisa desse tratamento antes do insert.

### 3.3. Data/hora sempre calculada com fuso horário explícito

**Sintoma real:** o horário exibido no topbar e no histórico de versões
ficava errado (a lógica antiga fazia aritmética manual de "-3 horas", que
quebra em horário de verão e com formatos de timestamp inconsistentes vindos
do banco).

**Padrão:** normalizar o timestamp como UTC explícito e formatar com
`Intl.DateTimeFormat` fixando o timezone de destino — nunca subtrair/somar
horas manualmente:

```js
function paraDataBR(isoStr) {
  let s = String(isoStr).replace(' ', 'T');
  if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';   // assume UTC se não vier timezone
  return new Date(s);
}
function componentesDataBR(isoStr) {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(paraDataBR(isoStr));
  const m = {};
  partes.forEach(p => { m[p.type] = p.value; });
  return m;
}
function formatarDataBR(isoStr) {
  const c = componentesDataBR(isoStr);
  return `${c.day}/${c.month}/${c.year} ${c.hour}:${c.minute}`;
}
```

Toda gravação de timestamp no `ingest.js` usa `new Date().toISOString()`
(UTC puro) — a conversão para horário de Brasília acontece **só** na
exibição, no `index.html`, nunca na gravação. **Regra para recriar em outra
região/fuso:** trocar apenas o `timeZone: 'America/Sao_Paulo'` — o resto do
padrão (gravar em UTC, converter só na exibição) vale para qualquer fuso.

### 3.4. Compressão gzip para arquivos grandes

**Sintoma real:** erros 400 de "tamanho excede o limite" ao subir os
arquivos originais (TSV) para o Supabase Storage como backup.

**Padrão:** comprimir no navegador antes do upload, com fallback silencioso
para o upload cru caso a compressão falhe (compatibilidade com navegadores
antigos e com arquivos já enviados sem compressão antes deste ajuste):

```js
async function uploadArquivoOriginal(caminho, file) {
  try {
    const cs = new CompressionStream('gzip');
    const comprimido = await new Response(file.stream().pipeThrough(cs)).blob();
    await supabaseClient.storage.from('backups').upload(caminho, comprimido, {
      contentType: 'application/gzip',
    });
  } catch (e) {
    // fallback: navegador sem suporte a CompressionStream, ou erro na compressão
    await supabaseClient.storage.from('backups').upload(caminho, file);
  }
}
```

No download (`baixarArquivoOriginal`), o processo é o inverso — tenta
`DecompressionStream('gzip')` e cai para o blob cru se falhar, cobrindo os
arquivos que foram enviados antes deste padrão existir.

### 3.5. Backfill automático de 7 dias (Expedição)

**Sintoma real:** o card "Forecast × Expedição" nunca mostrava o dado de
sexta-feira, mesmo depois de reprocessar a base — o fechamento diário só
rodava para "hoje", então se o operador reprocessava numa segunda, a
sexta-feira nunca tinha sido fechada.

**Padrão:** em vez de fechar só o dia corrente, o `ingest.js` percorre os
últimos 7 dias a cada execução e fecha (ou refaz) o fechamento de cada um,
tornando o processo auto-recuperável independente de quando o operador rodar
a atualização:

```js
const hoje = new Date();
for (let diasAtras = 1; diasAtras <= 7; diasAtras++) {
  const dAlvo = new Date(hoje);
  dAlvo.setDate(hoje.getDate() - diasAtras);
  await fecharExpedicaoDoDia(pedidos, paraDataISOLocal(dAlvo));
}
```

### 3.6. Reconciliação: nenhuma categoria pode sumir em silêncio

**Sintoma real:** o Balanço WMS×SAP e a tabela "Estoque WMS — Detalhado"
mostravam totais diferentes (1.270.011 vs 1.273.397). A diferença de 3.386
era exatamente uma linha — "Aguardando ação fiscal (Emissão NF-D)" —
aparecendo com o valor certo no detalhado e **zerada** no balanço.

Causa raiz: o cruzamento do balanço é montado a partir de uma lista fixa
(`CROSS_MAP`) que traduz o nome da classificação no WMS para o BIN
equivalente no SAP. A chave do lado WMS estava escrita como
`"Aguardando ação fiscal"`, sem o sufixo `"(Emissão NF-D)"` que a regra de
classificação no Postgres realmente produz. A busca não encontrava a chave,
caía no default `{ qtde: 0 }` — e **não gerava erro nenhum**. O volume
simplesmente evaporava do balanço.

Esse é o pior tipo de bug para um relatório de conferência: o número errado
não parece errado. Duas defesas foram adicionadas:

**1. Rede de segurança** — qualquer classificação do WMS ou BIN do SAP que
não esteja no `CROSS_MAP` é anexada ao cruzamento como linha própria, em vez
de descartada:

```js
var wmsCobertas = {}, sapCobertos = {};
CROSS_MAP.forEach(function (m) { wmsCobertas[m.wms] = true; sapCobertos[m.bin] = true; });

Object.keys(wmsPorClass).forEach(function (c) {
  if (wmsCobertas[c]) return;
  var d = wmsPorClass[c];
  if (!d.qtde && !d.valor) return;
  console.warn("Balanço: classificação do WMS fora do CROSS_MAP:", c, d);
  cruzamento.push(montarLinha(c + " (sem BIN no SAP)", "—", c, d, { qtde: 0, valor: 0 }));
});
// ...e o espelho equivalente para BINs do SAP fora do CROSS_MAP
```

**2. Conferência de fechamento** — depois de montar o cruzamento, os totais
são comparados com os totais gerais; divergência vira erro no console
durante a atualização de base, em vez de virar um número errado na tela:

```js
var confWMS = cruzamento.reduce(function (s, r) { return s + r.wms_qtde; }, 0);
var confSAP = cruzamento.reduce(function (s, r) { return s + r.sap_qtde; }, 0);
if (confWMS !== totWMSQ || confSAP !== totSAPQ) {
  console.error("Balanço: divergência de reconciliação! ...");
}
```

**Regra para a recriação:** todo relatório que cruza duas fontes através de
uma tabela de-para fixa precisa dessas duas defesas. Uma lista de tradução
escrita à mão **vai** ficar dessincronizada da regra que gera os nomes — a
questão é só quando. O sistema tem que reagir a isso mostrando a sobra, nunca
descartando-a.

**Regra irmã (ver 7.1):** quando a mesma regra de negócio existe em dois
lugares — a function no Postgres e o espelho em JS —, os dois precisam ser
alterados juntos. Foi essa dessincronização que produziu o gabarito errado de
endereços antes deste mesmo bug.

### 3.7. Defasagem de etapa entre sistemas não é divergência de estoque

**Situação real:** o Balanço mostrava a classificação "Integração de NFs
Reversa" com 2.214 itens no WMS contra 78.022 no SAP (BIN 009-24) — uma
divergência enorme que não representava perda nenhuma.

Causa: uma NF de reversa entra no SAP assim que é recebida fiscalmente, mas
só aparece no arquivo de estoque do WMS depois de ser **fisicamente
armazenada** num endereço. Entre os dois momentos, a NF fica com status
`IMPORTADA` ou `EM CARGA/OR` — existe no SAP, ainda não existe em endereço do
WMS. Comparar os dois lados sem considerar isso transforma uma diferença de
*tempo de processo* em aparente diferença de *saldo*.

**Padrão:** o lado WMS recebe o saldo pendente somado à classificação
correspondente, com três cuidados:

1. **A fonte é o snapshot mais recente da área dona do dado**, não um número
   digitado à mão. O fluxo da Reversa já calculava esse pendente
   (`IMPORTADA` + `EM CARGA/OR`); bastou publicá-lo no payload dela
   (`pendente_integracao`) e o Balanço passar a consumi-lo.
2. **Ler sempre o último snapshot publicado, mesmo que não seja de hoje.** Se
   a Reversa não foi atualizada, vale o último número que ela divulgou — o
   Balanço não pode ficar sem o ajuste só porque a outra área não rodou.
3. **A data de origem do número vai junto e aparece na tela.** Um número
   defasado precisa ser visível, não silencioso — é um relatório de
   conferência. Quando o ajuste não existe no snapshot, a tela avisa em
   âmbar em vez de simplesmente mostrar o valor menor.

O valor em R$ do ajuste é calculado com a **mesma base de custo** (`dim_custo`)
que o resto do Balanço usa, para os dois lados não saírem de réguas
diferentes.

**Regra para a recriação:** antes de tratar qualquer divergência entre dois
sistemas como erro, mapear as **etapas de processo** entre eles. Toda vez que
um sistema registra um evento antes do outro, existe um saldo em trânsito que
precisa entrar na conta explicitamente. Vale perguntar à operação, para cada
classificação: *"existe algum momento em que isso já está num sistema e ainda
não está no outro?"*

### 3.8. Exportação sob demanda: consulta ao vivo, não snapshot

**Situação real:** o report diário do operador (enviado por e-mail à
diretoria) usava dois arquivos montados à mão no Excel — um PROCV do pedido
do WMS contra o `Primário` do SAP para extrair Pedido VTEX e valor, e um
filtro manual de pedidos com 3+ dias de backlog. Automatizamos os dois como
botões de exportação.

A decisão de design aqui é diferente dos outros exports do projeto (que
sempre baixam de novo o arquivo original do Storage, sem processar nada). Os
dois botões do report diário fazem algo nunca feito antes no projeto:
**consultam a tabela `pedidos` ao vivo** e montam a planilha `.xlsx` na hora,
no navegador, com SheetJS (já carregado para ler `.xlsx` de entrada — reaproveitado
aqui para escrever). Motivo: o PROCV do usuário já existia dentro do
`ingest.js` (`sapPorPedido`, ver 1.1), só não persistia os dois campos que o
report precisava — bastou persistir e consultar, sem inventar um cálculo novo
nem um snapshot novo só para isso.

Dois cuidados replicam padrões já estabelecidos neste documento:

- **Paginação por página vazia** (3.1), porque a consulta de pedidos abertos
  passa de 1.000 linhas — o mesmo teto do PostgREST que já causou um bug real
  neste projeto.
- **O de-para de marketplace (acrônimo → razão social) é o mesmo já usado em
  `ingest.js`** para os cards, replicado em `index.html` só para o rótulo do
  arquivo exportado — é leitura de apoio para exibição, não recálculo de
  regra de negócio, então não fere a separação da seção 1.

**Regra para a recriação:** nem toda exportação precisa de um snapshot
dedicado. Quando o dado já está numa tabela relacional e a extração é
simplesmente "filtra e formata", uma consulta ao vivo no clique do botão é
mais simples e sempre está atualizada — reserve o padrão de snapshot
pré-calculado (seção 1) para o que realmente precisa de agregação pesada.

### 3.9. "Em operação" é derivado, nunca persistido como status fixo

**Situação real:** um pedido específico (parado desde 14/08) apareceu nas
exportações do report diário sem Pedido VTEX/Valor, e sumido do gráfico de
Backlog FIFO na tela — dois sintomas aparentemente sem relação, mesma causa.

Causa: `pedidos.situacao` era escrito como `"ABERTO"` a cada processamento e
**nunca mais tocado** se aquele pedido parasse de aparecer no arquivo
`Acompanhamento_Op` do dia seguinte (resolvido por outro caminho, corrigido
manualmente, etc.). O campo ficava congelado em `"ABERTO"` para sempre — um
registro fantasma. A tela nunca mostrava esse pedido (o payload é calculado
do zero a cada rodada, só com o que está no arquivo do dia), mas qualquer
consulta nova que confiasse no `situacao` já persistido no banco (como as
exportações, que precisam buscar o dado ao vivo — ver 3.8) herdava o
fantasma.

**Padrão:** "em operação" não é um status que se grava e mantém — é uma
pergunta que se refaz a cada consulta: *"este pedido está no Acompanhamento_Op
da atualização mais recente?"* Implementado com um timestamp de rodada, não
com um booleano:

```js
// ingest.js — um único timestamp por rodada inteira do Outbound
const momentoOpIso = hoje.toISOString();
// ... por linha, só quando vem do Acompanhamento_Op (nunca do Exp):
presente_no_op_em: linha.origem === "Acompanhamento_Op" ? momentoOpIso : null,
```

Toda consulta que precisa de "pedidos em operação agora" primeiro descobre o
`presente_no_op_em` mais recente da tabela, depois filtra por igualdade a
esse valor — nunca por `situacao = 'ABERTO'` sozinho:

```js
// index.html — antes de qualquer exportação
const ultimoOp = /* MAX(presente_no_op_em) */;
supabaseClient.from('pedidos').select(colunas)
  .eq('situacao', 'ABERTO')
  .eq('presente_no_op_em', ultimoOp);
```

Um pedido que sumir do Acompanhamento_Op deixa de contar automaticamente na
próxima rodada — sem precisar de uma limpeza manual, uma tarefa agendada, ou
qualquer processo separado para "fechar" registros órfãos. O mesmo raciocínio
vale para o KPI computado dentro do próprio `ingest.js`: o filtro passou a
checar `presente_no_op_em` explicitamente, em vez de confiar só em
`situacao`, para nunca acidentalmente herdar algo vindo do
`Acompanhamento_Exp` (fonte diferente — Exp só informa o que já saiu ou foi
cancelado, nunca decide quem está em operação).

**Regra para a recriação:** qualquer campo que representa "isto ainda é
válido/atual" é um candidato a virar registro fantasma se for gravado como
status fixo em vez de recalculado. Prefira sempre uma pergunta derivada
("está presente na fonte mais recente?") a um campo que alguém precisa
lembrar de atualizar ou limpar.

---

## 4. Regra de posicionamento: onde entra cada novo indicador

Ao longo do projeto surgiu um padrão implícito de decisão que vale
explicitar: **todo indicador numérico que soma/fecha um agrupamento
(capacidade, estoque, balanço) ganha uma linha "Total Geral" separada por uma
borda sutil, abaixo dos indicadores individuais** — nunca escondido dentro de
um dos indicadores existentes. Exemplo: nos cards de Capacidade × Ocupação
(Calçados/Vestuário), a soma de "Ocupado + Livre" ganhou uma linha própria de
"Total Geral" abaixo de "Livre":

```js
// dentro de renderizarEstoque(), por segmento (Calçados/Vestuário)
// segCalc.cap / segVest.cap já vêm prontos do snapshot do ingest.js
`<div class="linha-total" style="border-top:1px solid var(--border); line-height:1.2">
   <span>Total Geral</span><span>${segCalc.cap}</span>
 </div>`
```

Esse padrão de "não sobrecarregar um indicador existente, sempre abrir uma
linha nova para o total" deve ser seguido para qualquer card de capacidade ou
ocupação que a distribuidora venha a precisar.

---

## 5. Controle de acesso por perfil

O modelo de perfil hoje é `perfis_acesso` (Supabase) — tabela que mapeia
`user_id` → `role`, com três valores possíveis: `admin`, `gestor`, e o padrão
implícito de operador (qualquer usuário sem role elevada).

### 5.1. Camada de front-end (implementada)

`aplicarVisibilidadeMenu()` esconde grupos inteiros do menu lateral conforme
o perfil:

```js
function aplicarVisibilidadeMenu() {
  const labels = document.querySelectorAll('.sidebar-section-label');
  labels.forEach(label => {
    const nome = label.textContent.trim();
    let visivel = true;
    if (nome === 'Gestão') visivel = (perfilAtual === 'gestor' || perfilAtual === 'admin');
    if (nome === 'Admin')  visivel = (perfilAtual === 'admin');
    label.style.display = visivel ? '' : 'none';
    let irmao = label.nextElementSibling;
    while (irmao && !irmao.classList.contains('sidebar-section-label') && !irmao.classList.contains('sidebar-historico')) {
      irmao.style.display = visivel ? '' : 'none';
      irmao = irmao.nextElementSibling;
    }
  });

  // Reversa é um caso à parte: mora dentro do grupo "Operação" (visível a
  // todo mundo por padrão), mas o acesso a ela é restrito só ao Admin — nem
  // Gestão vê. Por isso é tratado fora do loop acima, sobrescrevendo o que o
  // grupo "Operação" definiu para esse item específico.
  const menuReversa = document.getElementById('menuReversa');
  if (menuReversa) menuReversa.style.display = (perfilAtual === 'admin') ? '' : 'none';
}
```

Segunda trava, no roteamento de seção — cobre o caso de alguém forçar a
navegação manualmente (ex. console do navegador), não só esconder o botão:

```js
function mostrarSecao(secao) {
  if (secao === 'reversa' && perfilAtual !== 'admin') return;
  // ...segue o fluxo normal de troca de seção
}
```

### 5.2. Camada de dado (Postgres RLS) — **pendente, não implementada nesta sessão**

Isto precisa ficar registrado com destaque: as duas travas acima protegem
**a interface**, não o dado. Um usuário com o `anon key` público e
conhecimento técnico ainda pode consultar a API do Supabase diretamente e, se
a tabela não tiver uma **RLS policy** que restrinja a leitura por `role`, o
dado de Reversa (ou qualquer outro dado sensível) continua acessível via API
mesmo com o menu escondido.

**Antes de considerar o controle de acesso "completo" — nesta base ou numa
recriação —, é obrigatório:**
1. Habilitar RLS nas tabelas relevantes (`dashboard_snapshots` filtrado por
   `pagina`, e quaisquer tabelas de detalhe de Reversa).
2. Criar policies que verifiquem o `role` do usuário autenticado (via
   `perfis_acesso` ou via custom claim no JWT) antes de liberar `SELECT`.
3. Testar diretamente pela API (não só pela tela) que um usuário não-admin
   recebe vazio/erro ao tentar ler dados de Reversa.

Isso não foi verificado neste projeto por falta de acesso de execução SQL na
sessão em que o ajuste foi feito — **é o primeiro item de segurança a
resolver ao dar início à recriação para a distribuidora**, para não herdar a
mesma lacuna.

---

## 6. Fluxo de trabalho de desenvolvimento (como este projeto evoluiu)

Documentar o processo de trabalho é tão importante quanto o código, porque é
o que deve se repetir na recriação:

1. **Toda mudança começa como pedido da gerência/operação, geralmente com
   print de tela ou de console.** Não há especificação formal — o processo é
   : usuário mostra o sintoma (visual ou erro de console) → se traduz isso em
   causa raiz antes de tocar em código.
2. **Mudança visual não sai direto para o arquivo final.** Para qualquer
   ajuste de aparência (cor, layout, novo componente), o padrão adotado foi
   gerar antes um **mockup/artefato isolado** (HTML avulso, fora do
   `index.html` de produção) e obter aprovação explícita antes de aplicar no
   arquivo real. Isso evitou retrabalho em pelo menos dois ajustes deste
   projeto (paleta do FIFO, card de capacidade).
3. **Bug de dado sempre se investiga primeiro no `ingest.js`, nunca no
   `index.html`.** Como a renderização só lê o que já veio pronto, um número
   errado na tela quase sempre nasce no cálculo, não na exibição — foi assim
   com o bug do "Itens por Segmento" (paginação) e com o dos 409 de NF
   duplicada.
4. **Erros de console reportados pelo usuário são tratados como bug de
   produção, não como ruído.** Cada erro relatado (409, 400 de tamanho,
   paginação incompleta) virou um item de correção com causa raiz
   documentada, não um "silenciar o erro".
5. **Toda entrega para validação em produção é feita como arquivo completo**,
   não como instrução de "aplique você mesmo" — o usuário sobe manualmente no
   Vercel/GitHub e valida com dado real antes do próximo ajuste.
6. **Commits carregam contexto técnico, não só "o que" mudou.** Mensagens de
   commit deste projeto documentam a causa raiz e, quando relevante, uma
   ressalva explícita de limitação (ex. o commit da restrição de Reversa
   registra que a RLS não foi verificada). Isso é o que tornou possível
   escrever esta seção do README meses depois sem perder o racional.

---

## 7. Recriando para um novo contexto (ex.: distribuidora)

O pedido que originou este README foi: recriar o projeto para **a
distribuidora**, mantendo a base técnica e a identidade visual, mas com
diferenças claras de **processo e fluxo de dados** em relação ao CD Vulcabras
Extrema-MG. Este é o roteiro para fazer isso sem perder os aprendizados
acima.

### 7.1. O que se mantém 100%

- **Arquitetura de 3 camadas**: `ingest.js` (processa e escreve) /
  Supabase (armazena) / `index.html` (lê e renderiza). Não misturar
  responsabilidades, mesmo que o novo contexto pareça "mais simples" no
  começo.
- **Identidade visual**: skill `vulcabras-visual-identity` como base, com os
  tokens de paleta já ajustados na [seção 2](#2-identidade-visual) (inclusive
  a exceção do oliva fixo no gráfico de FIFO, se a distribuidora também tiver
  um indicador de backlog por dias em aberto).
- **Padrões de engenharia** da [seção 3](#3-padrões-de-engenharia-e-os-bugs-reais-que-cada-um-resolveu):
  paginação segura, deduplicação antes de insert, data em UTC + conversão só
  na exibição, gzip para upload grande.
- **Modelo de perfil de acesso** (admin/gestor/operador) como ponto de
  partida — mas resolvendo a RLS desde o início desta vez (ver 7.3).
- **Fluxo de trabalho** da [seção 6](#6-fluxo-de-trabalho-de-desenvolvimento-como-este-projeto-evoluiu):
  mockup antes de aplicar, investigar cálculo antes de exibição, commits com
  causa raiz.

### 7.2. O que precisa ser levantado de novo (processo/fluxo)

Isto é o que muda de fato entre "CD de e-commerce da Vulcabras" e
"distribuidora" — não são detalhes técnicos, são decisões de negócio que
determinam o schema e as seções do dashboard:

- **Quais são as seções/páginas equivalentes?** O projeto atual tem
  Outbound, Inbound, Estoque, Reversa, Balanço WMS×SAP — todas nascidas do
  fluxo de operação de um CD de e-commerce (separação, conferência,
  expedição, devolução). Uma distribuidora provavelmente tem um fluxo
  diferente (ex.: pedido de revenda, romaneio, faturamento por
  representante, prazo de entrega por transportadora) — **é preciso
  levantar com quem opera esse fluxo hoje** antes de desenhar as seções,
  do mesmo jeito que este projeto nasceu de conversa direta com a operação
  do CD.
- **Quais sistemas de origem alimentam os dados?** Aqui é WMS + SAP +
  Forecast. Na distribuidora pode ser um ERP diferente, ou uma única fonte.
  Isso muda inteiramente o parsing em `ingest.js` (nomes de coluna, formatos
  de arquivo, frequência de atualização) — mas não muda o padrão de como
  processar (dedup, paginação segura, etc.).
- **Qual é a régua de FIFO/backlog equivalente?** Se a distribuidora tem
  conceito de pedido parado há N dias, o padrão de semáforo se aplica
  diretamente — mas os "dias de corte" (01/02/03/04+) podem não fazer
  sentido no novo fluxo (ex. pode ser por semana, não por dia). Redefinir os
  cortes com quem opera antes de portar o componente.
  <br>Se a distribuidora **não** tiver um card de FIFO equivalente, a
  exceção do "oliva fixo" documentada na seção 2.2 simplesmente não se
  aplica — não force esse padrão onde não há necessidade.
- **Quem são os perfis reais de acesso?** `admin` / `gestor` / `operador`
  fazia sentido no CD porque reflete a hierarquia real de quem usa o
  report. Confirmar se a distribuidora tem a mesma hierarquia ou outra
  (ex. representante comercial, coordenador de logística, financeiro) —
  o padrão de código (esconder grupo de menu + trava de rota +
  **RLS no banco**) se replica, os nomes de `role` e as regras de "quem vê o
  quê" precisam ser levantados de novo.
- **Qual é o volume e a frequência de atualização dos dados?** Isso
  determina se os padrões de paginação/gzip são necessários desde o dia 1
  ou se podem ser adicionados depois — mas como já são conhecidos e
  resolvidos aqui, o recomendado é implementá-los desde o início e evitar
  repetir os mesmos dois bugs (paginação e limite de tamanho de upload).

### 7.3. Checklist de partida para a recriação

1. Criar novo projeto Supabase dedicado (não reaproveitar o projeto do CD —
   dados de contextos diferentes não devem compartilhar banco).
2. Levantar, com quem opera o fluxo da distribuidora, as seções equivalentes
   a Outbound/Inbound/Estoque/Reversa/Balanço (seção 7.2).
3. Desenhar o schema de tabelas de apoio + `dashboard_snapshots` (mesma
   estrutura conceitual: uma linha "mais recente" por página, JSON pronto
   para renderizar).
4. **Implementar RLS desde o início** — não repetir a lacuna registrada na
   seção 5.2. Definir e testar as policies antes de considerar qualquer
   seção "pronta para operação".
5. Portar o `index.html`: manter a estrutura de tema (`data-tema` claro/
   escuro), os tokens de paleta da seção 2.1, o padrão de cards da skill, e
   trocar apenas o conteúdo das seções pelas equivalentes da distribuidora.
6. Portar o `ingest.js`: manter os padrões da seção 3 (paginação, dedup,
   data em UTC, gzip), trocar o parsing dos arquivos-fonte pelos formatos
   reais da distribuidora.
7. Gerar mockup de cada mudança visual relevante antes de aplicar em
   produção (seção 6, item 2) — especialmente para o primeiro card novo, que
   vai servir de referência para os demais.
8. Validar cada seção com dado real do novo contexto antes de liberar acesso
   além do perfil admin — do mesmo jeito que a Reversa foi mantida restrita
   até validação com a gestora da área neste projeto.

---

## 8. Referências rápidas

- Skill de identidade visual: `vulcabras-visual-identity` (paleta,
  tipografia, padrão de card, logos, filtro de tingimento para tema claro).
- Supabase: Postgres + Storage, tabela central `dashboard_snapshots`.
- Hospedagem: Vercel, deploy estático a partir do `index.html`.
- Arquivos do repositório: `index.html` (render), `ingest.js` (processa),
  `favicon.png` / `MIZ.png` / `OLY.png` / `UA.png` (logos), `mapa-brasil.js`
  (dado geográfico auxiliar), `relatorio.html` (relatório correlato).
