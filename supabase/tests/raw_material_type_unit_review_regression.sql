-- Regresjon (kodekontroll A): op-gjenbruk, opprinnelig kvittering, ubekreftet faktor, godkjent faktura og prissnapshot.
-- Syntetiske data; blokken avslutter ALLTID med RAISE (rollback).
do $$
declare
  le uuid := '751709bc-04b3-4449-867d-b97faa9ab373';
  w uuid; rm uuid; rm3 uuid; sup uuid; rms uuid; rms3 uuid; rec uuid; part uuid; inv_open uuid; inv_appr uuid; ln_appr uuid; ph uuid;
  r jsonb; r1 jsonb; op uuid := gen_random_uuid(); v text; v3 text; n int; log text := ''; q numeric;
  appr_ver text; appr_ver_after text; snap_before jsonb; snap_after jsonb; ok boolean := true;
begin
  for w in select id from auth.users order by created_at loop
    perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
    exit when public.has_ravarer_invoice_access(le, 'write') and public.has_ravarer_access(w, le, 'write');
  end loop;

  insert into raw_materials (legal_entity_id, sku, name, item_type, base_unit) values (le, 'TEST-TUR-A', 'TEST pose 100g', 'emballasje', 'stk') returning id into rm;
  insert into raw_materials (legal_entity_id, sku, name, item_type, base_unit) values (le, 'TEST-TUR-C', 'TEST ubekreftet', 'emballasje', 'stk') returning id into rm3;
  insert into suppliers (legal_entity_id, name) values (le, 'TEST typeretting kontroll') returning id into sup;
  insert into raw_material_suppliers (raw_material_id, supplier_id, supplier_sku, package_unit, base_units_per_package, package_confirmed_at)
  values (rm, sup, 'TR1', 'sekk', 1, now()) returning id into rms;
  -- Ubekreftet faktor «1» i gammel enhet.
  insert into raw_material_suppliers (raw_material_id, supplier_id, supplier_sku, package_unit, base_units_per_package)
  values (rm3, sup, 'TR3', 'pose', 1) returning id into rms3;
  select rp.recipe_id, rp.id into rec, part from recipe_parts rp join recipes x on x.id = rp.recipe_id where x.legal_entity_id = le limit 1;
  insert into recipe_lines (recipe_id, recipe_part_id, ingredient_name, quantity, unit, entry_mode, raw_material_id, quantity_grams) values (rec, part, 'TEST pose', 37.5, 'g', 'grams', rm, 37.5);

  insert into invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, total_amount, total_vat, currency, status)
  values (le, sup, 'TEST-TUR-OPEN', '2026-09-01', 100, 20, 'NOK', 'needs_review') returning id into inv_open;
  insert into invoice_lines (invoice_id, line_number, description, supplier_sku, quantity, unit, unit_price, total_amount, raw_material_id, match_confidence, requires_review)
  values (inv_open, 1, 'TEST pose 100g', 'TR1', 1, 'pose', 80, 80, rm, 'manual', true);
  insert into invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, total_amount, total_vat, currency, status)
  values (le, sup, 'TEST-TUR-APPR', '2026-08-01', 100, 20, 'NOK', 'needs_review') returning id into inv_appr;
  insert into invoice_lines (invoice_id, line_number, description, supplier_sku, quantity, unit, unit_price, total_amount, raw_material_id, match_confidence, requires_review)
  values (inv_appr, 1, 'TEST pose 100g', 'TR1', 1, 'sekk', 80, 80, rm, 'manual', false) returning id into ln_appr;
  insert into invoice_internal_approvals (invoice_id, legal_entity_id, status, approved_by, approved_at) values (inv_appr, le, 'approved', w, now());
  select to_jsonb(updated_at)#>>'{}' into appr_ver from invoice_lines where id = ln_appr;

  insert into raw_material_price_history (raw_material_id, supplier_id, price, effective_date, source, invoice_id, invoice_line_id, cost_eligible)
  values (rm, sup, 80, '2026-08-01', 'invoice', inv_appr, ln_appr, true) returning id into ph;
  select jsonb_build_object('u', snapshot_unit, 'p', snapshot_package, 'c', snapshot_currency, 's', snapshot_source, 'a', snapshot_at, 'price', price, 'd', effective_date)
    into snap_before from raw_material_price_history where id = ph;

  -- Forhåndsvisning teller godkjent faktura som hoppet over, ikke som rematch.
  r := public.rm_correct_raw_material_type_unit(rm, 'ravare', 'kg', null, null, null, true);
  if (r->>'open_invoices')::int <> 1 or (r->>'approved_invoices_skipped')::int <> 1 then ok := false; end if;
  log := log || format('preview open=%s skipped=%s; ', r->>'open_invoices', r->>'approved_invoices_skipped');

  select to_jsonb(updated_at)#>>'{}' into v from raw_materials where id = rm;
  r1 := public.rm_correct_raw_material_type_unit(rm, 'ravare', 'kg', 'Poser à 100 g', v, op, false);
  if (r1->>'ok')::boolean is not true or (r1->>'open_invoices_requeued')::int <> 1 or (r1->>'approved_invoices_skipped')::int <> 1 then ok := false; end if;
  log := log || format('lagret reset=%s requeued=%s; ', r1->>'package_confirmations_reset', r1->>'open_invoices_requeued');

  -- Audit-kvittering: aktør, fra/til og forventet versjon.
  select count(*) into n from audit_log where entity_id = rm and action = 'raw_material.type_unit_corrected' and user_id = w
     and changes->'from'->>'base_unit' = 'stk' and changes->'from'->>'item_type' = 'emballasje'
     and changes->'to'->>'base_unit' = 'kg' and changes->>'expected_updated_at' = v;
  if n <> 1 then ok := false; log := log || 'FEIL audit; '; end if;

  -- Gjentak med samme op og samme innhold: opprinnelig kvittering, ikke dagens tilstand.
  r := public.rm_correct_raw_material_type_unit(rm, 'ravare', 'kg', 'Poser à 100 g', v, op, false);
  if (r->>'already')::boolean is not true or r->>'package_confirmations_reset' <> r1->>'package_confirmations_reset'
     or r->>'open_invoices_requeued' <> r1->>'open_invoices_requeued' or r->>'updated_at' <> r1->>'updated_at' then ok := false; log := log || 'FEIL replay-kvittering; '; end if;
  -- Samme op, annet mål: avvist.
  r := public.rm_correct_raw_material_type_unit(rm, 'ravare', 'l', 'Poser à 100 g', v, op, false);
  if r->>'error' is distinct from 'op_gjenbrukt' then ok := false; end if;
  -- Samme op mot annen vare: avvist.
  select to_jsonb(updated_at)#>>'{}' into v3 from raw_materials where id = rm3;
  r := public.rm_correct_raw_material_type_unit(rm3, 'ravare', 'kg', 'Poser à 100 g', v3, op, false);
  if r->>'error' is distinct from 'op_gjenbrukt' then ok := false; end if;
  -- Samme op med annen forventet versjon: avvist.
  r := public.rm_correct_raw_material_type_unit(rm, 'ravare', 'kg', 'Poser à 100 g', '2000-01-01T00:00:00+00:00', op, false);
  if r->>'error' is distinct from 'op_gjenbrukt' then ok := false; end if;
  log := log || 'op_gjenbrukt=avvist x3; ';

  -- Godkjent faktura: linjeversjon uendret. Oppskriftsmengde uendret. Prissnapshot uendret (superseded lov).
  select to_jsonb(updated_at)#>>'{}' into appr_ver_after from invoice_lines where id = ln_appr;
  if appr_ver_after <> appr_ver then ok := false; log := log || 'FEIL godkjent linje endret; '; end if;
  select quantity into q from recipe_lines where raw_material_id = rm;
  if q <> 37.5 then ok := false; end if;
  select jsonb_build_object('u', snapshot_unit, 'p', snapshot_package, 'c', snapshot_currency, 's', snapshot_source, 'a', snapshot_at, 'price', price, 'd', effective_date)
    into snap_after from raw_material_price_history where id = ph;
  if snap_after <> snap_before then ok := false; log := log || 'FEIL snapshot endret; '; end if;
  select count(*) into n from raw_material_price_history where id = ph and superseded_at is not null;
  log := log || format('snapshot_uendret superseded=%s; ', n);

  -- Ubekreftet faktor i gammel enhet nullstilles også.
  r := public.rm_correct_raw_material_type_unit(rm3, 'ravare', 'kg', null, null, null, true);
  if (r->>'package_confirmations_to_reset')::int < 1 then ok := false; end if;
  r := public.rm_correct_raw_material_type_unit(rm3, 'ravare', 'kg', 'Poser à 100 g', v3, gen_random_uuid(), false);
  select count(*) into n from raw_material_suppliers where id = rms3 and base_units_per_package is not null;
  if (r->>'ok')::boolean is not true or n <> 0 then ok := false; log := log || 'FEIL ubekreftet faktor beholdt; '; end if;
  log := log || 'ubekreftet=nullstilt; ';

  raise exception 'RESULTAT: %  %', case when ok then 'ALLE OK' else 'FEIL' end, log;
end $$;
