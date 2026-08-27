---
name: consolidar-base-hana
description: Consolida em uma única base as informações de colunas específicas das abas Mizuno, Olympikus e Under Armour de um export Excel da base HANA (relatório e-commerce). Use sempre que o usuário mandar/anexar um Excel com essas 3 abas e pedir para gerar a "base final", consolidar/juntar as abas, montar a planilha semanal de cadastro, ou mencionar "base HANA", mesmo sem citar o nome exato da skill.
---

# Consolidar Base HANA

## Quando usar

O time de cadastro manda, toda semana, um export da base HANA em `.xlsx` com 3
abas: **Mizuno**, **Olympikus** e **Under Armour**. Esta skill lê essas 3
abas, extrai um conjunto fixo de colunas de cada uma, calcula MARCA e
SEGMENTO, e devolve um único arquivo com uma aba "Base Final" pronta para
uso — sem precisar remapear nada manualmente toda vez, mesmo que os dados
mudem.

Use sempre que o usuário anexar um Excel com essas abas (ou nomes parecidos)
e pedir para consolidar, juntar, gerar a base final, ou "rodar a planilha da
semana".

## Como funciona

Todo o trabalho pesado está em `scripts/consolidate.py`. Ele:

1. Localiza as 3 abas de origem pelo nome (tolera variações como
   "under armour", "UnderArmour", maiúsculas/minúsculas).
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
   | 11 | MARCA | calculada: nome da aba de origem (Mizuno / Olympikus / Under Armour) |
   | 12 | SEGMENTO | calculada a partir do texto de "Nome do grupo" (ver regra abaixo) |

4. Todas as linhas de todas as abas entram na base final — não há filtro por
   `SKUCOMERCIAL?` nem por nenhuma outra coluna.
5. Gera um novo `.xlsx` com uma única aba **"Base Final"**.

### Regra do SEGMENTO

A coluna "Nome do grupo" traz marca + segmento juntos e, no caso da Under
Armour, vem em inglês (o fornecedor entrega assim). O script traduz e
padroniza por substring, case-insensitive:

| Texto contém | SEGMENTO final |
|---|---|
| "Calçados" ou "Footwear" | Calçados |
| "Acessórios" ou "Accessories" | Acessórios |
| "Apparel" ou "Vestuário" | Vestuário |

Se nenhuma regra bater, o script mantém o texto original naquela linha (para
não travar a execução) e sinaliza no relatório final que precisa de revisão
manual — isso normalmente indica um segmento novo que ainda não existe na
tabela acima e vale a pena adicionar.

## Como executar

```bash
python .claude/skills/consolidar-base-hana/scripts/consolidate.py <arquivo_entrada.xlsx> [<arquivo_saida.xlsx>]
```

Se o caminho de saída não for passado, o script gera
`<nome_original>_Final.xlsx` na mesma pasta do arquivo de entrada.

Passos ao usar esta skill numa conversa:

1. Salve o arquivo enviado pelo usuário em disco (ex.: no diretório de
   scratchpad da sessão).
2. Rode o script apontando para esse arquivo.
3. Leia a saída do script no terminal — ela traz quantas linhas foram
   consolidadas por aba e um resumo de qualquer inconsistência (segmento não
   mapeado, campo ausente). Reporte esse resumo ao usuário em texto, não só
   o arquivo.
4. Entregue o `.xlsx` gerado ao usuário (via `SendUserFile` ou equivalente).

## Se a estrutura mudar

Se, um dia, o time de cadastro mudar nomes de aba, nomes de cabeçalho, ou
surgir uma 4ª marca, ajuste apenas as constantes no topo de
`scripts/consolidate.py`:

- `SOURCE_SHEETS` — nomes/aliases das abas de origem.
- `HEADER_ALIASES` — nomes/aliases de cada cabeçalho procurado.
- `FINAL_COLUMNS` — colunas e ordem da base final.
- `SEGMENTO_RULES` — regras de tradução do segmento.

Não é necessário reescrever a lógica de leitura — ela já busca por nome de
cabeçalho e é resiliente a deslocamento de colunas entre abas.
