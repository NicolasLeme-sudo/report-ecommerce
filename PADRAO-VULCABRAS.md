# Padrão Vulcabras — Identidade Visual e Estrutura de Projetos

Manual único de padronização para tudo que o time produz: dashboards HTML,
documentos de fluxo de processo, relatórios e apresentações em PowerPoint.

**Este documento é a identidade visual oficial da empresa a partir de agora.**
Peça nova que não segue o que está aqui não vai para produção nem para
apresentação à diretoria.

O arquivo é idêntico nos três repositórios do time
(`report-ecommerce`, `report-DISTR`, `Inventario---Dashboard`). Alterou em um,
replique nos outros.

---

## Sumário

1. [Propósito e como usar](#1-propósito-e-como-usar)
2. [Marca e logos](#2-marca-e-logos)
3. [Paleta e semântica de cor](#3-paleta-e-semântica-de-cor)
4. [Tipografia](#4-tipografia)
5. [Grid, espaçamento e raios](#5-grid-espaçamento-e-raios)
6. [Biblioteca de componentes HTML](#6-biblioteca-de-componentes-html)
7. [Documento de fluxo de processo](#7-documento-de-fluxo-de-processo)
8. [Estrutura de sites e projetos](#8-estrutura-de-sites-e-projetos)
9. [Setores, responsabilidades e contatos](#9-setores-responsabilidades-e-contatos)
10. [Apresentações — padrão PPTX](#10-apresentações--padrão-pptx)
11. [Checklist de conformidade](#11-checklist-de-conformidade)
12. [Boilerplate copiável](#12-boilerplate-copiável)

---

## 1. Propósito e como usar

### Quando este manual é obrigatório

Qualquer peça que carregue o nome Vulcabras e seja vista por alguém além de
quem a fez: dashboard, relatório HTML, documento de fluxo de processo,
apresentação de resultado, deck de reunião, e-mail com layout.

### Como usar na prática

1. Abra o capítulo do tipo de peça que você vai fazer (HTML → cap. 6;
   fluxo de processo → cap. 7; dashboard novo → cap. 8; PPTX → cap. 10).
2. Copie o boilerplate do capítulo 12 para o arquivo novo — ele já traz a
   paleta completa nos dois temas.
3. Antes de publicar, rode o checklist do capítulo 11.

### Regra de trabalho que vale para tudo

**Mudança visual não vai direto para o arquivo de produção.** Gere antes um
mockup isolado (HTML avulso ou artefato) e obtenha aprovação explícita. Esse
processo já evitou retrabalho em vários ajustes dos projetos existentes, e é
o que mantém o custo de revisão baixo.

### Exceções

Exceção ao padrão só se justifica quando um usuário já tem leitura visual
consolidada de um componente antigo — nesse caso, **documente o motivo no
código**, com comentário explicando por que aquele tom/estrutura não segue o
manual, para que a próxima pessoa não "corrija" sem contexto.

### Mudança de padrão

Proposta de mudança vira mockup + aprovação da gerência, depois atualização
deste arquivo nos três repositórios no mesmo dia. Padrão divergente entre
repositórios é bug.

---

## 2. Marca e logos

Todos os logos oficiais são **brancos/monocromáticos com fundo transparente**.
Funcionam apenas sobre fundo escuro ou colorido sólido.

| Arquivo | Uso |
|---|---|
| `logo_vulcabras.png` | Logo institucional horizontal, com a tagline "vivemos para o esporte". Header principal de dashboards e capa de apresentação. |
| `favicon.png` | Ícone isolado (o "V"). Favicon da aba, marca discreta, canto de slide interno. |
| `logo_MIZ.png` | Mizuno — usar em card com header/fundo `--brand-miz`. |
| `logo_OLY.png` | Olympikus — usar em card com header/fundo `--brand-oly`. |
| `logo_UA.png` | Under Armour — usar em card com header/fundo `--brand-ua`. |

### Posicionamento padrão

- **Dashboard**: logo Vulcabras no canto superior esquerdo do header; toggle
  de tema ao lado dela.
- **Slide de capa**: logo Vulcabras em destaque.
- **Slide interno**: logo pequena no canto superior direito.
- **Aba do navegador**: `favicon.png`.

### Área de respiro

Reserve ao redor do logo, em todos os lados, um espaço livre equivalente à
altura do próprio logo dividida por 2. Nada — texto, borda, card — invade essa
área.

### Logo em fundo claro — obrigatório o filtro

Como os arquivos são brancos, no tema claro é preciso tingi-los de azul
institucional, senão desaparecem. Filtro já testado e aprovado, reutilizar
sem alterar:

```css
:root[data-theme="light"] .header-left img {
  filter: brightness(0) saturate(100%) invert(14%) sepia(46%)
          saturate(1878%) hue-rotate(190deg) brightness(94%) contrast(93%);
}
```

**Nunca** colocar a logo branca sobre fundo claro sem esse filtro ou sem uma
versão colorida oficial.

---

## 3. Paleta e semântica de cor

**Tema escuro é o padrão.** É o que se usa em praticamente tudo. O tema claro
existe como alternativa espelhada para impressão e ambientes muito iluminados.

### 3.1. Tema escuro (padrão)

| Token | Uso | Hex |
|---|---|---|
| `--bg` | Fundo base da página/slide | `#142032` |
| `--bg-deep` | Fundo profundo — capa, hero, nó terminal | `#031F44` |
| `--card-bg` | Fundo de card/painel | `#2C3E52` |
| `--card-bg-soft` | Variação de card (decisão, nota) | `#263748` |
| `--card-border` | Borda sutil de card neutro | `#44576C` |
| `--text-primary` | Texto principal | `#FFFFFF` |
| `--text-secondary` | Legenda, label, texto de apoio | `#93A5B8` |
| `--accent-gold` | Kicker, régua, título de seção, destaque de marca | `#F6BD00` |
| `--accent-gold-alt` | Variação dourada (bordas MIZ) | `#DFBD41` |
| `--positive` | Indicador positivo / crescimento | `#45C645` |
| `--negative` | Indicador negativo / alerta | `#C8102E` |
| `--laranja` | Estado intermediário (alerta antes do vermelho) | `#E8830D` |
| `--rail` | Trilho de fluxo, divisor estrutural | `#3A4D63` |
| `--chip-bg` | Fundo de chip e cabeçalho de tabela | `#1B2A3D` |
| `--brand-miz` | Mizuno | `#DFBD41` |
| `--brand-oly` | Olympikus (também azul institucional secundário) | `#297ADF` |
| `--brand-ua` | Under Armour | `#C8102E` |

### 3.2. Tema claro (alternativo)

| Token | Uso | Hex |
|---|---|---|
| `--bg` | Fundo base | `#F4F6F9` |
| `--bg-deep` | Fundo hero/capa | `#E9E9E9` |
| `--card-bg` | Fundo de card | `#FFFFFF` |
| `--card-border` | Borda sutil | `#D5DCE3` |
| `--text-primary` | Texto principal | `#1A3A6B` |
| `--text-secondary` | Legenda | `#5B6B7C` |
| `--accent-gold` | Destaque (dourado escurecido p/ contraste) | `#C9960A` |
| `--positive` | Positivo | `#2E9E2E` |
| `--negative` | Negativo | `#C0392B` |
| `--laranja` | Intermediário | `#C26A00` |
| `--brand-miz` | Mizuno | `#B8940A` |
| `--brand-oly` | Olympikus | `#1A6FC4` |
| `--brand-ua` | Under Armour | `#C0392B` |

### 3.3. Regra de semântica — cor tem significado, não é decoração

- **Verde** só para indicador positivo / disponível / dentro da meta.
- **Vermelho** só para indicador negativo / bloqueado / alerta.
- **Âmbar e laranja** para atenção e estados intermediários.
- **Dourado (`--accent-gold`)** é o accent de marca — kicker, régua, título de
  seção, chip de sistema. **Não é indicador de KPI** e nunca representa
  "atenção" num gráfico de resultado.
- **Cores de marca (MIZ/OLY/UA)** identificam marca e mais nada. Não usar como
  paleta categórica genérica em gráfico que não seja por marca.
- Nunca usar cor solta hard-coded. Todo destaque, badge e barra de KPI sai de
  um token.

### 3.4. Semáforo de backlog (quando o projeto tiver FIFO)

Rampa institucional para dias em aberto:

```js
const cores = {
  '01':  '#6B7F3A',       // oliva histórico — exceção documentada, não trocar
  '02':  'var(--amber)',
  '03':  'var(--laranja)',
  '04+': 'var(--red)',
};
```

O dia 01 usa um oliva fixo, mais apagado que o verde institucional, por pedido
da gerência — é a referência visual que os leitores diários do card já têm.
Projeto novo sem esse legado usa a rampa completa a partir do verde
institucional.

---

## 4. Tipografia

**Segoe UI é a fonte oficial**, em três pesos.

| Peso | Uso |
|---|---|
| Segoe UI Black / Bold (700–900) | Títulos, headers de slide, KPI em destaque |
| Segoe UI Regular (400) | Corpo de texto, labels, valores de card |
| Segoe UI Light (300) | Números grandes hero (capa, KPI principal), numeração de etapa de fluxo |

### Stack CSS

```css
--fonte: "Segoe UI", "Segoe UI Semibold", Roboto, "Helvetica Neue", Arial, sans-serif;
--fonte-mono: ui-monospace, "Cascadia Mono", "Consolas", "Courier New", monospace;
```

A monoespaçada é usada apenas em chip de sistema (SAP, WMS, TMS, EXCEL),
rótulo técnico, e-mail de contato e referência de etapa.

### Escala por papel

| Papel | Tamanho | Peso | Extras |
|---|---|---|---|
| Kicker | 11px | 700 | caixa alta, `letter-spacing: .16em`, dourado |
| H1 de página | `clamp(26px, 4.4vw, 40px)` | 900 | `letter-spacing: -.015em`, `text-wrap: balance` |
| H2 de seção | 19px | 700 | `letter-spacing: -.01em` |
| H3 de card | 15.5px | 700 | `text-wrap: balance` |
| Corpo | 15px | 400 | `line-height: 1.55` |
| Texto de apoio em card | 13.5px | 400 | cor `--text-secondary` |
| Label de meta | 10px | 600 | caixa alta, `letter-spacing: .12em` |
| KPI hero | 30–60px | 300 | `font-variant-numeric: tabular-nums` |

Linha de texto corrido não passa de ~62 caracteres (`max-width: 62ch`).
Qualquer coluna de números leva `font-variant-numeric: tabular-nums`.

**PPTX:** usar `Segoe UI`, `Segoe UI Black` e `Segoe UI Light` diretamente —
são fontes nativas do PowerPoint corporativo, sem fallback necessário.

---

## 5. Grid, espaçamento e raios

| Propriedade | Valor |
|---|---|
| Unidade base de espaçamento | 8px — usar múltiplos (8/12/14/16/24/40) |
| Largura máxima de conteúdo | 820px (documento de fluxo) · 940px (documento denso) · 1440px (dashboard) |
| Gutter lateral mínimo | 20px, nunca menos de 16px em telas pequenas |
| Espaço entre seções | 40px |
| Espaço entre cards | 12px |
| Raio de card | 8px |
| Raio de pílula/chip | 999px |
| Sombra | `0 1px 2px rgba(0,0,0,.30)` — só isso; profundidade vem do contraste de tom |
| Grid de cards | `repeat(auto-fit, minmax(240px, 1fr))` |

### Regras de layout

- Espaçamento sempre por `gap` de flex/grid, nunca por margem por elemento.
- Interface limpa, com muito espaço entre blocos. Visual executivo, direto,
  sem poluição.
- Responsivo de verdade: tudo empilha em uma coluna a ~400px de largura. Só
  tabela e diagrama podem ser mais largos, cada um dentro do seu
  `overflow-x: auto`. A página nunca rola na horizontal.
- **Nunca usar accent line ou barra decorativa na borda de cards.** O único
  elemento de destaque linear é a régua fina dourada abaixo do título
  principal.

---

## 6. Biblioteca de componentes HTML

Todo componente abaixo já está em produção e é copiável direto.

### 6.1. Cabeçalho de página — kicker, título e régua

```html
<header>
  <p class="kicker">Fluxo de processos</p>
  <h1>Cancelamento de Pedido Faturado</h1>
  <hr class="regua">
  <p class="dek">Uma frase que explica o documento, em até duas linhas.</p>
  <div class="meta">
    <div><span class="rot">Sistemas</span><span class="val">SAP · WMS · TMS</span></div>
    <div><span class="rot">Etapas</span><span class="val">1 decisão + 9 etapas</span></div>
  </div>
</header>
```

```css
.kicker { font-size:11px; font-weight:700; letter-spacing:.16em; text-transform:uppercase;
          color:var(--accent-gold); margin:0 0 10px; }
.regua  { height:2px; width:72px; background:var(--accent-gold); border:0; margin:18px 0 16px; }
.dek    { margin:0; max-width:62ch; color:var(--text-secondary); font-size:15px; }
.meta   { display:flex; flex-wrap:wrap; gap:8px 28px; margin-top:22px;
          padding-top:18px; border-top:1px solid var(--card-border); }
.meta .rot { font-size:10px; letter-spacing:.12em; text-transform:uppercase;
             color:var(--text-secondary); font-weight:600; }
.meta .val { font-size:13px; font-weight:600; }
```

A linha `.meta` é o resumo executivo do documento: sistemas envolvidos,
quantidade de etapas, responsável atual. Sempre presente em documento de
processo.

### 6.2. Card neutro

Fundo `--card-bg`, borda 1px `--card-border`, raio 8px, sombra discreta.

```css
.caixa { background:var(--card-bg); border:1px solid var(--card-border);
         border-radius:8px; padding:14px 16px; display:flex; flex-direction:column;
         gap:7px; box-shadow:0 1px 2px rgba(0,0,0,.30); }
.caixa h3 { margin:0; font-size:15.5px; font-weight:700; text-wrap:balance; }
.caixa p  { margin:0; font-size:13.5px; color:var(--text-secondary); }
```

### 6.3. Card de marca (MIZ / OLY / UA)

Header sólido na cor da marca, corpo neutro, borda fina na mesma cor.

```html
<div class="marca-card m-oly">
  <div class="topo">Olympikus</div>
  <div class="corpo">R$ 26,1 mi · 20,5% do estoque</div>
</div>
```

```css
.marca-card { border-radius:8px; overflow:hidden; border:1px solid var(--card-border);
              background:var(--card-bg); }
.marca-card .topo { padding:7px 12px; font-size:12px; font-weight:800;
                    letter-spacing:.06em; text-transform:uppercase; }
.m-miz .topo { background:var(--brand-miz); color:#142032; }
.m-oly .topo { background:var(--brand-oly); color:#FFFFFF; }
.m-ua  .topo { background:var(--brand-ua);  color:#FFFFFF; }
.m-miz { border-color:var(--brand-miz); }
.m-oly { border-color:var(--brand-oly); }
.m-ua  { border-color:var(--brand-ua); }
```

### 6.4. KPI

Número grande em Segoe UI Light, rótulo em caixa alta acima, variação abaixo
colorida pelo sinal.

```html
<div class="kpi">
  <span class="rotulo">Valor de estoque</span>
  <div class="numero">R$ 127,2 mi</div>
  <div class="delta pos">▲ 4,1% vs. extração anterior</div>
</div>
```

```css
.kpi .rotulo { font-size:11px; letter-spacing:.1em; text-transform:uppercase;
               color:var(--text-secondary); font-weight:600; }
.kpi .numero { font-size:30px; font-weight:300; font-variant-numeric:tabular-nums;
               line-height:1.1; margin-top:4px; }
.kpi .delta.pos { color:var(--positive); }
.kpi .delta.neg { color:var(--negative); }
```

### 6.5. Chips — sistema e setor

```css
.chip { display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600;
        padding:3px 9px; border-radius:999px; background:var(--chip-bg);
        border:1px solid var(--card-border); color:var(--text-secondary); white-space:nowrap; }
.chip-sis { font-family:var(--fonte-mono); font-size:10.5px; letter-spacing:.06em;
            color:var(--accent-gold);
            border-color:color-mix(in srgb, var(--accent-gold) 45%, transparent);
            background:color-mix(in srgb, var(--accent-gold) 12%, transparent); }
.chip-setor { color:var(--text-primary); }
```

- `chip-sis` — nome do sistema, sempre em caixa alta e monoespaçada:
  `SAP`, `WMS`, `TMS`, `EXCEL`, `E-MAIL`.
- `chip-setor` — setor responsável pela etapa.
- `chip` sem modificador, com seta (`→ Fiscal`) — destino/encaminhamento.

### 6.6. Tabela

```css
table { border-collapse:collapse; width:100%; font-size:12.5px; }
th, td { padding:8px 10px; border:1px solid var(--card-border); text-align:left;
         font-variant-numeric:tabular-nums; }
thead th { background:var(--chip-bg); color:var(--text-secondary); font-size:10px;
           letter-spacing:.06em; text-transform:uppercase; font-weight:700; }
tbody tr.total td, tbody tr.total th {
  border-top:2px solid var(--brand-oly); background:var(--chip-bg); font-weight:700; }
```

**Linha de total sempre marcada pela classe `total` no HTML gerado, nunca por
`:last-child`.** Estilizar "a última linha" por posição já fez a 10ª linha de
um Top 10 parecer total geral.

Toda tabela que abre um total por categoria precisa de uma categoria de
destino garantida para todo item (ex.: "Sem Marca") — ou a soma da tabela
diverge do card ao lado silenciosamente.

### 6.7. Grid de setores

```css
.setores { display:grid; grid-template-columns:repeat(auto-fit, minmax(240px,1fr)); gap:12px; }
.setor { display:grid; grid-template-columns:auto 1fr; gap:10px; align-items:start;
         padding:13px 15px; background:var(--card-bg);
         border:1px solid var(--card-border); border-radius:8px; }
.setor .nome  { font-size:13.5px; font-weight:700; }
.setor .papel { font-size:12.5px; color:var(--text-secondary); margin:2px 0 0; }
.setor .etapas{ font-family:var(--fonte-mono); font-size:11px; color:var(--accent-gold);
                margin-top:4px; display:block; }
.bolinha { width:9px; height:9px; border-radius:50%; background:var(--accent-gold);
           margin-top:6px; }
```

### 6.8. Bloco de contatos

```css
.contatos { display:grid; grid-template-columns:repeat(auto-fit, minmax(240px,1fr)); gap:12px; }
.contato a { font-size:12.5px; color:var(--accent-gold); text-decoration:none;
             font-family:var(--fonte-mono); word-break:break-all; }
.contato a:hover { text-decoration:underline; }
```

---

## 7. Documento de fluxo de processo

Formato fixo para mapear qualquer processo da operação. Referências em
produção: *Identificação de Materiais Adquiridos (Imobilizado)* e
*Cancelamento de Pedido Faturado*.

### 7.1. Ordem das seções — sempre esta

1. **Cabeçalho** — kicker "Fluxo de processos", título, régua, resumo de uma
   frase e a linha `.meta` (sistemas · nº de etapas · responsável atual).
2. **Pré-requisitos** (opcional) — configurações que precisam existir antes do
   fluxo rodar, cada uma em card com o chip do sistema e a etapa em que é usada.
3. **O fluxo** — a espinha numerada.
4. **Observações** (opcional) — casos correlatos, em card de borda tracejada
   dourada.
5. **Quem faz o quê** — grid de setores, com as etapas de cada um.
6. **Contatos por setor** — e-mails oficiais.

### 7.2. A espinha

```css
.fluxo { list-style:none; margin:0; padding:0; position:relative;
         display:flex; flex-direction:column; gap:12px; }
.fluxo::before { content:""; position:absolute; left:21px; top:14px; bottom:14px;
                 width:2px; background:var(--rail); border-radius:2px; }
.no { position:relative; display:grid; grid-template-columns:44px 1fr; gap:14px;
      align-items:start; }
.marca { position:relative; z-index:1; width:44px; height:44px; display:grid;
         place-items:center; border-radius:50%; background:var(--card-bg);
         border:2px solid var(--rail); font-size:17px; font-weight:300;
         font-variant-numeric:tabular-nums; color:var(--text-primary); }
```

### 7.3. Os quatro tipos de nó

| Tipo | Forma | Regra |
|---|---|---|
| **Terminal** (início/fim) | Pílula — `border-radius:999px`, fundo `--bg-deep`, borda dourada, ícone SVG de seta (início) ou quadrado (fim) | Sempre o primeiro e o último item da lista |
| **Etapa** | Card retangular, marcador circular numerado | Numeração sequencial, sem pular |
| **Decisão** | Marcador em losango dourado sem preenchimento, card com rótulo "DECISÃO" e borda dourada | A pergunta é sempre fechada (sim/não) e o texto explica o que cada caminho implica |
| **Ramo de saída** | Bloco recuado, borda esquerda tracejada, pílula colorida identificando a resposta | Usado quando um caminho encerra cedo |

```css
.marca.marca-terminal { border-color:var(--accent-gold); background:var(--bg-deep);
                        color:var(--accent-gold); }
.marca.marca-decisao  { border:0; background:transparent; color:var(--accent-gold); }
.no-terminal .caixa { border-radius:999px; padding:12px 22px; background:var(--bg-deep);
                      border-color:var(--accent-gold); flex-direction:row;
                      align-items:baseline; gap:12px; flex-wrap:wrap; }
.saida { margin-top:12px; margin-left:10px; padding-left:18px;
         border-left:2px dashed var(--rail); display:flex; flex-direction:column; gap:8px; }
.pill-ramo { font-size:10.5px; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
             padding:3px 11px; border-radius:999px; background:var(--accent-gold); color:#142032; }
.pill-ramo.pill-verde { background:var(--positive); color:#0B2410; }
```

### 7.4. Conteúdo de cada etapa

- **Título** — verbo no infinitivo + objeto: "Validar a data de emissão da nota
  no SAP", "Etiquetar e destinar o material ao setor".
- **Descrição** — o que acontece e por quê, em 1 a 3 frases, em
  `--text-secondary`.
- **Chip de sistema** — quando a etapa acontece dentro de um sistema.
- **Chips de setor** — quem executa e, com seta, para quem encaminha.
- **Mini-tabela** — quando a etapa envolve uma planilha padrão, mostrar o
  layout real com 2 a 3 linhas de exemplo, dentro de `overflow-x:auto`, com a
  coluna crítica destacada.

### 7.5. Escrita

Português do Brasil, direto, sem jargão de sistema que a operação não usa.
Nome de pessoa entre parênteses após o setor quando a etapa tem dono
conhecido: `Gestão de Estoque (Beatriz)`.

---

## 8. Estrutura de sites e projetos

Toda aplicação do time segue a mesma arquitetura de três camadas, com
separação rígida de responsabilidade. **Isso não é opcional.**

```
   Planilhas / exports dos sistemas (WMS, SAP, ERP, Forecast)
              │  upload manual, feito pelo operador no navegador
              ▼
        ┌───────────────┐
        │   ingest.js    │  Lê os arquivos, cruza dados, calcula os indicadores
        │  (processa e   │  e grava tudo já pronto. NUNCA desenha nada na tela.
        │   só escreve)  │
        └───────┬────────┘
                │ grava
                ▼
        ┌───────────────┐
        │   Supabase     │  Postgres (dados + snapshot pronto) +
        │                │  Storage (backup gzip do arquivo original)
        └───────┬────────┘
                │ lê o snapshot já pronto
                ▼
        ┌───────────────┐
        │  index.html    │  Desenha cards, gráficos e tabelas.
        │ (renderiza e   │  NUNCA recalcula regra de negócio.
        │   só lê)       │
        └───────────────┘
                ▼
             Vercel (estático, deploy automático da branch de produção)
```

### 8.1. Arquivos padrão na raiz do repositório

| Arquivo | O que é |
|---|---|
| `index.html` | O dashboard. Single-file: HTML + CSS + JS embutidos, sem build step. |
| `ingest.js` | Parse, cruzamento, agregação e gravação. |
| `esquema.sql` | Todo o banco: tabelas, gabaritos e RLS. |
| `vercel.json` | Declara que é estático puro, sem build. |
| `favicon.png`, `logo_*.png` | Marca. |
| `README.md` | Documentação do projeto. |
| `PADRAO-VULCABRAS.md` | Este manual. |

### 8.2. Onde investigar cada tipo de problema

- **Número errado na tela** → `ingest.js` (como foi calculado).
- **Aparência errada** → `index.html` (como é exibido).

Nunca mover cálculo para o `index.html` porque "é mais fácil calcular ali".

### 8.3. Banco: tabela central `dashboard_snapshots`

Uma linha por `pagina`, com o JSON já pronto para renderizar e o timestamp
`gerado_em` gravado sempre em UTC (`new Date().toISOString()`). Cada save é
uma linha nova — o histórico e o undo saem de graça.

Página nova do dashboard = nova linha em `dashboard_snapshots`, sem mudança de
schema.

### 8.4. Padrões de engenharia obrigatórios em projeto novo

Cada um resolveu um bug real. Implementar desde o primeiro commit:

1. **Paginação segura** — parar só quando a página volta **vazia** e avançar o
   offset pelo tamanho real retornado, nunca pelo lote pedido. O PostgREST
   limita as linhas por requisição independentemente do `.range()`.
2. **Deduplicação antes do insert** — por chave natural. Se a repetição é
   mudança de status, manter o mais avançado; se é posição do mesmo SKU,
   **somar** e recalcular o preço médio ponderado.
3. **Data sempre em UTC na gravação**, conversão para Brasília só na exibição,
   via `Intl.DateTimeFormat` com `timeZone: 'America/Sao_Paulo'`. Nunca somar
   ou subtrair horas na mão.
4. **Gzip no upload** do arquivo original, com fallback para o upload cru.
5. **Linha de total por classe semântica**, nunca por `:last-child`.
6. **RLS no Postgres desde o início.** O front-end esconde a interface; quem
   protege o dado é a policy. E RLS falha **em silêncio** — a query volta
   vazia, sem erro.
7. **Reconciliação explícita** — em relatório que cruza duas fontes por uma
   tabela de-para, toda categoria fora do mapa vira linha própria e a
   divergência de total vira erro no console. Nunca descartar sobra.

### 8.5. Checklist de RLS a cada feature nova

Sempre que uma tela passar a ler ao vivo uma tabela que antes só o `ingest.js`
tocava:

1. Conferir `select * from pg_policies where tablename = '<tabela>'`.
2. Criar policy `SELECT` para os perfis que a tela expõe, sem tocar na policy
   de escrita.
3. **Testar logado no perfil mais restrito**, não só como admin.

### 8.6. Perfis de acesso

Padrão herdado: `admin` / `gestor` / `operador`. Confirmar com a área se a
hierarquia real do projeto é essa antes de replicar os nomes.

### 8.7. Checklist para começar um projeto novo

1. Projeto Supabase dedicado — nunca compartilhar banco entre contextos.
2. Levantar com a operação as seções/páginas equivalentes.
3. Desenhar o schema + `dashboard_snapshots`.
4. RLS junto com o schema.
5. Portar `index.html` com os tokens do capítulo 3 e os componentes do 6.
6. Portar `ingest.js` com os padrões do 8.4.
7. Mockup aprovado antes de cada mudança visual relevante.
8. Validar cada seção com dado real antes de liberar além do admin.

---

## 9. Setores, responsabilidades e contatos

Mapa dos setores que aparecem nos fluxos documentados. Usar exatamente estes
nomes nos chips de setor — nome divergente quebra a leitura cruzada entre
documentos.

| Setor | Responde por |
|---|---|
| **Planejamento** | Solicita e formaliza número de imobilizado, conduz compra/envio de material, mantém a planilha de controle. |
| **Controladoria** | Formaliza e libera número de imobilizado; processa baixa por perda, quebra ou descarte. |
| **Almoxarifado do CD** | Recebe material e placa patrimonial, faz a identificação/cruzamento, etiqueta e destina ao setor de uso. |
| **Gestão de Estoque** | Valida situação da NF no SAP, decide o caminho do cancelamento, sinaliza itens sem físico, trata entrada sem físico. |
| **Fiscal** | Cancela NF dentro do prazo; cria e integra a nota de entrada fora do prazo. |
| **Embarque / Expedição** | Recebe o pedido sinalizado como devolução, abre a coleta e encerra o transporte no TMS. |
| **Devolução / Reversa** | Recebe o material físico disponível e lança a entrada no CD. |
| **Armazenagem** | Aloca o material OK ao estoque vendável do WMS. |
| **SAC / Pós-venda** | Identifica a divergência e solicita o cancelamento. |
| **Logística** | Encaminha o pedido da operação ao embarque. |

### Contatos oficiais

| Setor | E-mails |
|---|---|
| Planejamento | isabel.sales@vulcabras.com · leonardo.camargo@vulcabras.com |
| Controladoria | lucas.lopes@vulcabras.com · alexsandra.gomes@vulcabras.com |
| Almoxarifado | stella.almeida@vulcabras.com · claudeir.almeida@vulcabras.com |

Contato novo entra nesta tabela e no bloco de contatos do documento de fluxo
correspondente — os dois juntos, para não divergirem.

### Sistemas de referência

| Sigla | O que é |
|---|---|
| `SAP` | ERP — nota fiscal, imobilizado, integração fiscal |
| `WMS` | Gestão do armazém — estoque, endereçamento, expedição |
| `TMS` | Gestão de transporte — coleta, ocorrência, encerramento |
| `EXCEL` | Planilha de controle de processo |
| `E-MAIL` | Formalização entre setores |

---

## 10. Apresentações — padrão PPTX

A partir de agora, toda apresentação do time segue este padrão. Mesmos tokens
do HTML, mesma tipografia, mesma lógica de cor.

### 10.1. Formato

| Propriedade | Valor |
|---|---|
| Proporção | 16:9 — `LAYOUT_WIDE`, 13,3" × 7,5" |
| Fundo padrão | `142032` |
| Fundo de capa e abertura de seção | `031F44` |
| Fonte | Segoe UI (Black / Regular / Light) |
| Margem de segurança | 0,5" em todos os lados |

> **pptxgenjs:** passar os hex **sem `#`** e com 6 dígitos (`F6BD00`, nunca
> `#F6BD00` nem 8 dígitos).

### 10.2. Os três tipos de slide

**Capa**
- Kicker dourado em caixa alta (nome do report/contexto).
- Título em Segoe UI Black, branco, grande.
- Régua dourada fina abaixo do título.
- Subtítulo com período e autor em `93A5B8`.
- Logo Vulcabras em destaque.

**Abertura de seção**
- Fundo `031F44`.
- Número da seção como kicker dourado ("Seção 02").
- Título da seção em Black.
- Régua dourada.

**Conteúdo / KPI**
- Fundo `142032`, logo pequena no canto superior direito.
- Kicker dourado + título + régua no topo.
- Corpo: cards neutros, cards de marca ou KPI hero.
- KPI hero em Segoe UI Light (44–60pt), legenda pequena em `93A5B8`, variação
  em verde ou vermelho conforme o sinal.

### 10.3. Regras de conteúdo

- **Storytelling claro**: contexto → dado → insight. Slide sem insight é slide
  de anexo.
- Um assunto por slide. Se precisa de duas réguas, são dois slides.
- Card de marca com header sólido na cor da marca — o mesmo padrão do HTML.
- Ranking numerado: círculo na cor da marca com número branco ao lado do item.
- Gráfico usa cor com significado (verde/vermelho/âmbar) ou cor de marca
  quando a série é por marca. Nunca paleta decorativa.
- Tabela: cabeçalho em `1B2A3D`, texto de apoio em `93A5B8`, linha de total
  destacada explicitamente.

### 10.4. Proibido

- Barra ou accent line decorativa na borda de card — marca registrada de slide
  gerado automaticamente.
- Verde ou vermelho como enfeite, fora do significado de KPI.
- Logo branca sobre fundo claro sem o filtro institucional.
- Fonte diferente de Segoe UI.
- Gradiente, sombra pesada, ícone 3D, clipart.
- Slide com texto corrido em parágrafo longo.

---

## 11. Checklist de conformidade

Rodar antes de publicar qualquer peça.

### Todo HTML

- [ ] Tokens do capítulo 3 declarados em `:root`, nenhuma cor hard-coded no CSS.
- [ ] `color-scheme` declarado e `body` com `background` explícito vindo de token.
- [ ] Segoe UI com o stack de fallback completo.
- [ ] Kicker + título + régua dourada no cabeçalho.
- [ ] Cards com raio 8px, borda 1px, sombra discreta — sem accent line.
- [ ] Verde/vermelho só com significado de indicador.
- [ ] Linha de total marcada por classe, nunca por `:last-child`.
- [ ] Colunas de número com `tabular-nums`.
- [ ] Funciona a 400px de largura, sem rolagem horizontal da página.
- [ ] Tabela larga dentro de `overflow-x: auto`.
- [ ] `prefers-reduced-motion` respeitado.
- [ ] Logo com o filtro de tingimento se houver tema claro.

### Dashboard

- [ ] Cálculo no `ingest.js`, renderização no `index.html` — sem mistura.
- [ ] Paginação para só em página vazia.
- [ ] Dedup antes do insert.
- [ ] Timestamp gravado em UTC, exibido em Brasília.
- [ ] RLS criada e testada no perfil mais restrito.
- [ ] Totais de card e tabela conferem.

### Documento de fluxo

- [ ] Ordem das seções do capítulo 7.1.
- [ ] Linha `.meta` preenchida.
- [ ] Terminais de início e fim presentes.
- [ ] Todo nó com chip de setor; nó de sistema com chip de sistema.
- [ ] "Quem faz o quê" e "Contatos por setor" completos e com os nomes de setor
      do capítulo 9.

### Apresentação

- [ ] 16:9, fundo institucional, Segoe UI.
- [ ] Capa, aberturas de seção e slides de conteúdo no padrão do capítulo 10.
- [ ] Logo no canto superior direito dos slides internos.
- [ ] Nenhum item da lista de proibições do 10.4.
- [ ] Cada slide entrega um insight.

---

## 12. Boilerplate copiável

Colar no topo de qualquer arquivo novo.

```css
:root {
  /* tema escuro — padrão */
  --bg: #142032;
  --bg-deep: #031F44;
  --card-bg: #2C3E52;
  --card-bg-soft: #263748;
  --card-border: #44576C;
  --text-primary: #FFFFFF;
  --text-secondary: #93A5B8;
  --accent-gold: #F6BD00;
  --accent-gold-alt: #DFBD41;
  --positive: #45C645;
  --negative: #C8102E;
  --laranja: #E8830D;
  --rail: #3A4D63;
  --chip-bg: #1B2A3D;
  --brand-miz: #DFBD41;
  --brand-oly: #297ADF;
  --brand-ua: #C8102E;

  --fonte: "Segoe UI", "Segoe UI Semibold", Roboto, "Helvetica Neue", Arial, sans-serif;
  --fonte-mono: ui-monospace, "Cascadia Mono", "Consolas", "Courier New", monospace;

  --u: 8px;
  --raio: 8px;
  --largura: 940px;
  --sombra: 0 1px 2px rgba(0,0,0,.30);

  color-scheme: dark;
}

/* tema claro — alternativo; só em documento com toggle */
:root[data-theme="light"] {
  --bg: #F4F6F9;
  --bg-deep: #E9E9E9;
  --card-bg: #FFFFFF;
  --card-bg-soft: #F0F3F7;
  --card-border: #D5DCE3;
  --text-primary: #1A3A6B;
  --text-secondary: #5B6B7C;
  --accent-gold: #C9960A;
  --positive: #2E9E2E;
  --negative: #C0392B;
  --laranja: #C26A00;
  --chip-bg: #EEF2F7;
  --brand-miz: #B8940A;
  --brand-oly: #1A6FC4;
  --brand-ua: #C0392B;

  color-scheme: light;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text-primary);
  font-family: var(--fonte);
  font-size: 15px;
  line-height: 1.55;
  padding-inline: 20px;
  padding-block: 40px 56px;
  -webkit-font-smoothing: antialiased;
}

.pagina {
  max-width: var(--largura);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 40px;
}

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
```

### Tokens equivalentes no pptxgenjs

```js
const CORES = {
  bg:        '142032',
  bgDeep:    '031F44',
  card:      '2C3E52',
  borda:     '44576C',
  texto:     'FFFFFF',
  apoio:     '93A5B8',
  dourado:   'F6BD00',
  positivo:  '45C645',
  negativo:  'C8102E',
  miz:       'DFBD41',
  oly:       '297ADF',
  ua:        'C8102E',
};
```

---

*Manual mantido pelo time de Dados & Processos. Dúvida sobre aplicação do
padrão, ou proposta de mudança: leve o mockup à gerência antes de alterar este
arquivo.*
