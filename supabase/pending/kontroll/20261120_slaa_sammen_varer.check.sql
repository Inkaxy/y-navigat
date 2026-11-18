-- Kontroll etter 20261120_slaa_sammen_varer.PENDING.sql. Kjøres som root (auth.uid() er null).
-- Endrer ingenting: forhåndsvisningene kjører hele sammenslåingen og ruller den tilbake (dry_run).
with le as (select '751709bc-04b3-4449-867d-b97faa9ab373'::uuid id)
select 'kolonner på raw_materials' as kontroll,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'raw_materials'
         and column_name in ('merged_into_id', 'merged_at', 'merge_id')) = 3 as ok
union all select 'rm_material_merges med RLS',
       (select relrowsecurity from pg_class where oid = 'public.rm_material_merges'::regclass)
union all select 'funksjonene finnes',
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
         and p.proname in ('_rm_merge_core', '_rm_merge_undo_core', 'rm_merge_raw_materials', 'rm_undo_material_merge', 'rm_merge_facts', 'rm_cap_slaa_sammen_v1')) = 6
union all select 'kjernen er ikke kallbar fra klient',
       not has_function_privilege('authenticated', 'public._rm_merge_core(uuid,uuid,uuid[],jsonb,jsonb,text,boolean,uuid)', 'execute')
   and not has_function_privilege('anon', 'public._rm_merge_core(uuid,uuid,uuid[],jsonb,jsonb,text,boolean,uuid)', 'execute')
   and not has_function_privilege('authenticated', 'public._rm_merge_undo_core(uuid,uuid,boolean,uuid)', 'execute')
union all select 'innloggede kan kalle sammenslåing/angre/fakta',
       has_function_privilege('authenticated', 'public.rm_merge_raw_materials(uuid,uuid[],jsonb,jsonb,text,boolean,uuid)', 'execute')
   and has_function_privilege('authenticated', 'public.rm_undo_material_merge(uuid,boolean,uuid)', 'execute')
   and has_function_privilege('authenticated', 'public.rm_merge_facts(uuid[])', 'execute')
union all select 'anon kan ikke kalle sammenslåing',
       not has_function_privilege('anon', 'public.rm_merge_raw_materials(uuid,uuid[],jsonb,jsonb,text,boolean,uuid)', 'execute')
union all select 'merge_raw_materials delegerer til ny vei',
       pg_get_functiondef('public.merge_raw_materials(uuid,uuid)'::regprocedure) like '%rm_merge_raw_materials%'
union all select 'ingen varer er slått sammen ennå', (select count(*) from public.raw_materials where merged_into_id is not null) = 0
union all select 'cap', public.rm_cap_slaa_sammen_v1();

-- Forhåndsvisning (rulles tilbake): KANELBOLLE SIRUP MONIN → KANELBOLLE SIRUP 70CL MONIN (samme enhet, to varenumre hos ASKO).
select public._rm_merge_core(null, '74d4fc00-cc6e-42da-bf1d-99c7685dc9bc', array['3f015170-6176-4554-80d2-a6e8af65e491']::uuid[],
       null, null, 'kontroll', true, gen_random_uuid()) as sirup_forhandsvisning;

-- Forhåndsvisning (rulles tilbake): GLUTEN OG MELKEFRI KANELBOLLE (stk) → Gluten og melkefri kanelbolle (kg), 1 stk = 120 g.
select public._rm_merge_core(null, '7b6e3aa6-ed3a-4579-88aa-1c3cbf38e963', array['0a8bdde2-b647-4101-abf8-26286dd2366a']::uuid[],
       '{"0a8bdde2-b647-4101-abf8-26286dd2366a": 120}'::jsonb, null, 'kontroll', true, gen_random_uuid()) as kanelbolle_forhandsvisning;

-- Samme uten omregning skal avvises (omregning_mangler).
select public._rm_merge_core(null, '7b6e3aa6-ed3a-4579-88aa-1c3cbf38e963', array['0a8bdde2-b647-4101-abf8-26286dd2366a']::uuid[],
       null, null, 'kontroll', true, gen_random_uuid()) ->> 'code' = 'omregning_mangler' as uten_omregning_avvist;

-- Bevis på at forhåndsvisningene ikke skrev noe:
select (select count(*) from public.rm_material_merges) = 0 as ingen_sammenslaing_lagret,
       (select count(*) from public.audit_log where action like 'raw_material.merge%') = 0 as ingen_revisjonslinje;
