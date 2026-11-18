-- Kontroll etter 20261119_nye_varer_les.PENDING.sql. Bare SELECT. Kjøres som root (auth.uid() er null).
-- Bytt selskaps-ID om nødvendig (Nøtterø Bakeri).
with le as (select '751709bc-04b3-4449-867d-b97faa9ab373'::uuid id),
     ny as (select public.rm_new_items_queue((select id from le), null, 0, 0) r),
     wi as (select public.rm_work_items((select id from le), 'alle', null, null, 'oldest', 1, 0) r)
select 'funksjonene finnes' as kontroll,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('rm_new_items_queue','rm_cap_nye_varer_v1')) = 2 as ok
union all select 'rm_work_items er dagens (17.11) eller etter 20261121_kobling_godkjent_faktura (md5)',
       md5(replace(pg_get_functiondef('public.rm_work_items(uuid,text,text,uuid,text,integer,integer)'::regprocedure), chr(13), ''))
         in ('efe0f95ef98471bbfca5713d05960e27', '27451573d8696e4d95c3253798923a45')
union all select 'samme antall ukoblede som rm_work_items',
       ((select r from ny)->'counts'->>'kobling')::int = ((select r from wi)->'counts'->>'kobling')::int
union all select 'samme antall uten pakning som rm_work_items',
       ((select r from ny)->'counts'->>'pakning')::int = ((select r from wi)->'counts'->>'pakning')::int
union all select 'leverandørtall summerer til total',
       (select sum((x->>'count')::int) from ny, jsonb_array_elements(ny.r->'suppliers') x) = ((select r from ny)->'counts'->>'alle')::int
union all select 'anon har ikke tilgang',
       not has_function_privilege('anon', 'public.rm_new_items_queue(uuid,uuid,integer,integer)', 'execute')
union all select 'authenticated har tilgang',
       has_function_privilege('authenticated', 'public.rm_new_items_queue(uuid,uuid,integer,integer)', 'execute')
union all select 'cap', public.rm_cap_nye_varer_v1();

-- Tid for ett kall (forventet godt under 1 s):
-- explain (analyze, timing off, summary on) select public.rm_new_items_queue('751709bc-04b3-4449-867d-b97faa9ab373', null, 50, 0);
