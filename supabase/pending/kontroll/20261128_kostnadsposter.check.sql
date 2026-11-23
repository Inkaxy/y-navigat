-- Kontroll for 1-kjor-na/02_kostnadsposter.sql. Ren SELECT; alle rader skal ha ok = true etter kjøring.
select 'tabellene finnes' as kontroll,
       to_regclass('public.rm_cost_posts') is not null and to_regclass('public.rm_cost_post_rules') is not null as ok
union all
select 'RLS er på begge tabellene',
       (select bool_and(relrowsecurity) from pg_class where oid in ('public.rm_cost_posts'::regclass, 'public.rm_cost_post_rules'::regclass))
union all
select 'innloggede kan bare lese tabellene',
       has_table_privilege('authenticated', 'public.rm_cost_posts', 'select')
       and not has_table_privilege('authenticated', 'public.rm_cost_posts', 'insert')
       and not has_table_privilege('authenticated', 'public.rm_cost_post_rules', 'insert')
       and not has_table_privilege('authenticated', 'public.rm_cost_post_rules', 'update')
union all
select 'anon kan ikke lese eller kalle',
       not has_table_privilege('anon', 'public.rm_cost_posts', 'select')
       and not has_function_privilege('anon', 'public.rm_set_cost_post_rule(uuid, uuid, text, uuid)', 'execute')
       and not has_function_privilege('anon', 'public.rm_cost_post_summary(uuid, integer)', 'execute')
union all
select 'funksjonene finnes',
       (select count(*) = 6 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('_rm_cost_item_key', 'rm_save_cost_post', 'rm_set_cost_post_rule',
               'rm_cost_post_summary', 'rm_cost_post_lines', 'rm_cap_kostnadsposter_v1'))
union all
select 'ingen CR i funksjonene',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname in ('_rm_cost_item_key', 'rm_save_cost_post', 'rm_set_cost_post_rule',
                         'rm_cost_post_summary', 'rm_cost_post_lines', 'rm_cap_kostnadsposter_v1') and strpos(p.prosrc, chr(13)) > 0);
