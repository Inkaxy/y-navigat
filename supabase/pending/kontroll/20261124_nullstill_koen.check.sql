-- Kontroll for 1-kjor-na/01_nullstill_koen.sql. Bare SELECT. Kjør FØR (alle ok = true) og ETTER (alle ok = true).
-- md5 regnes uten CR. Etter kjøring: rm_set_invoice_exclusion = 9968670c07d1a96df04977b7b9022a4b (beregnet ved å kjøre filen på en byte-lik kopi
-- av live-funksjonen, scripts/fixtures/live-20261118b).
-- FØR
select 'dagens rm_set_invoice_exclusion (md5)' kontroll, md5(replace(pg_get_functiondef('public.rm_set_invoice_exclusion(uuid,text,uuid,text,text,text,uuid)'::regprocedure), chr(13), '')) = 'b4f626aa2d2de03174c910e64317519d' ok
union all select 'dagens rm_set_fra_faktura_settings (md5)', md5(replace(pg_get_functiondef('public.rm_set_fra_faktura_settings(uuid,numeric,boolean,boolean)'::regprocedure), chr(13), '')) = '809457c5c22c32cce357d535e1248f2d'
union all select 'dagens rm_fra_faktura_settings (md5)', md5(replace(pg_get_functiondef('public.rm_fra_faktura_settings(uuid)'::regprocedure), chr(13), '')) = '8ff7969936cbd373012e34dc11398489'
union all select 'markør finnes ikke', to_regprocedure('public.rm_cap_nullstill_koen_v1()') is null
union all select 'tabellene finnes ikke', to_regclass('public.rm_queue_reset_runs') is null and to_regclass('public.rm_queue_reset_items') is null;
-- ETTER
select 'markør finnes' kontroll, to_regprocedure('public.rm_cap_nullstill_koen_v1()') is not null ok
union all select 'rm_set_invoice_exclusion er ny utgave (md5)', md5(replace(pg_get_functiondef('public.rm_set_invoice_exclusion(uuid,text,uuid,text,text,text,uuid)'::regprocedure), chr(13), '')) = '9968670c07d1a96df04977b7b9022a4b'
union all select 'kategori nullstilling godtas (bare linje)', strpos(pg_get_functiondef('public.rm_set_invoice_exclusion(uuid,text,uuid,text,text,text,uuid)'::regprocedure), $$if p_category = 'nullstilling' and p_scope <> 'line'$$) > 0
union all select 'constraint tillater nullstilling', exists (select 1 from pg_constraint where conname = 'invoice_lines_exclusion_category_check' and strpos(pg_get_constraintdef(oid), 'nullstilling') > 0)
union all select 'fire tabeller med RLS', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
    and c.relname in ('rm_queue_reset_runs','rm_queue_reset_snapshot','rm_queue_reset_items','rm_queue_reset_item_lines') and c.relrowsecurity) = 4
union all select 'ingen direkte skriving fra klient', not has_table_privilege('authenticated', 'public.rm_queue_reset_items', 'insert')
    and not has_table_privilege('authenticated', 'public.rm_queue_reset_runs', 'update') and not has_table_privilege('anon', 'public.rm_queue_reset_items', 'select')
union all select 'hjelpere ikke kallbare fra klient', not has_function_privilege('authenticated', 'public._rm_qr_insert_items(uuid,uuid,smallint,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public._rm_qr_guard(uuid)', 'execute')
union all select 'anon kan ikke starte', not has_function_privilege('anon', 'public.rm_queue_reset_start(uuid,text,jsonb,uuid[],jsonb)', 'execute')
union all select 'forhåndsvisningen leser lesevarsler, ikke prissikkerhetsstatus', strpos(pg_get_functiondef('public.rm_queue_reset_snapshot_lines(uuid,uuid,integer)'::regprocedure), '_rm_queue_line_read_issue') = 0
    and strpos(pg_get_functiondef('public.rm_queue_reset_snapshot_lines(uuid,uuid,integer)'::regprocedure), 'invoice_read_codes') > 0
union all select 'revisjonsloggen får lesegrunnlag per steg', strpos(pg_get_functiondef('public.rm_queue_reset_finish(uuid,uuid,text,jsonb,text)'::regprocedure), $$'lesegrunnlag', v_it.payload->'lesegrunnlag'$$) > 0
union all select 'ingen kjøring er startet av filen', not exists (select 1 from public.rm_queue_reset_runs)
union all select 'ingen funksjon med CR', not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    and strpos(p.prosrc, chr(13)) > 0 and (p.proname like 'rm\_queue\_reset\_%' or p.proname like '\_rm\_qr\_%' or p.proname in ('rm_cap_nullstill_koen_v1','rm_set_invoice_exclusion')));
