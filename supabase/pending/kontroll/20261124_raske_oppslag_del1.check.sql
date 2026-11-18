-- Kontroll for 20261124_raske_oppslag_del1.PENDING.sql. Bare SELECT/EXPLAIN. Kjør FØR (alle ok = true) og ETTER (alle ok = true).
-- md5-verdiene viser at filen er skrevet inn riktig (beregnet ved å kjøre filen i en lokal testdatabase; avviker live-verdien,
-- sammenlign teksten i pg_get_functiondef med filen før noe annet gjøres).
-- FØR
select 'ingen av de nye funksjonene finnes' kontroll,
       to_regprocedure('public.rm_cap_raske_oppslag_v1()') is null and to_regprocedure('public.rm_nav_counts(uuid)') is null
   and to_regprocedure('public.rm_price_jump_lines(uuid)') is null and to_regprocedure('public.rm_unread_invoices(uuid)') is null ok
union all select 'tilgangsfunksjonene finnes', to_regprocedure('public.has_ravarer_invoice_read_or_owner(uuid)') is not null
   and to_regprocedure('public.has_ravarer_access(uuid,uuid,access_level)') is not null;
-- FØR: tid i dag (som root). Noter «Execution Time».
explain (analyze, timing off, summary on) select public.rm_work_summary('751709bc-04b3-4449-867d-b97faa9ab373', false);

-- ETTER
select 'rm_nav_counts (md5)' kontroll, md5(replace(pg_get_functiondef('public.rm_nav_counts(uuid)'::regprocedure), chr(13), '')) = '7f112925ed2d04787180c48bda0f5550' ok
union all select 'rm_price_jump_lines (md5)', md5(replace(pg_get_functiondef('public.rm_price_jump_lines(uuid)'::regprocedure), chr(13), '')) = 'e8c86e45c54bb9f0aad00c7619321007'
union all select 'rm_unread_invoices (md5)', md5(replace(pg_get_functiondef('public.rm_unread_invoices(uuid)'::regprocedure), chr(13), '')) = 'dcf11116beefbeb51c9019a7ede4d997'
union all select 'markør (md5)', md5(replace(pg_get_functiondef('public.rm_cap_raske_oppslag_v1()'::regprocedure), chr(13), '')) = 'd9c2e60a840209400d5e8ccfdd296ab3'
union all select 'anon kan ikke kalle noen av dem', not has_function_privilege('anon', 'public.rm_nav_counts(uuid)', 'execute')
   and not has_function_privilege('anon', 'public.rm_price_jump_lines(uuid)', 'execute') and not has_function_privilege('anon', 'public.rm_unread_invoices(uuid)', 'execute')
   and not has_function_privilege('anon', 'public.rm_cap_raske_oppslag_v1()', 'execute')
union all select 'innloggede kan kalle dem', has_function_privilege('authenticated', 'public.rm_price_jump_lines(uuid)', 'execute')
union all select 'samme antall prishopp-linjer som direkte lesing',
   jsonb_array_length(public.rm_price_jump_lines('751709bc-04b3-4449-867d-b97faa9ab373')->'rows') =
   (select count(*) from invoice_lines il join invoices i on i.id = il.invoice_id
     where i.legal_entity_id = '751709bc-04b3-4449-867d-b97faa9ab373' and i.status in ('imported','needs_review','ready') and i.flagged_at is null
       and il.requires_review and il.excluded_at is null and il.price_variance_pct is not null and il.raw_material_id is not null)
union all select 'samme antall uleste som direkte lesing',
   jsonb_array_length(public.rm_unread_invoices('751709bc-04b3-4449-867d-b97faa9ab373')->'rows') =
   (select count(*) from invoices i where i.legal_entity_id = '751709bc-04b3-4449-867d-b97faa9ab373' and i.status in ('imported','needs_review','ready')
       and i.excluded_at is null and i.flagged_at is null and (i.line_extraction_status = 'failed' or i.line_extraction_error is not null or i.lines_sum_status = 'mismatch'))
union all select 'menyens merker = rm_work_summary',
   (select (n->>'datasheet_changes')::int = (s->'data_quality'->>'datasheet_changes')::int
       and (n->>'agreements_expiring_30d')::int = (s->'other'->>'agreements_expiring_30d')::int
       and (n->>'stock_below_min')::int = (s->'other'->>'stock_below_min')::int
      from (select public.rm_nav_counts('751709bc-04b3-4449-867d-b97faa9ab373') n, public.rm_work_summary('751709bc-04b3-4449-867d-b97faa9ab373', false) s) x);
-- ETTER: tid (som root). Mål: hver under 50 ms (målt kjerne 18.11: 0,6 / 3,3 / 1,0 ms).
explain (analyze, timing off, summary on) select public.rm_nav_counts('751709bc-04b3-4449-867d-b97faa9ab373');
explain (analyze, timing off, summary on) select public.rm_price_jump_lines('751709bc-04b3-4449-867d-b97faa9ab373');
explain (analyze, timing off, summary on) select public.rm_unread_invoices('751709bc-04b3-4449-867d-b97faa9ab373');
