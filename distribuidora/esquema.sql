-- ============================================================================
-- REPORT DISTRIBUIDORA — Esquema inicial (Supabase / Postgres)
-- ============================================================================
-- Escopo desta versão: apenas o domínio ESTOQUE (Posição de Stock — Locais de
-- Stockagem, extração EX000914 do sistema).
--
-- A estrutura conceitual é a mesma do Report E-commerce (ver README seção 1):
--   • tabelas de apoio por domínio  → o ingest lê/escreve nelas
--   • dashboard_snapshots           → uma linha "mais recente" por página,
--                                     com o JSON JÁ PRONTO para renderizar
--
-- Rode este arquivo inteiro no SQL Editor do Supabase (projeto NOVO, dedicado
-- à distribuidora — não reaproveitar o projeto do CD, conforme README 7.3.1).
-- É idempotente: pode rodar de novo sem quebrar.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) DIMENSÃO: ARMAZÉNS (gabarito fornecido pela operação)
-- ----------------------------------------------------------------------------
-- Existe para que o dashboard mostre o NOME do armazém, não só a sigla, e para
-- que a ordem de exibição seja controlada pelo negócio (ordem), não alfabética.
create table if not exists dim_armazens (
  codigo      text primary key,
  descricao   text not null,
  categoria   text,               -- 'DISPONIVEL' | 'BLOQUEADO' | 'ANALISE'
  ordem       int  not null default 99
);

insert into dim_armazens (codigo, descricao, categoria, ordem) values
  ('AC190', 'Armazém Físico segregado em PULMÃO e PICKING', 'DISPONIVEL', 1),
  ('ARAMO', 'Armazém de Faltas/Material em Análise',        'ANALISE',    2),
  ('ARMC1', 'Armazém de Materiais de Consumo',              'ANALISE',    3),
  ('ARMFT', 'Armazém de Faltas de Recebimento',             'ANALISE',    4),
  ('ARMRP', 'Armazém de Material Reprovado na Qualidade',   'BLOQUEADO',  5),
  ('DEVFT', 'Armazém de Faltas de Devolução',               'BLOQUEADO',  6),
  ('SEM_ARMAZEM', 'Sem armazém informado na extração',      'ANALISE',   90)
on conflict (codigo) do update
  set descricao = excluded.descricao,
      categoria = excluded.categoria,
      ordem     = excluded.ordem;

-- ----------------------------------------------------------------------------
-- 2) DIMENSÃO: FAMÍLIAS → MARCA
-- ----------------------------------------------------------------------------
-- A marca NÃO vem como campo próprio no TXT: ela está embutida no nome da
-- família (ex.: "043 OLYMPIKUS TENIS FB.BRASIL"). Em vez de deixar o ingest
-- adivinhar por substring a cada execução (frágil — "UA" casa dentro de outras
-- palavras), a relação família→marca fica explícita aqui, como dado.
-- Família nova que apareça no TXT e não esteja aqui cai em marca 'NAO MAPEADA'
-- e aparece destacada no dashboard, em vez de somar silenciosamente no lugar
-- errado.
create table if not exists dim_familias (
  codigo      text primary key,   -- '043', '101', ...
  nome        text not null,
  marca       text not null,      -- 'OLYMPIKUS' | 'UNDER ARMOUR' | 'MIZUNO'
  categoria   text                -- 'TENIS' | 'VESTUARIO' | 'ACESSORIO' | ...
);

insert into dim_familias (codigo, nome, marca, categoria) values
  ('043', 'OLYMPIKUS TENIS FB.BRASIL', 'OLYMPIKUS',    'TENIS'),
  ('054', 'CHINELOS OLYMPIKUS FB BR',  'OLYMPIKUS',    'CHINELO'),
  ('060', 'VESTUARIO OLYMP.TERCEIROS', 'OLYMPIKUS',    'VESTUARIO'),
  ('061', 'ACESSORIO OLYMP.TERCEIROS', 'OLYMPIKUS',    'ACESSORIO'),
  ('068', 'MEIAS OLYMPIKUS',           'OLYMPIKUS',    'MEIA'),
  ('080', 'TENIS UA FABRICADO BRASIL', 'UNDER ARMOUR', 'TENIS'),
  ('081', 'TENIS UA COMPRADO',         'UNDER ARMOUR', 'TENIS'),
  ('082', 'VESTUARIO UA COMPRADO',     'UNDER ARMOUR', 'VESTUARIO'),
  ('083', 'ACESSORIO UA COMPRADO',     'UNDER ARMOUR', 'ACESSORIO'),
  ('084', 'MEIA UA COMPRADO',          'UNDER ARMOUR', 'MEIA'),
  ('086', 'CHINELO UA FB BRASIL',      'UNDER ARMOUR', 'CHINELO'),
  ('087', 'CHINELO UA COMPRADO',       'UNDER ARMOUR', 'CHINELO'),
  ('101', 'TENIS MZ FABRICADO BRASIL', 'MIZUNO',       'TENIS'),
  ('102', 'TENIS MIZUNO COMPRADO',     'MIZUNO',       'TENIS'),
  ('103', 'VESTUARIO MIZUNO COMPRADO', 'MIZUNO',       'VESTUARIO'),
  ('104', 'ACESSORIO MIZUNO COMPRADO', 'MIZUNO',       'ACESSORIO'),
  ('105', 'MEIAS MIZUNO COMPRADA',     'MIZUNO',       'MEIA'),
  ('106', 'CHINELOS MIZUNO FB BR',     'MIZUNO',       'CHINELO'),
  ('107', 'CHUTEIRA MIZUNO FB BRASIL', 'MIZUNO',       'CHUTEIRA'),
  ('108', 'CHUTEIRA MIZUNO IMPORTADA', 'MIZUNO',       'CHUTEIRA'),
  ('109', 'VEST.MIZUNO CLUBE COMPRAD', 'MIZUNO',       'VESTUARIO')
on conflict (codigo) do update
  set nome = excluded.nome, marca = excluded.marca, categoria = excluded.categoria;

-- ----------------------------------------------------------------------------
-- 3) EXTRAÇÕES (cabeçalho de cada arquivo processado)
-- ----------------------------------------------------------------------------
-- Uma linha por arquivo TXT processado. Guarda os totais que o PRÓPRIO sistema
-- imprime no rodapé ("** TOTAL GERAL"), para que o ingest possa conferir o que
-- ele parseou contra o que o sistema afirma. Se divergir, o dashboard mostra o
-- alerta — em vez de apresentar um número errado com cara de certo.
create table if not exists estoque_extracoes (
  id                  uuid primary key default gen_random_uuid(),
  arquivo_nome        text not null,
  data_extracao       date,             -- data impressa no cabeçalho do relatório
  estabelecimento     text,             -- 'DISTR'
  gerado_em           timestamptz not null default now(),  -- SEMPRE UTC
  linhas_lidas        int,
  qtd_total_parseada  numeric(18,3),
  valor_total_parseado numeric(18,3),
  qtd_total_sistema   numeric(18,3),    -- do "** TOTAL GERAL" do arquivo
  valor_total_sistema numeric(18,3),
  storage_path        text              -- caminho do .gz no bucket de backup
);

-- ----------------------------------------------------------------------------
-- 4) FATO: POSIÇÃO DE ESTOQUE
-- ----------------------------------------------------------------------------
-- Grão = uma linha do TXT: status × família × artigo × cor × tamanho × armazém.
-- Foi verificado no arquivo real (25.371 linhas) que essa combinação é única —
-- por isso ela é a chave natural do UNIQUE abaixo. O ingest ainda assim
-- deduplica em memória antes do insert (padrão do README 3.2): se uma extração
-- futura repetir a chave, ele SOMA as quantidades em vez de estourar 409.
create table if not exists estoque_posicoes (
  id              bigserial primary key,
  extracao_id     uuid not null references estoque_extracoes(id) on delete cascade,
  status_artigo   text not null,          -- VS | VN | IN | IS
  familia_codigo  text not null,
  marca           text not null,
  armazem         text not null,          -- AC190, ARAMO, ... ou SEM_ARMAZEM
  estabelecimento text,                   -- EXTRE
  artigo_codigo   text not null,
  cor             text,
  tamanho         text,
  descricao       text,
  unidade         text,                   -- PAR | UN
  qtd             numeric(18,3) not null default 0,
  preco_medio     numeric(18,4),
  valor           numeric(18,3) not null default 0,
  constraint estoque_posicoes_chave_natural unique
    (extracao_id, status_artigo, familia_codigo, armazem, artigo_codigo, cor, tamanho)
);

create index if not exists idx_estoque_pos_extracao on estoque_posicoes (extracao_id);
create index if not exists idx_estoque_pos_arm_marca on estoque_posicoes (extracao_id, armazem, marca);
create index if not exists idx_estoque_pos_familia on estoque_posicoes (extracao_id, familia_codigo);

-- ----------------------------------------------------------------------------
-- 5) DASHBOARD_SNAPSHOTS (a tabela que o index.html realmente lê)
-- ----------------------------------------------------------------------------
-- Mesma estrutura conceitual do Report E-commerce: uma linha por página, com o
-- JSON já agregado e pronto para desenhar. O index.html NUNCA soma nada: ele
-- lê o snapshot mais recente da página e renderiza.
-- Hoje só existe a página 'estoque'; as demais (romaneio, faturamento, etc.)
-- entram como novas linhas aqui, sem mudança de schema.
create table if not exists dashboard_snapshots (
  id          bigserial primary key,
  pagina      text not null,
  payload     jsonb not null,
  gerado_em   timestamptz not null default now(),   -- SEMPRE UTC (README 3.3)
  extracao_id uuid references estoque_extracoes(id) on delete set null
);

create index if not exists idx_snapshots_pagina_data
  on dashboard_snapshots (pagina, gerado_em desc);

-- ----------------------------------------------------------------------------
-- 6) PERFIS DE ACESSO
-- ----------------------------------------------------------------------------
-- Mesmo modelo do Report E-commerce, mas com a RLS resolvida DESDE O INÍCIO —
-- essa era a lacuna registrada na seção 5.2 do README e o item 4 do checklist
-- de recriação. Os papéis abaixo são o ponto de partida (herdados do CD);
-- ajustar quando a hierarquia real da distribuidora estiver mapeada.
create table if not exists perfis_acesso (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  role     text not null check (role in ('admin','gestor','operador')),
  nome     text,
  criado_em timestamptz not null default now()
);

-- Função auxiliar: papel do usuário autenticado.
-- SECURITY DEFINER + search_path fixo para que a policy consiga ler
-- perfis_acesso sem cair na própria RLS (recursão infinita).
create or replace function public.meu_papel()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from perfis_acesso where user_id = auth.uid();
$$;

-- ============================================================================
-- 7) ROW LEVEL SECURITY
-- ============================================================================
-- IMPORTANTE (README 5.2): esconder o menu no front NÃO protege o dado. Quem
-- tiver a anon key e souber usar a API do Supabase lê tudo se não houver
-- policy. Por isso a RLS entra junto com o schema, não depois.
--
-- Regra desta versão: qualquer usuário AUTENTICADO com perfil cadastrado lê o
-- estoque. Ninguém anônimo lê nada. Escrita (o ingest) é restrita a admin.
-- Quando surgirem páginas sensíveis (equivalentes à Reversa do CD), basta
-- restringir por 'pagina' na policy de dashboard_snapshots — o gancho já está
-- pronto no comentário abaixo.

alter table dim_armazens        enable row level security;
alter table dim_familias        enable row level security;
alter table estoque_extracoes   enable row level security;
alter table estoque_posicoes    enable row level security;
alter table dashboard_snapshots enable row level security;
alter table perfis_acesso       enable row level security;

-- LEITURA -------------------------------------------------------------------
drop policy if exists ler_dim_armazens on dim_armazens;
create policy ler_dim_armazens on dim_armazens
  for select to authenticated using (meu_papel() is not null);

drop policy if exists ler_dim_familias on dim_familias;
create policy ler_dim_familias on dim_familias
  for select to authenticated using (meu_papel() is not null);

drop policy if exists ler_extracoes on estoque_extracoes;
create policy ler_extracoes on estoque_extracoes
  for select to authenticated using (meu_papel() is not null);

drop policy if exists ler_posicoes on estoque_posicoes;
create policy ler_posicoes on estoque_posicoes
  for select to authenticated using (meu_papel() is not null);

drop policy if exists ler_snapshots on dashboard_snapshots;
create policy ler_snapshots on dashboard_snapshots
  for select to authenticated using (
    meu_papel() is not null
    -- GANCHO para página restrita, quando existir. Exemplo:
    -- and (pagina <> 'reversa' or meu_papel() = 'admin')
  );

-- Cada usuário enxerga apenas o próprio perfil (evita listar quem é admin).
drop policy if exists ler_meu_perfil on perfis_acesso;
create policy ler_meu_perfil on perfis_acesso
  for select to authenticated using (user_id = auth.uid());

-- ESCRITA (só admin — é o perfil que roda o ingest) --------------------------
drop policy if exists gravar_extracoes on estoque_extracoes;
create policy gravar_extracoes on estoque_extracoes
  for all to authenticated using (meu_papel() = 'admin') with check (meu_papel() = 'admin');

drop policy if exists gravar_posicoes on estoque_posicoes;
create policy gravar_posicoes on estoque_posicoes
  for all to authenticated using (meu_papel() = 'admin') with check (meu_papel() = 'admin');

drop policy if exists gravar_snapshots on dashboard_snapshots;
create policy gravar_snapshots on dashboard_snapshots
  for all to authenticated using (meu_papel() = 'admin') with check (meu_papel() = 'admin');

-- ============================================================================
-- 8) DEPOIS DE RODAR ESTE ARQUIVO
-- ============================================================================
-- a) Crie o bucket PRIVADO de backup:
--      Storage → New bucket → nome: backups → Public: OFF
--
-- b) Crie seu usuário em Authentication → Users → Add user (email + senha).
--
-- c) Pegue o UUID dele e cadastre o perfil admin:
--      insert into perfis_acesso (user_id, role, nome)
--      values ('COLE-O-UUID-AQUI', 'admin', 'Seu Nome');
--
-- d) Teste a RLS pela API, não só pela tela (README 5.2, item 3): faça um
--    select em estoque_posicoes usando só a anon key, sem login. Tem que
--    voltar vazio. Se voltar dado, a RLS não está valendo — pare e corrija
--    antes de liberar o link.
-- ============================================================================
