-- Kontroll etter 20261119_godta_sum.PENDING.sql. Bare SELECT.
select 'funksjonene finnes' as kontroll,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('rm_accept_invoice_sum','rm_undo_accept_invoice_sum','rm_cap_godta_sum_v1')) = 3 as ok
union all select 'anon har ikke tilgang',
       not has_function_privilege('anon', 'public.rm_accept_invoice_sum(uuid,text,text,text,uuid)', 'execute')
       and not has_function_privilege('anon', 'public.rm_undo_accept_invoice_sum(uuid,uuid)', 'execute')
union all select 'authenticated har tilgang',
       has_function_privilege('authenticated', 'public.rm_accept_invoice_sum(uuid,text,text,text,uuid)', 'execute')
       and has_function_privilege('authenticated', 'public.rm_undo_accept_invoice_sum(uuid,uuid)', 'execute')
union all select 'statusbegrensningen er uendret',
       (select pg_get_constraintdef(oid) from pg_constraint where conname = 'invoices_lines_sum_status_check')
         = 'CHECK ((lines_sum_status = ANY (ARRAY[''not_checked''::text, ''ok''::text, ''mismatch''::text, ''no_lines''::text, ''no_total''::text])))'
union all select 'cap', public.rm_cap_godta_sum_v1();
