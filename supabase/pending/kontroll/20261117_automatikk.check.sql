-- Bare SELECT. Før/etter 20261117_automatikk.PENDING.sql.
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and ((table_name = 'invoice_match_settings' and column_name in
   ('deposit_as_follow_item','auto_requeue_stale_enabled','auto_requeue_batch_size','auto_requeue_min_age_days'))
   or (table_name = 'invoice_lines' and column_name = 'deposit_parent_line_id'));
select to_regclass('public.rm_key_material_limits') as nokkelgrenser;
select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as authenticated_kan,
       has_function_privilege('anon', p.oid, 'execute') as anon_kan
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('rm_mark_deposit_follow_items','rm_requeue_stale_open_invoices','rm_automation_tick','rm_cap_automatikk_v1');
-- Pantlinjer i dag (16.11.2026: 130 auto-koblet med prisobservasjon, 13 åpne uten kobling).
select l.match_confidence, l.requires_review, count(*) as linjer,
       count(*) filter (where exists (select 1 from raw_material_price_history h where h.invoice_line_id = l.id and h.superseded_at is null)) as med_prisobservasjon
  from invoice_lines l where l.line_kind = 'pant' group by 1, 2 order by 3 desc;
-- Eldste åpne fakturaer (kandidater for automatisk omberegning), bare telling.
select count(*) as apne_fakturaer_med_apne_linjer from invoices i
 where i.status in ('imported','needs_review','ready') and i.flagged_at is null
   and exists (select 1 from invoice_lines l where l.invoice_id = i.id and l.requires_review);
-- Uendret avhengighet (lest 16.11.2026): rm_rematch_invoices md5 6bc2d41f8fb1e555176537651d3837cd
select md5(replace(pg_get_functiondef('public.rm_rematch_invoices'::regproc), chr(13), '')) as rematch_md5;
