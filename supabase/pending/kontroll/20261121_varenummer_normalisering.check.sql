-- Bare SELECT. Kjøres før og etter 20261121_varenummer_normalisering.PENDING.sql.
-- Forutsetninger: hjelpefunksjonene finnes med dagens navn (definisjonene endres ikke av filen).
select proname, md5(pg_get_functiondef(oid)) as md5
from pg_proc where proname in ('rm_sku_norm', 'rm_match_key', 'has_ravarer_invoice_access') order by proname;

-- Etter kjøring: funksjonene finnes og rettighetene er stramme (forventet: _rm_sku_canon_plan bare service_role).
select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as kan_kjore
from pg_proc p cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
where p.proname in ('_rm_sku_canon_plan', 'rm_sku_canon_dryrun') order by 1, 2;

-- Oppsummering per leverandør (Nøtterø Bakeri).
select supplier_name, count(distinct match_key) as varer, count(*) as linjer, count(*) filter (where can_change) as kan_endres,
       count(*) filter (where reason = 'ikke_varenummer') as ikke_varenummer, count(*) filter (where reason = 'manglet_varenummer') as manglet,
       count(*) filter (where reason like 'avkortet%') as avkortet
from public._rm_sku_canon_plan((select id from public.legal_entities where status = 'active' order by short_code limit 1))
group by supplier_name order by linjer desc;

-- Eksempel: ASKO ISTE CHAI skal foreslå 299727 for «9727», «305-11», «305-12», «305-5» og linjer uten varenummer.
select supplier_name, match_key, current_sku, proposed_sku, reason, can_change, blocker, count(*)
from public._rm_sku_canon_plan((select id from public.legal_entities where status = 'active' order by short_code limit 1))
where match_key like 'iste chai%' group by 1, 2, 3, 4, 5, 6, 7 order by 1, 2, 3;
