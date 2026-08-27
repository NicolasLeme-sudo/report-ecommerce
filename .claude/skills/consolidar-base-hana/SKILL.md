---
name: consolidar-base-hana
description: Consolida em uma única base as informações de colunas específicas das abas Mizuno, Olympikus e Under Armour de um export Excel da base HANA (relatório e-commerce). Use sempre que o usuário mandar/anexar um Excel com essas 3 abas e pedir para gerar a "base final", consolidar/juntar as abas, montar a planilha semanal de cadastro, ou mencionar "base HANA", mesmo sem citar o nome exato da skill.
---

# Consolidar Base HANA

## Quando usar

O time de cadastro manda, toda semana, um export da base HANA com dados de
**Mizuno**, **Olympikus** e **Under Armour**. Normalmente isso chega como um
único `.xlsx` com 3 abas — mas já aconteceu de chegar como **3 arquivos
separados** (um por marca, em `.xlsb`, quando o workbook único ficou pesado
demais para enviar). Esta skill lê essas 3 fontes, extrai um conjunto fixo de
colunas de cada uma, calcula MARCA e SEGMENTO, e devolve um único arquivo com
uma aba "Base Final" pronta para uso — sem precisar remapear nada manualmente
toda vez, mesmo que os dados mudem.

Use sempre que o usuário anexar um Excel (ou um conjunto de Excels, um por
marca) com esses dados e pedir para consolidar, juntar, gerar a base final,
ou "rodar a planilha da semana".

## Como funciona

Todo o trabalho pesado está em `scripts/consolidate.py`. Ele:

1. Localiza as 3 marcas de origem pelo nome — primeiro tentando casar o nome
   da **aba** (tolera variações como "under armour", "UnderArmour",
   maiúsculas/minúsculas); se nenhuma aba bater em nenhum arquivo, cai para
   casar o nome do **arquivo** (necessário quando cada marca chega em um
   arquivo separado, com aba genérica tipo "Plan1" — foi assim que a Olympikus
   e a Under Armour vieram na prática). Lê tanto `.xlsx` quanto `.xlsb`.
2. Em cada aba, localiza as colunas necessárias **pelo nome do cabeçalho da
   linha 1**, não pela letra da coluna — isso é essencial porque a Under
   Armour vem deslocada 1 coluna para a direita em relação a Mizuno/Olympikus
   (e ainda tem uma coluna extra `SKUCOMERCIAL?` no início, que é ignorada).
3. Monta, para cada linha de cada aba, uma linha na base final com estas 12
   colunas, nesta ordem exata:

   | # | Coluna final | Origem |
   |---|---|---|
   | 1 | SKU | coluna "SKU" |
   | 2 | Códigodebarras | coluna "Código de barras" |
   | 3 | MaterialVulcaTam | coluna "MaterialVulcaTam" |
   | 4 | MaterialVulca | coluna "MaterialVulca" |
   | 5 | Artigo | coluna "Artigo" |
   | 6 | SKU | (repetida — mesmo valor da coluna 1) |
   | 7 | Descrição do item | coluna "Descrição do item" |
   | 8 | Nome do grupo | coluna "Nome do grupo" |
   | 9 | Códigodebarras | (repetida — mesmo valor da coluna 2) |
   | 10 | Colorway Description | coluna "Colorway Description" |
   | 11 | MARCA | calculada: normalmente a aba de origem, com exceção da OPANKA (ver abaixo) |
   | 12 | SEGMENTO | calculada a partir do texto de "Nome do grupo" (ver regras abaixo) |

4. Todas as linhas de todas as abas entram na base final — não há filtro por
   `SKUCOMERCIAL?` nem por nenhuma outra coluna.
5. Gera um novo `.xlsx` com uma única aba **"Base Final"**.

### Regra da MARCA

Na maioria dos casos a MARCA é simplesmente a aba de origem. A exceção é a
**OPANKA**: ela não tem estoque próprio e por isso não tem aba, mas tem
cadastro na base de embalagem e vem **dentro da aba Olympikus**, distinguível
apenas pelo texto de "Nome do grupo". O script detecta "opanka" no nome do
grupo e reclassifica a MARCA daquela linha para `OPANKA` — todos os produtos
dela são CHINELOS.

Por isso o relatório final mostra as contagens **por MARCA**, além das
contagens por aba: os dois números não batem quando há linhas OPANKA saindo
de dentro da Olympikus, e isso é esperado.

### Regra do SEGMENTO

A coluna "Nome do grupo" traz marca + segmento juntos e, no caso da Under
Armour, vem em inglês (o fornecedor entrega assim). O SEGMENTO final é sempre
**em caixa alta e no plural**, dentro deste conjunto fechado: `CALÇADOS`,
`VESTUÁRIOS`, `CHINELOS`, `ACESSÓRIOS`, `MEIAS`.

O script decide em três camadas, nesta ordem:

1. **Marca embutida** — "opanka" no nome do grupo ⇒ MARCA `OPANKA`, SEGMENTO
   `CHINELOS`.
2. **Override por grupo específico** — casos em que o nome do grupo não
   descreve o segmento de forma óbvia. Hoje há um: a linha de roupas do
   Botafogo da Mizuno vem marcada como **"FUTEBOL MIZUNO"**, e é vestuário —
   a palavra "futebol" sozinha não diria isso, por isso a regra é explícita.
3. **Tradução genérica por substring** (case/acento-insensitive):

   | Texto contém | SEGMENTO |
   |---|---|
   | "Chinelos", "Chinelo", "Sandals", "Slides" | CHINELOS |
   | "Meias", "Meia", "Socks" | MEIAS |
   | "Chuteiras", "Chuteira", "Calçados", "Footwear" | CALÇADOS |
   | "Acessórios", "Accessories" | ACESSÓRIOS |
   | "Apparel", "Vestuário" | VESTUÁRIOS |

   A ordem importa: chinelos e meias são checados antes de calçados e
   vestuário, porque um nome de grupo pode conter as duas palavras e o mais
   específico deve ganhar.

Se nenhuma regra bater, o script mantém o texto original naquela linha (para
não travar a execução) e sinaliza no relatório final que precisa de revisão
manual — isso normalmente indica um segmento ou uma linha de produto nova que
ainda não tem regra, e vale a pena adicionar em `SEGMENTO_RULES` (se for um
segmento genérico novo) ou em `SEGMENTO_OVERRIDES` (se for um caso específico
como o FUTEBOL MIZUNO).

## Como executar

```bash
# Um único arquivo com as 3 abas:
python .claude/skills/consolidar-base-hana/scripts/consolidate.py <arquivo.xlsx> [--output <arquivo_saida.xlsx>]

# Ou até 3 arquivos separados, um por marca (.xlsx ou .xlsb):
python .claude/skills/consolidar-base-hana/scripts/consolidate.py <mizuno.xlsb> <olympikus.xlsb> <under_armour.xlsb> --output <arquivo_saida.xlsx>
```

Se `--output` não for passado, o script gera `<nome_do_primeiro_arquivo>_Final.xlsx`
na mesma pasta do primeiro arquivo de entrada.

Ler `.xlsb` depende da biblioteca `pyxlsb` (`pip install pyxlsb`) — se ela não
estiver instalada e o usuário mandar um `.xlsb`, instale antes de rodar.

Passos ao usar esta skill numa conversa:

1. Salve o(s) arquivo(s) enviado(s) pelo usuário em disco (ex.: no diretório
   de scratchpad da sessão).
2. Rode o script apontando para eles.
3. Leia a saída do script no terminal — ela traz quantas linhas foram
   consolidadas por marca e um resumo de qualquer inconsistência (segmento não
   mapeado, campo ausente). Reporte esse resumo ao usuário em texto, não só
   o arquivo. Campo ausente não é necessariamente erro — "Colorway Description"
   legitimamente vem vazia em parte dos produtos; olhe QUAL coluna está
   faltando antes de tratar como problema.
4. Entregue o `.xlsx` gerado ao usuário (via `SendUserFile` ou equivalente).

## Se a estrutura mudar

Se, um dia, o time de cadastro mudar nomes de aba, nomes de cabeçalho, ou
surgir uma 4ª marca, ajuste apenas as constantes no topo de
`scripts/consolidate.py`:

- `SOURCE_SHEETS` — nomes/aliases das abas de origem.
- `HEADER_ALIASES` — nomes/aliases de cada cabeçalho procurado.
- `FINAL_COLUMNS` — colunas e ordem da base final.
- `MARCA_EMBUTIDA_RULES` — marcas sem aba própria, identificadas pelo nome do
  grupo (hoje: OPANKA dentro da Olympikus).
- `SEGMENTO_OVERRIDES` — grupos específicos cujo segmento não dá para deduzir
  do texto (hoje: FUTEBOL MIZUNO ⇒ VESTUÁRIOS).
- `SEGMENTO_RULES` — regras genéricas de tradução do segmento.

Não é necessário reescrever a lógica de leitura — ela já busca por nome de
cabeçalho e é resiliente a deslocamento de colunas entre abas.
