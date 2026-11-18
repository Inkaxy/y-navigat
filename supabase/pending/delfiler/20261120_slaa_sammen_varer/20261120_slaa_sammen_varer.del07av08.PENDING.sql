-- VENTER PÅ ROOT. 20261120_slaa_sammen_varer.del07av08.PENDING.sql – del 7 av 8 av 20261120_slaa_sammen_varer.PENDING.sql (847 byte tekst).
-- Legger bare teksten i mellomlagringen og kontrollerer md5. Ingen virkning på appen før del 8 («kjør»).
-- Kan kjøres på nytt (overskriver samme del). md5 for delen: ea854e8be23bd354b98c7f6144ecd51f

do $g$ begin
  if to_regclass('public._rm_sql_stage') is null then raise exception 'Kjør del 01 først'; end if;
  if not exists (select 1 from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 6) then
    raise exception 'Kjør del 06 først';
  end if;
end $g$;
insert into public._rm_sql_stage (file, part, body) values ('20261120_slaa_sammen_varer', 7, replace(replace(replace($stage$-- Denne blokken skriver dem på nytt med bare LF, slik at kontrollsummene blir de samme uansett innliming.
-- Gjør ingenting når alt allerede er LF. Rører bare funksjonene denne filen oppretter.
do $lf$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = any (array['_rm_merge_add', '_rm_merge_back', '_rm_merge_conf', '_rm_merge_core', '_rm_merge_fields_guard', '_rm_merge_needs_weight', '_rm_merge_push', '_rm_merge_undo_core', '_rm_merge_unit_factor', 'merge_raw_materials', 'rm_cap_slaa_sammen_v1', 'rm_merge_facts', 'rm_merge_raw_materials', 'rm_undo_material_merge'])
              and p.prokind = 'f' and strpos(p.prosrc, chr(13)) > 0 loop
    execute replace(pg_get_functiondef(r.oid), chr(13), '');
  end loop;
end $lf$;

$stage$, chr(13), ''), chr(160), ' '), chr(9), ' '))
  on conflict (file, part) do update set body = excluded.body, created_at = now();
do $g$ begin
  if (select md5(body) from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 7) <> 'ea854e8be23bd354b98c7f6144ecd51f' then
    raise exception 'Del 07 er ikke skrevet inn riktig (md5 avviker) – skriv den inn på nytt';
  end if;
end $g$;
