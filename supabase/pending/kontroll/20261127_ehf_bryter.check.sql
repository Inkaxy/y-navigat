-- Kontroll for 1-kjor-na/02_ehf_bryter.sql. Ren SELECT; alle rader skal ha ok = true etter kjøring.
select 'rm_save_ehf_first finnes' as kontroll,
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'rm_save_ehf_first') as ok
union all
select 'rm_reading_settings svarer med ehf_first',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'rm_reading_settings' and strpos(p.prosrc, '''ehf_first''') > 0)
union all
select 'anon kan ikke kalle rm_save_ehf_first',
       not has_function_privilege('anon', 'public.rm_save_ehf_first(uuid, boolean, integer)', 'execute')
union all
select 'ingen CR i funksjonene',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname in ('rm_reading_settings', 'rm_save_ehf_first') and strpos(p.prosrc, chr(13)) > 0);
