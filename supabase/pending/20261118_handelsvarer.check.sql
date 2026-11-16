-- Kontroll etter 20261118_handelsvarer.PENDING.sql. Bare SELECT.
select 'kolonne resale_default_factor' as kontroll,
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='entity_calc_settings' and column_name='resale_default_factor') as ok
union all select 'tabell resale_markup_settings', to_regclass('public.resale_markup_settings') is not null
union all select 'rls på', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.resale_markup_settings')), false)
union all select 'policy select+write', (select count(*) from pg_policy where polrelid = to_regclass('public.resale_markup_settings')) = 2
union all select 'grant authenticated', has_table_privilege('authenticated', 'public.resale_markup_settings', 'INSERT')
union all select 'ingen rader ved kjøring', (select count(*) from public.resale_markup_settings) = 0
union all select 'cap', public.varer_cap_handelsvarer_v1();
