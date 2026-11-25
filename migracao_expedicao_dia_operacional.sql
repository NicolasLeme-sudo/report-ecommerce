-- Banco do REPORT E-commerce (projeto tawliuofpmfohylqdnix). Criado em 25/11/2026. Rodar UMA vez no SQL Editor.
--
-- Expedição por dia OPERACIONAL: a operação vai das 01h às 01h (o 2º turno acaba às 00h16 e a madrugada ainda é o dia anterior),
-- igual ao telão da Produtividade. Antes o dia era o civil (BRT) de processado_em e as notas embarcadas entre 00h00 e 00h59
-- caíam no dia seguinte (24/11: 51 notas, 51 peças a menos que o telão).
--
-- processado_em é "timestamp without time zone" guardado em UTC: converte para BRT, tira 1 hora e pega a data.
-- Critério igual ao do fallback do ingest.js (expedicaoPorDiaDoBanco): situacao EXPEDIDO, não cancelado, com processado_em.
-- Refecha do 1º dia do mês (ou 7 dias atrás, o que for mais antigo) até ONTEM operacional; o dia de hoje o ingest soma ao vivo.

drop function if exists public.refechar_expedicao_mes();

create function public.refechar_expedicao_mes()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hoje date := ((now() at time zone 'America/Sao_Paulo') - interval '1 hour')::date;   -- hoje operacional
  v_ini  date := least(date_trunc('month', v_hoje)::date, v_hoje - 7);
begin
  insert into public.expedicao_diaria as e (data, itens_expedidos, pedidos_expedidos)
  select d.dia, d.itens, d.pedidos
    from (
      select (((p.processado_em at time zone 'UTC') at time zone 'America/Sao_Paulo') - interval '1 hour')::date as dia,
             coalesce(sum(p.qtd_total_produto), 0)::bigint as itens,
             count(*)::bigint as pedidos
        from public.pedidos p
       where p.situacao = 'EXPEDIDO'
         and p.processado_em is not null
         and coalesce(p.status_calculado, '') <> 'Cancelado'
         and p.processado_em >= (v_ini::timestamp + interval '1 hour') at time zone 'America/Sao_Paulo' at time zone 'UTC'
       group by 1
    ) d
   where d.dia >= v_ini and d.dia < v_hoje
  on conflict (data) do update
    set itens_expedidos = excluded.itens_expedidos,
        pedidos_expedidos = excluded.pedidos_expedidos;
end
$$;

grant execute on function public.refechar_expedicao_mes() to anon, authenticated;

-- Conferir (24/11 deve passar de 12.013 para 12.064 itens): select * from public.expedicao_diaria where data >= '2026-11-20' order by data;
