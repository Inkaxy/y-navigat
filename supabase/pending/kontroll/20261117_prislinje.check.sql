-- Bare SELECT. Før/etter 20261117_prislinje.PENDING.sql.
select column_name, data_type, is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = 'invoice_match_settings'
   and column_name in ('price_history_deviation_pct','price_history_since_months');
select to_regclass('public.rm_purchase_corrections') as korreksjonstabell,
       (select relrowsecurity from pg_class where oid = to_regclass('public.rm_purchase_corrections')) as rls_pa;
select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as authenticated_kan,
       has_function_privilege('anon', p.oid, 'execute') as anon_kan
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('rm_correct_purchase_price','rm_revert_purchase_price_correction','rm_change_approved_package','rm_cap_prislinje_v1');
-- Uendrede avhengigheter (lest 16.11.2026):
select md5(replace(pg_get_functiondef('public._rm_cost_candidates'::regproc), chr(13), '')) as cost_candidates_md5,
       md5(replace(pg_get_functiondef('public._rmph_snapshot'::regproc), chr(13), '')) as snapshot_md5,
       md5(replace(pg_get_functiondef('public._rms_record_package_variant'::regproc), chr(13), '')) as package_variant_md5;
