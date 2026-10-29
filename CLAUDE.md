# CLAUDE.md — Report E-commerce · Vulcabras

Regras gerais de trabalho: `C:\Repositórios\CLAUDE.md`. Resumo: plano + modelo antes de editar, PT-BR, economia de créditos, aprovado vai direto para `main`.

## Leia por trechos
O `README.md` tem ~1.080 linhas. Leia só a seção que a tarefa pede:
| Seção | Assunto |
|---|---|
| 1 | Arquitetura (3 camadas, snapshots) |
| 2 | Identidade visual (referência para todos os projetos) |
| 3 | Padrões de engenharia e bugs já resolvidos |
| 4 | Onde entra cada novo indicador |
| 5 | Controle de acesso por perfil / RLS |
| 6 | Fluxo de trabalho de desenvolvimento |
| 7 | Como recriar para outro contexto (foi a base do DISTR) |
| 8 | Referências rápidas |
| 9 | Fluxo de Processos — E-commerce |

## Essencial
- Supabase `tawliuofpmfohylqdnix`. HTML estático, deploy Vercel a partir de `main`.
- Arquivos: `index.html` (tela), `ingest.js` (regras e carga), `relatorio.html`, `ecom-fluxo.js` (fluxo de processos), `planta3d.js` (planta 3D), `mapa-brasil.js`, migrações `migracao_*.sql`, seeds `seed_ecom_fluxo*.sql`.
- Ingest já trata Acompanhamento OP e Itens de NF (`CAMPOS_ITENS_NF`: Pedido de Venda, Código do Produto, Produto, Barra, Quantidade, Qtde. Atendida, Qtde. Faturada).
- `dim_embalas` (codigo_barra, segmento, marca) vem da skill **Embalas** (export HANA, semanal).
- RPC `produtividade_expedicao` é lida pelo site Produtividade.
- Topbar padrão: perfil + Tela cheia + Tema Claro/Escuro + Sair.
- Cores das marcas: Olympikus `#297ADF`, Mizuno `#DFBD41`, Under Armour `#C8102E`.

## Pendências abertas
- **Plano de limpeza dos endereços (pedido do Fábio, alinhar com Rafaela/Fênix):** só calçados (A, B, C), camada de cima com até 10 caixas, 15 dias de 03/11 a 19/11, do piso 4 ao 1. Aguardando respostas: cenário 1 (todos os níveis, 16.697 endereços) ou 2 (só nível 03, 5.563); equipe e turno da Fênix; sábados; serviço a reduzir; piso dos mezaninos vazado ou fechado; alcance do nível 03; material; local do acidente; formato da entrega.
- Fase 2 do telão (Produtividade): resumo em itens da Tela C cruzando OP × Itens NF × dim_embalas.
