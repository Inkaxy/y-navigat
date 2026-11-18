-- KONTROLL – bare SELECT, skriver ingenting. Hører til 20261113_line_extraction_release_requeue.PENDING.sql.

-- 1) Før: md5 = cb553c3def46e26a75e50ddd7d7758eb og requeue finnes ikke. Etter: release_attempt finnes, requeue finnes.
select md5(pg_get_functiondef('public.rm_fail_invoice_line_extraction(uuid,uuid,jsonb)'::regprocedure)) as fail_md5,
       position('release_attempt' in pg_get_functiondef('public.rm_fail_invoice_line_extraction(uuid,uuid,jsonb)'::regprocedure)) > 0 as har_release,
       to_regprocedure('public.rm_requeue_invoice_line_extraction(uuid,uuid[])') is not null as requeue_finnes;

-- 2) Gruppe 1 i «Les på nytt i bolk»: ferdig lest uten linjer, «PDF-en ga ingen lesbare linjer», siden 19.10.2026.
--    Forventet 13.11.2026: 45. Viser også om noe ville blitt hoppet over av vaktene.
select count(*) as antall,
       count(*) filter (where public._rm_invoice_extraction_blocker(i.id) is not null) as sperret,
       min(i.invoice_date) as fra, max(i.invoice_date) as til
  from public.invoices i
 where i.tripletex_supplier_invoice_id is not null
   and i.line_extraction_status = 'done' and i.lines_sum_status = 'no_lines'
   and i.line_extraction_error = 'PDF-en ga ingen lesbare linjer'
   and i.invoice_date >= date '2026-10-19';

-- 3) Rettigheter: bare authenticated (og eier) kan kjøre requeue.
select grantee, privilege_type from information_schema.routine_privileges
 where routine_schema = 'public' and routine_name = 'rm_requeue_invoice_line_extraction' order by grantee;
