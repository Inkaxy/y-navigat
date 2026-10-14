-- Regresjon: rm_correct_raw_material_type_unit. Syntetiske data; blokken avslutter ALLTID med RAISE (rollback).
do $$
declare
  le uuid := '751709bc-04b3-4449-867d-b97faa9ab373';
  w uuid; ro uuid; rm uuid; rm2 uuid; sup uuid; rms uuid; rec uuid; part uuid; inv uuid; ln uuid;
  r jsonb; op uuid := gen_random_uuid(); v text; n int; log text := ''; q numeric;
  ok boolean := true;
begin
  for w in select id from auth.users order by created_at loop
    perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
    exit when public.has_ravarer_invoice_access(le, 'write') and public.has_ravarer_access(w, le, 'write');
  end loop;
  for ro in select id from auth.users order by created_at loop
    perform set_config('request.jwt.claims', json_build_object('sub', ro, 'role', 'authenticated')::text, true);
    exit when not public.has_ravarer_invoice_access(le, 'write');
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
  -- Fixture: «Florapan»-lignende vare feilregistrert som emballasje/stk, bekreftet 1 stk per sekk.
  insert into raw_materials (legal_entity_id, sku, name, item_type, base_unit, category) values (le, 'TEST-TU-A', 'TEST Florapan pose 100g', 'emballasje', 'stk', 'Emballasje') returning id into rm;
  insert into raw_materials (legal_entity_id, sku, name, item_type, base_unit) values (le, 'TEST-TU-B', 'TEST stk-vare', 'ravare', 'stk') returning id into rm2;
  insert into suppliers (legal_entity_id, name) values (le, 'TEST typeretting leverandør') returning id into sup;
  insert into raw_material_suppliers (raw_material_id, supplier_id, supplier_sku, package_unit, base_units_per_package, package_confirmed_at)
  values (rm, sup, 'T3021', 'sekk', 1, now()) returning id into rms;
  select count(*) into n from raw_material_supplier_packages where raw_material_supplier_id = rms and confirmed_at is not null;
  log := log || format('variant_bekreftet_for=%s; ', n);
  select rp.recipe_id, rp.id into rec, part from recipe_parts rp join recipes x on x.id = rp.recipe_id where x.legal_entity_id = le limit 1;
  insert into recipe_lines (recipe_id, recipe_part_id, ingredient_name, quantity, unit, entry_mode, raw_material_id, quantity_grams) values (rec, part, 'TEST Florapan', 25, 'g', 'grams', rm, 25);
  insert into recipe_lines (recipe_id, recipe_part_id, ingredient_name, quantity, unit, entry_mode, raw_material_id, quantity_grams) values (rec, part, 'TEST stk', 2, 'stk', 'grams', rm2, null);
  insert into invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, total_amount, total_vat, currency, status)
  values (le, sup, 'TEST-TU-1', '2026-09-01', 8371.88, 1674.38, 'NOK', 'needs_review') returning id into inv;
  insert into invoice_lines (invoice_id, line_number, description, supplier_sku, quantity, unit, unit_price, total_amount, raw_material_id, match_confidence, requires_review)
  values (inv, 1, 'Florapan L62 k pose 100g', 'T3021', 10, 'sekk', 977.74, 6697.50, rm, 'manual', true) returning id into ln;

  -- 1) Uten skriverett: avvist.
  perform set_config('request.jwt.claims', json_build_object('sub', ro, 'role', 'authenticated')::text, true);
  begin
    r := public.rm_correct_raw_material_type_unit(rm, 'ravare', 'kg', 'test begrunnelse', null, op, true);
    ok := false; log := log || 'FEIL lesebruker slapp gjennom; ';
  exception when insufficient_privilege then log := log || 'lese=avvist; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);

  -- 2) Forhåndsvisning: g/kg-oppskrift kompatibel, ingen skriving.
  r := public.rm_correct_raw_material_type_unit(rm, 'ravare', 'kg', null, null, null, true);
  if (r->>'ok')::boolean is not true or jsonb_array_length(r->'blockers') <> 0 or (r->>'compatible_recipe_lines')::int <> 1 or (r->>'package_confirmations_to_reset')::int < 1 then ok := false; end if;
  select base_unit into v from raw_materials where id = rm;
  log := log || format('dryrun=%s base_etter=%s; ', r->'blockers', v);
  if v <> 'stk' then ok := false; end if;

  -- 3) Feil versjon: avvist.
  r := public.rm_correct_raw_material_type_unit(rm, 'ravare', 'kg', 'Leveres i poser à 100 g', '2000-01-01T00:00:00+00:00', op, false);
  if r->>'error' <> 'versjon_endret' then ok := false; end if;
  log := log || format('stale=%s; ', r->>'error');

  -- 4) Riktig versjon i API-format: lagres.
  select to_jsonb(updated_at)#>>'{}' into v from raw_materials where id = rm;
  r := public.rm_correct_raw_material_type_unit(rm, 'ravare', 'kg', 'Leveres i poser à 100 g', v, op, false);
  if (r->>'ok')::boolean is not true or r->>'base_unit' <> 'kg' or r->>'item_type' <> 'ravare' then ok := false; end if;
  log := log || format('lagret=%s reset=%s; ', r->>'ok', r->>'package_confirmations_reset');
  -- Gammel 1 stk-bekreftelse gjenbrukes ikke som kg; historikken beholdes.
  select count(*) into n from raw_material_suppliers where id = rms and (package_confirmed_at is not null or base_units_per_package is not null);
  if n <> 0 then ok := false; end if;
  select count(*) into n from raw_material_supplier_packages where raw_material_supplier_id = rms and confirmed_at is not null;
  if n <> 0 then ok := false; end if;
  select count(*) into n from raw_material_supplier_packages where raw_material_supplier_id = rms;
  log := log || format('varianter_beholdt=%s; ', n);
  if n < 1 then ok := false; end if;
  -- Oppskriftsmengder og fakturalinje uendret.
  select quantity into q from recipe_lines where raw_material_id = rm;
  if q <> 25 then ok := false; end if;
  select quantity into q from invoice_lines where id = ln;
  if q <> 10 then ok := false; end if;
  select count(*) into n from audit_log where entity_id = rm and action = 'raw_material.type_unit_corrected' and changes->>'op_id' = op::text;
  if n <> 1 then ok := false; end if;

  -- 5) Samme opId: idempotent, ingen ny audit.
  r := public.rm_correct_raw_material_type_unit(rm, 'ravare', 'kg', 'Leveres i poser à 100 g', v, op, false);
  select count(*) into n from audit_log where entity_id = rm and action = 'raw_material.type_unit_corrected';
  if (r->>'already')::boolean is not true or n <> 1 then ok := false; end if;
  log := log || format('replay=%s audit=%s; ', r->>'already', n);

  -- 6) stk-oppskrift mot kg: sperret, krever mapping.
  select to_jsonb(updated_at)#>>'{}' into v from raw_materials where id = rm2;
  r := public.rm_correct_raw_material_type_unit(rm2, 'ravare', 'kg', 'test stk til kg', v, gen_random_uuid(), false);
  if r->>'error' <> 'sperret' or r->'blockers'->0->>'code' <> 'oppskrift_krever_mapping' then ok := false; end if;
  select base_unit into v from raw_materials where id = rm2;
  if v <> 'stk' then ok := false; end if;
  log := log || format('stk_oppskrift=%s; ', r->'blockers'->0->>'code');

  raise exception 'RESULTAT: %  %', case when ok then 'ALLE OK' else 'FEIL' end, log;
end $$;
