-- Kontroll for 20261123_gjenlesing_fjern_linjer.PENDING.sql. Bare SELECT. Kjør FØR (alle ok = true) og ETTER (alle ok = true).
-- md5-verdiene viser at filen er skrevet inn riktig. Etter kjøring: rm_apply_invoice_reread = b040b8a66933cb294ca6356b896d5d9e,
-- _rm_reread_line_protection = 8be82937468870a1ef1736bed6f7155a (beregnet ved å kjøre filen på en byte-lik kopi av live-funksjonen).
-- FØR
select 'dagens rm_apply_invoice_reread (md5)' kontroll, md5(replace(pg_get_functiondef('public.rm_apply_invoice_reread(uuid,jsonb,text)'::regprocedure), chr(13), '')) = 'c9c68ddd556312ec0b03d5d3365d4e6a' ok
union all select 'markør finnes ikke', to_regprocedure('public.rm_cap_gjenlesing_fjern_v1()') is null
union all select 'hjelper finnes ikke', to_regprocedure('public._rm_reread_line_protection(uuid)') is null;
-- ETTER
select 'markør finnes' kontroll, to_regprocedure('public.rm_cap_gjenlesing_fjern_v1()') is not null ok
union all select 'rm_apply_invoice_reread er ny utgave (md5)', md5(replace(pg_get_functiondef('public.rm_apply_invoice_reread(uuid,jsonb,text)'::regprocedure), chr(13), '')) = 'b040b8a66933cb294ca6356b896d5d9e'
union all select '_rm_reread_line_protection (md5)', md5(replace(pg_get_functiondef('public._rm_reread_line_protection(uuid)'::regprocedure), chr(13), '')) = '8be82937468870a1ef1736bed6f7155a'
union all select 'hjelper ikke kallbar fra klient', not has_function_privilege('authenticated', 'public._rm_reread_line_protection(uuid)', 'execute') and not has_function_privilege('anon', 'public._rm_reread_line_protection(uuid)', 'execute')
union all select 'anon kan ikke kalle markøren', not has_function_privilege('anon', 'public.rm_cap_gjenlesing_fjern_v1()', 'execute')
union all select 'remove/keep støttes', strpos(replace(pg_get_functiondef('public.rm_apply_invoice_reread(uuid,jsonb,text)'::regprocedure), chr(13), ''), $$('update','add','remove','keep')$$) > 0;
