-- Kontroll for 20261124_raske_oppslag_del2_rls.PENDING.sql. Bare SELECT. Kjør FØR (alle ok = true) og ETTER (alle ok = true).
-- FØR
select 'invoices_select er dagens tekst' kontroll, md5(qual) = 'd3094b3319b46be45f7971f6302631a0' ok
  from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_select'
union all select 'invoice_lines_select er dagens tekst', md5(qual) = 'd1ffa1e563ff2391ebfdd08b491299c1'
  from pg_policies where schemaname = 'public' and tablename = 'invoice_lines' and policyname = 'invoice_lines_select'
union all select 'hjelper finnes ikke', to_regprocedure('public.rm_invoice_read_entity_ids()') is null
union all select 'ingen fakturaer uten selskap', not exists (select 1 from invoices where legal_entity_id is null);

-- ETTER
select 'rm_invoice_read_entity_ids (md5)' kontroll, md5(replace(pg_get_functiondef('public.rm_invoice_read_entity_ids()'::regprocedure), chr(13), '')) = '9a0fc472cc331c60eb09a0b69c3aecdd' ok
union all select 'invoices_select ny tekst', md5(qual) = 'ae52672e5625d1e2b14c15784afb310d'
  from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_select'
union all select 'invoice_lines_select ny tekst', md5(qual) = '0a7b2d5e20af33ed2b5a94ab39c8e21c'
  from pg_policies where schemaname = 'public' and tablename = 'invoice_lines' and policyname = 'invoice_lines_select'
union all select 'fortsatt bare to lesepolicyer, gjelder alle roller (public)',
  (select count(*) = 2 and bool_and(roles = '{public}' and permissive = 'PERMISSIVE') from pg_policies
    where schemaname = 'public' and tablename in ('invoices','invoice_lines') and cmd in ('SELECT','ALL'))
union all select 'skrivepolicyene er uendret (6 stk)', (select count(*) = 6 from pg_policies where schemaname = 'public'
    and tablename in ('invoices','invoice_lines') and cmd in ('INSERT','UPDATE','DELETE'))
union all select 'anon kan ikke kalle hjelperen', not has_function_privilege('anon', 'public.rm_invoice_read_entity_ids()', 'execute');

-- TILBAKE (bare hvis noe er galt) – gjenoppretter nøyaktig dagens tekst:
-- begin;
-- drop policy invoices_select on public.invoices;
-- create policy invoices_select on public.invoices for select using (has_ravarer_invoice_read_or_owner(legal_entity_id));
-- drop policy invoice_lines_select on public.invoice_lines;
-- create policy invoice_lines_select on public.invoice_lines for select using (EXISTS ( SELECT 1 FROM invoices i
--   WHERE ((i.id = invoice_lines.invoice_id) AND has_ravarer_invoice_read_or_owner(i.legal_entity_id))));
-- commit;
