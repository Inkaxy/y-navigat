-- Kontroll for 20261120_slaa_sammen_varer.del07av07 (bare SELECT). Viser md5 av funksjonskroppene slik de ligger i databasen,
-- mot verdiene i den gjennomgåtte filen. Alle «riktig» skal være true. Kjør også 20261120_slaa_sammen_varer.check.sql.
select e.navn, md5(p.prosrc) as md5_live, e.md5 as md5_fil, md5(p.prosrc) = e.md5 as riktig
from (values
  ('public._rm_merge_fields_guard', 'a48397c5b5b6fb18d159c42c4ee53f15'),
  ('public._rm_merge_push', '4602348b16a93fe3eac35b23e73cc632'),
  ('public._rm_merge_add', 'c1a062cbdc950de4a22541419f5836e3'),
  ('public._rm_merge_conf', '83ca98b52905da5e7ebc6dda54743f12'),
  ('public._rm_merge_unit_factor', '57c856c051383fd3bb97259848f2db3c'),
  ('public._rm_merge_needs_weight', '9e594a54cd2c6ea14e7078586a9e5aa6'),
  ('public._rm_merge_back', 'b9df2cbac9c265b5f02d5e825f21698c'),
  ('public._rm_merge_core', '8fa9e71208db059093dd0234ee6b662b'),
  ('public._rm_merge_undo_core', 'f9bb191275854887bda73afbf8cf9f40'),
  ('public.rm_merge_raw_materials', '80aa533d48c064a06be6134cb9d739c8'),
  ('public.rm_undo_material_merge', 'a6f9cf2728a4bcb9a970e83f984ec23f'),
  ('public.rm_merge_facts', '9cb73a38f37502a7c04749f4187a986d'),
  ('public.rm_cap_slaa_sammen_v1', '36788f88936cdaeac7d5e519c67d3b33'),
  ('public.merge_raw_materials', 'c9532a56dbc4959b90e3fb72cbe39246')
) e(navn, md5)
left join pg_proc p on p.oid = (select max(x.oid) from pg_proc x join pg_namespace ns on ns.oid = x.pronamespace
  where ns.nspname || '.' || x.proname = e.navn)
order by e.navn;
-- Mellomlagringen er borte når alt er kjørt: select to_regclass('public._rm_sql_stage'); -- forventet null
