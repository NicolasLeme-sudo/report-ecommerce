-- ============================================================================
-- MIGRAÇÃO — RLS: operador lê o Fluxo de Processos (pagina='ecom_fluxo')
-- ============================================================================
-- A policy leitura_por_perfil de dashboard_snapshots libera o operador só nas
-- páginas outbound/inbound/reversa/estoque. O Fluxo de Processos é material de
-- treinamento, visível a todos os perfis (igual ao report-DISTR), então entra
-- 'ecom_fluxo' nessa lista. Sem isto o operador abre a tela e ela vem vazia,
-- sem erro nenhum (RLS falha em silêncio — README, seção 5.2).
--
-- A escrita NÃO muda: escrita_somente_admin continua valendo, só admin salva.
-- ============================================================================

drop policy if exists leitura_por_perfil on public.dashboard_snapshots;

create policy leitura_por_perfil on public.dashboard_snapshots
  for select to authenticated
  using (
    (select perfil_atual()) = any (array['gestor', 'admin'])
    or (
      (select perfil_atual()) = 'operador'
      and pagina = any (array['outbound', 'inbound', 'reversa', 'estoque', 'ecom_fluxo'])
    )
  );
