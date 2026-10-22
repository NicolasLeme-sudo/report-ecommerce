-- Cadastro de endereços do WMS (tela Armazém → Exportação .tsv), carregado em
-- Abastecimento → "Cadastro de Endereços (WMS)" (processarCadastroEnderecos, ingest.js).
-- Fonte oficial de quais endereços de picking existem: a planta 3D, o "Endereços com
-- disponibilidade" e a capacidade do piso 1 usam os ATIVOS de setor Calçados/Confecção.
create table if not exists public.wms_enderecos (
  local text primary key, bloco text not null, rua int not null, predio int not null, andar int not null, apto int not null,
  lado text, setor text, regiao text, ativo boolean not null, estoque boolean, skus int,
  carregado_em timestamptz not null default now()
);
alter table public.wms_enderecos enable row level security;
create policy leitura_autenticados on public.wms_enderecos for select to authenticated using (true);
create policy escrita_somente_admin on public.wms_enderecos for all to authenticated
  using ((select perfil_atual()) = 'admin') with check ((select perfil_atual()) = 'admin');

create or replace view public.vw_enderecos_predio with (security_invoker = true) as
select bloco, rua, predio, andar, regiao, setor, count(*) as enderecos,
       array_agg(apto order by apto) as aptos, max(carregado_em) as carregado_em
from public.wms_enderecos
where ativo and setor in ('CALÇADOS', 'CONFECÇÃO')
group by bloco, rua, predio, andar, regiao, setor;
revoke all on public.vw_enderecos_predio from anon;
grant select on public.vw_enderecos_predio to authenticated;
