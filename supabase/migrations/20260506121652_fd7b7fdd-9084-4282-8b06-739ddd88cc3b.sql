-- Sett riktige nivåer for posisjoner som ble migrert med default 'read'
update public.position_app_access
  set level = 'admin'::access_level
where app_id = (select id from public.apps where code = 'ravarer')
  and position_id in (
    'a1c040a2-d4bf-4e6f-8fa3-add22e710ede', -- daglig_leder
    '4c72b950-9ea3-4747-b625-5bfd707dc263'  -- lageransvarlig (hadde admin på fakturaer)
  );

update public.position_app_access
  set level = 'write'::access_level
where app_id = (select id from public.apps where code = 'ravarer')
  and position_id = 'dbb6b4bd-d2a3-4a79-b66c-bee3d47a3386' -- ordrekontor (hadde write)
  and level = 'read';