# Report Distribuidora — Balanço e Detalhamento de Estoque

Primeira entrega do report da distribuidora. Escopo desta versão: **estoque**,
com a hierarquia **Armazém › Marca › Família** em listagem que abre e fecha,
no mesmo modelo do dash financeiro usado como referência.

A base técnica e a identidade visual são herdadas do Report E-commerce
(ver o README na raiz do repositório). As demais páginas — romaneio,
faturamento, entrega por transportadora — entram depois **nesta mesma base**,
sem mudança de estrutura: cada uma vira uma nova linha em `dashboard_snapshots`.

---

## 1. Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | O dashboard. Só lê o snapshot pronto e desenha. Nenhuma regra de negócio. |
| `ingest.js` | Lê o TXT do sistema, calcula tudo e grava no Supabase. Nunca toca na tela. |
| `esquema.sql` | Todo o banco: tabelas, gabaritos de armazém/família, RLS. Rodar uma vez. |
| `favicon.png` | Ícone da aba e marca no menu lateral. |

A separação entre os dois primeiros é **inegociável** (README raiz, seção 1):
número errado na tela se investiga no `ingest.js`; aparência se ajusta no
`index.html`.

---

## 2. Passo a passo — do zero ao ar

### 2.1. Supabase (~10 min)

1. **Novo projeto**, dedicado à distribuidora. Não reaproveitar o projeto do
   CD: contextos diferentes não compartilham banco.
   Região sugerida: `sa-east-1` (São Paulo) ou a mesma já usada hoje.
2. **SQL Editor → New query** → cole o conteúdo inteiro de `esquema.sql` → Run.
   Ele cria as tabelas, carrega o gabarito dos 6 armazéns + as 21 famílias com
   suas marcas, e liga a RLS.
3. **Storage → New bucket** → nome `backups`, **Public: OFF**.
   É onde fica a cópia comprimida de cada TXT enviado, para auditoria.
4. **Authentication → Users → Add user** → crie seu e-mail e senha.
5. Copie o UUID do usuário criado e rode no SQL Editor:
   ```sql
   insert into perfis_acesso (user_id, role, nome)
   values ('COLE-O-UUID-AQUI', 'admin', 'Seu Nome');
   ```
6. **Project Settings → API**: copie a **Project URL** e a **anon public key**.

### 2.2. Configurar o `index.html`

Abra o arquivo e troque as duas linhas no início do `<script>` inline
(procure por `SUPABASE_URL`):

```js
const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
const SUPABASE_ANON_KEY = 'COLE-SUA-ANON-KEY-AQUI';
```

A anon key é pública por design — quem protege o dado é a RLS no Postgres,
não o fato de a chave estar escondida no front. É o mesmo modelo do report
do e-commerce, com a diferença de que aqui a RLS já nasceu junto com o schema
(era a lacuna registrada na seção 5.2 do README raiz).

### 2.3. GitHub

Os arquivos estão na pasta `distribuidora/` deste repositório, na branch
`claude/distributor-report-dev-jccehm`.

**Opção A — repositório separado (recomendado a médio prazo).**
Crie um repositório novo (ex. `report-distribuidora`) e copie para a **raiz**
dele os 4 arquivos da pasta `distribuidora/`. Contextos separados, deploys
separados, histórico limpo.

**Opção B — manter neste repositório (mais rápido agora).**
Faça o merge da branch para a `main` e configure o Vercel para apontar a raiz
do projeto para a pasta `distribuidora` (passo 2.4).

### 2.4. Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → importe o
   repositório do GitHub.
2. Em **Framework Preset**, escolha **Other** — é site estático puro, sem build.
3. **Se você usou a Opção B** (arquivos dentro da pasta): expanda
   **Root Directory**, clique em **Edit** e selecione `distribuidora`.
   Se usou a Opção A, deixe a raiz.
4. **Build Command** e **Output Directory**: deixe em branco. Não há build step.
5. **Deploy**. Em ~30 segundos o link fica pronto
   (`https://seu-projeto.vercel.app`).
6. Todo push na branch de produção redeploya sozinho.

> **Antes de apresentar:** abra o link, faça login e confira se o card verde de
> conferência aparece. Se o Vercel ainda não estiver pronto na hora, o
> `index.html` funciona igual aberto direto do disco (duplo clique) — ele fala
> com o Supabase pela internet, não depende do servidor de hospedagem.

### 2.5. Carregar o estoque

1. Abra o link, faça login.
2. Menu **Admin → Atualizar dados**.
3. Selecione o TXT da extração `EX000914 — POSIÇÃO DO STOCK / LOCAIS
   STOCKAGEM`, **exatamente como sai do sistema**.
4. Acompanhe o log. Ao terminar, o dashboard recarrega sozinho.

> **Não abra o TXT no Excel e salve por cima.** O arquivo é de largura fixa —
> as colunas são identificadas por posição de caractere, não por separador.
> Qualquer reformatação quebra a leitura.

---

## 3. O que a tela mostra

### 3.1. Faixa de conferência

O relatório do sistema imprime o próprio `** TOTAL GERAL` no rodapé. O ingest
compara o que ele leu com esse número e a tela mostra o resultado:

- **Verde** — a quantidade confere exatamente. É o caso do arquivo de
  25/08/2026: **2.946.194 unidades**, batendo linha a linha.
  A diferença de **R$ 0,88** no valor é arredondamento do próprio relatório
  (ele soma valores já arredondados por linha) — está declarada na tela, não
  escondida.
- **Vermelho** — a quantidade não bateu. Significa linha perdida na leitura.
  Nesse caso, **não apresente o número**: investigue o parse no `ingest.js`.

### 3.2. KPIs

Valor total, quantidade total, **disponível para venda** (armazéns de
categoria `DISPONIVEL` — hoje só o AC190), **bloqueado / em análise** (todo o
resto), SKUs posicionados e custo médio unitário.

A leitura que essa linha entrega de imediato: dos R$ 130,6 mi de estoque,
**R$ 123,9 mi (94,9%) estão disponíveis** e **R$ 6,7 mi (5,1%) estão
travados** em análise, qualidade ou devolução.

### 3.3. Filtro de status do artigo

Chips `VS` / `VN` / `IN` / `IS` no topo. Clicar isola o status; "Todos" limpa.
O filtro atinge **tudo ao mesmo tempo**: KPIs, gráficos e a árvore inteira.

Isso funciona porque cada nó da árvore já vem do ingest com o total quebrado
por status — o navegador só soma os baldes selecionados, não reprocessa regra
de negócio.

> **Pendência de negócio:** o significado exato de VS/VN/IN/IS ainda não está
> mapeado. Hoje eles são tratados como rótulos neutros. Quando você confirmar o
> que cada um representa, dá para renomeá-los e, se fizer sentido, aplicar
> semáforo de cor — muda só o objeto `ROTULO_STATUS` no `index.html`.

### 3.4. Gráficos

- **Composição do valor por armazém** — barra empilhada. A cor não é
  decoração: verde = disponível, âmbar = em análise, vermelho = bloqueado.
- **Valor de estoque por marca** — barras horizontais na cor institucional de
  cada marca (Mizuno dourado, Olympikus azul, Under Armour vermelho).

### 3.5. A árvore

Fechada, mostra os 7 armazéns e o **TOTAL GERAL**. Cada `+` abre um nível:

```
AC190  [DISPONÍVEL]  Armazém Físico segregado em PULMÃO e PICKING
  └ MIZUNO
      ├ 102  TENIS MIZUNO COMPRADO
      ├ 103  VESTUARIO MIZUNO COMPRADO
      └ ...
```

Colunas: **Qtd · % do nível · SKUs · R$ · % do nível**.

O **% é sempre em relação ao nível pai**, não ao total geral — dentro de um
armazém, as marcas somam 100%; dentro de uma marca, as famílias somam 100%.
É o que responde à pergunta que a gestão faz de verdade: *"quanto desse
armazém é Mizuno?"*.

A coluna **KPI** traz a bandeira de alerta nos armazéns cujo estoque **não
está disponível para venda** — mesma função da bandeira vermelha no dash
financeiro de referência.

Botões **Expandir tudo / Recolher tudo** e **CSV** (exporta a árvore inteira,
não só o que está aberto, respeitando o filtro de status ativo).

---

## 4. Números da carga de 25/08/2026

| | |
|---|---|
| Linhas de produto lidas | 25.371 |
| Artigos distintos | 3.026 |
| Quantidade total | 2.946.194 un — **confere com o sistema** |
| Valor total | R$ 130.634.702,99 (relatório: R$ 130.634.702,11 — Δ R$ 0,88 de arredondamento) |
| Famílias | 21, todas mapeadas para marca |

**Por armazém:**

| Armazém | Qtd | Valor | % valor |
|---|---:|---:|---:|
| AC190 (disponível) | 2.848.803 | R$ 123.925.257,63 | 94,9% |
| ARMRP (bloqueado) | 77.662 | R$ 5.020.941,86 | 3,8% |
| ARAMO (análise) | 13.957 | R$ 1.370.611,94 | 1,0% |
| DEVFT (bloqueado) | 3.848 | R$ 269.846,53 | 0,2% |
| ARMFT (análise) | 1.737 | R$ 41.185,95 | 0,0% |
| ARMC1 (análise) | 42 | R$ 2.349,60 | 0,0% |
| SEM_ARMAZEM | 145 | R$ 4.509,47 | 0,0% |

**Por marca:** Mizuno R$ 70,3 mi (53,8%) · Under Armour R$ 33,2 mi (25,4%) ·
Olympikus R$ 27,2 mi (20,8%).

### Duas coisas que vale saber antes de apresentar

1. **10 linhas do arquivo vêm sem armazém preenchido** (o campo sai como
   `EXTRE/` vazio) — 145 unidades, R$ 4.509,47. Elas **não foram descartadas**:
   aparecem como `SEM_ARMAZEM`. Estoque escondido é pior do que estoque
   estranho. Vale checar com o time do sistema por que essas saem sem armazém.
2. **`ARMC1` aparece na extração e está no gabarito**, com 42 unidades —
   materiais de consumo. Se materiais de consumo não devem entrar na leitura
   de estoque de produto, o certo é filtrá-los no `ingest.js` (não esconder na
   tela), e isso muda o total geral apresentado. Hoje eles **estão somados**.

---

## 5. Como o TXT é lido

O arquivo é um relatório de terminal em **largura fixa**, paginado, com o
cabeçalho repetido a cada página. Não é CSV: separar por espaço quebra, porque
a descrição do artigo tem espaços dentro dela.

As posições de coluna foram medidas na própria linha de régua do relatório (a
linha de underscores sob o cabeçalho) e estão em `COLUNAS_LINHA` /
`COLUNAS_ARTIGO`, no topo do `ingest.js`. **Se o layout da extração mudar, é
só ali que se mexe.**

Dois detalhes que não são óbvios:

- **A família não está na linha do produto.** Ela vem numa linha
  `Familia ...:` no cabeçalho de cada página e vale para todas as linhas
  seguintes. O parser carrega essa família como estado enquanto varre.
- **A marca não existe como campo.** Ela está embutida no nome da família
  (`043 OLYMPIKUS TENIS FB.BRASIL`). Em vez de deixar o código adivinhar por
  substring — frágil, porque `UA` casa dentro de outras palavras — a relação
  família → marca é **dado**, na tabela `dim_familias`. Família nova que
  apareça e não esteja cadastrada cai em `NÃO MAPEADA` e o dashboard avisa,
  em vez de somar silenciosamente no lugar errado.

---

## 6. Padrões herdados do Report E-commerce

Estão implementados desde o primeiro commit, para não repetir bugs já
resolvidos lá (README raiz, seção 3):

- **Paginação segura** — para só quando a página volta vazia, e o offset avança
  pelo tamanho real retornado. Nunca assumir que "voltou menos que pedi"
  significa "acabou": foi a causa do card que mostrava 100% de um único
  segmento.
- **Deduplicação antes do insert** — com uma diferença importante em relação ao
  e-commerce: lá o certo era manter o registro de status mais avançado; aqui
  duas linhas iguais seriam duas posições do mesmo SKU no mesmo armazém, então
  o certo é **somar** (e recalcular o preço médio ponderado). Descartar uma
  perderia estoque real. No arquivo atual não há colisão — a trava é preventiva.
- **Data sempre em UTC na gravação**, conversão para Brasília só na exibição,
  via `Intl.DateTimeFormat` com timezone fixo. Nunca somar ou subtrair horas
  na mão.
- **Gzip no upload** do arquivo original, com fallback para o upload cru.
  O TXT tem ~10 MB.
- **Linha de total marcada por classe**, nunca por `:last-child`. Estilizar "a
  última linha" por posição fez a 10ª linha de um Top 10 parecer total geral
  no report do e-commerce.
- **RLS desde o início** — desta vez não fica pendente.

---

## 7. Próximos passos

**Antes de liberar para mais gente:**

1. Testar a RLS **pela API, não só pela tela**: faça um `select` em
   `estoque_posicoes` usando só a anon key, sem login. Tem que voltar vazio.
   Se voltar dado, a RLS não está valendo.
2. Confirmar a hierarquia real de perfis da distribuidora. Hoje o schema herda
   `admin` / `gestor` / `operador` do CD, que pode não ser a hierarquia certa
   aqui.

**Perguntas de negócio ainda em aberto** (nenhuma bloqueia a apresentação):

- O que significam `VS` / `VN` / `IN` / `IS`?
- `ARMC1` (materiais de consumo) deve entrar no total de estoque?
- Por que 10 linhas saem sem armazém?
- Qual a frequência de atualização — diária, semanal, sob demanda?
- Existe conceito de estoque parado há N dias (equivalente ao FIFO do CD)?
  Se sim, com que régua de corte?

**Evoluções naturais desta base**, quando você mapear o resto dos processos:

- 4º nível na árvore (artigo, e depois cor/tamanho) — o dado já está gravado em
  `estoque_posicoes`, é só carregar sob demanda ao abrir a família.
- Comparativo entre extrações (Atual × Anterior × Δ%), no formato exato do dash
  financeiro. `estoque_extracoes` já guarda o histórico; falta só uma segunda
  carga para comparar.
- Novas páginas (romaneio, faturamento, transportadora) como novas linhas em
  `dashboard_snapshots`, sem mudança de schema.
