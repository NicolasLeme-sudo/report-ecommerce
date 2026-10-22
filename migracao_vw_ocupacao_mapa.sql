-- Planta 3D da ocupação (tela Estoque, planta3d.js).
-- Agrega o Estoque WMS por endereço (balanco_wms_detalhado, gravado no "Atualizar Balanço")
-- em bloco × rua × prédio × piso, para o navegador ler ~8 mil linhas em vez de ~300 mil.
-- Só expõe ocupação agregada (sem SKU nem valor): roda com o dono da view, então qualquer
-- usuário logado vê o mapa mesmo sem acesso à tabela de detalhe. Anônimo não tem acesso.
create or replace view public.vw_ocupacao_mapa as
select substr(local, 1, 1)               as bloco,
       substr(local, 2, 2)::int          as rua,
       substr(local, 4, 3)::int          as predio,
       substr(local, 7, 1)::int          as piso,
       count(distinct local)             as enderecos,
       sum(estoque_total)                as saldo,
       max(gerado_em)                    as gerado_em
from public.balanco_wms_detalhado
where tipo_local = 'PICKING'
  and local ~ '^[ABCEFG][0-9]{8}$'
group by 1, 2, 3, 4;

alter view public.vw_ocupacao_mapa set (security_invoker = false);
revoke all on public.vw_ocupacao_mapa from anon;
grant select on public.vw_ocupacao_mapa to authenticated;
