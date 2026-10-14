-- Regresjon: rm_infer_package med pose (egen beholder), trykt rabatt, prisgrunnlag og bekreftede varianter.
-- Syntetiske data; blokken avslutter ALLTID med RAISE (rollback). Ingen ekte fakturaer berøres.
do $$
declare
  le uuid := '751709bc-04b3-4449-867d-b97faa9ab373';
  w uuid; rm uuid; rmkg uuid; sup uuid; rms uuid; rmskg uuid; inv uuid; ln uuid; ln2 uuid; ln3 uuid;
  r jsonb; log text := ''; ok boolean := true;
begin
  for w in select id from auth.users order by created_at loop
    perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
    exit when public.has_ravarer_invoice_access(le, 'read');
  end loop;

  insert into raw_materials (legal_entity_id, sku, name, item_type, base_unit) values (le, 'TEST-POSE-A', 'TEST Florapan pose 100g', 'ravare', 'stk') returning id into rm;
  insert into raw_materials (legal_entity_id, sku, name, item_type, base_unit) values (le, 'TEST-POSE-B', 'TEST mel', 'ravare', 'kg') returning id into rmkg;
  insert into suppliers (legal_entity_id, name) values (le, 'TEST pose leverandør') returning id into sup;
  insert into raw_material_suppliers (raw_material_id, supplier_id, supplier_sku) values (rm, sup, 'T3021') returning id into rms;
  insert into raw_material_suppliers (raw_material_id, supplier_id, supplier_sku) values (rmkg, sup, 'TMEL') returning id into rmskg;
  -- Gammel bekreftelse på «sekk» skal aldri gjenbrukes for «pose».
  insert into raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_unit, base_units_per_package, confirmed_at)
  values (rms, public.rm_sku_norm('T3021'), 'sekk', 1, now());
  insert into invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, total_amount, total_vat, currency, status)
  values (le, sup, 'TEST-POSE-1', '2026-09-01', 8371.88, 1674.38, 'NOK', 'needs_review') returning id into inv;
  insert into invoice_lines (invoice_id, line_number, description, supplier_sku, quantity, unit, unit_price, total_amount, discount_amount, unit_price_basis, raw_material_id, match_confidence, requires_review)
  values (inv, 1, 'Florapan L62 k pose 100g', 'T3021', 10, 'pose', 977.74, 6697.50, 3079.90, 'pakning', rm, 'manual', true) returning id into ln;

  -- 1) Pose + trykt rabatt + bare sekk-variant: ingen gjenbruk, ingen regnestykkegjetning (0,69), varenavn bare forslag.
  r := public.rm_infer_package(ln, null);
  if r->>'source' = 'bekreftet_pakning' or (r->'arithmetic'->>'ok')::boolean or r->'arithmetic'->>'note' <> 'rabatt' or coalesce((r->>'auto_confirmable')::boolean, false) then ok := false; end if;
  if r->>'source' is distinct from 'varenavn' then ok := false; end if;
  log := log || format('1 kilde=%s note=%s auto=%s; ', r->>'source', r->'arithmetic'->>'note', r->>'auto_confirmable');

  -- 2) Entydig bekreftet pose-variant: bekreftet forslag.
  insert into raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_unit, base_units_per_package, confirmed_at)
  values (rms, public.rm_sku_norm('T3021'), 'pose', 1, now());
  r := public.rm_infer_package(ln, null);
  if r->>'source' <> 'bekreftet_pakning' or (r->>'suggested_bupp')::numeric <> 1 then ok := false; end if;
  log := log || format('2 kilde=%s bupp=%s; ', r->>'source', r->>'suggested_bupp');

  -- 3) Erstattet variant teller ikke; motstridende aktive varianter = ukjent.
  insert into raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_unit, base_units_per_package, confirmed_at, superseded_at, superseded_reason)
  values (rms, public.rm_sku_norm('T3021'), 'pose', 7, now(), now(), 'test');
  r := public.rm_infer_package(ln, null);
  if r->>'source' <> 'bekreftet_pakning' then ok := false; end if;
  insert into raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_unit, base_units_per_package, confirmed_at)
  values (rms, public.rm_sku_norm('T3021') , 'pose', 2, now());
  r := public.rm_infer_package(ln, null);
  if r->>'source' is not null or r->>'suggested_bupp' is not null then ok := false; end if;
  log := log || format('3 motstrid kilde=%s; ', coalesce(r->>'source','null'));

  -- 4) Prisforskjell uten dokumentert prisgrunnlag: aldri pakningsgjetning.
  insert into invoice_lines (invoice_id, line_number, description, supplier_sku, quantity, unit, unit_price, total_amount, raw_material_id, match_confidence, requires_review)
  values (inv, 2, 'TEST mel', 'TMEL', 2, 'sekk', 20, 1000, rmkg, 'manual', true) returning id into ln2;
  r := public.rm_infer_package(ln2, null);
  if (r->'arithmetic'->>'ok')::boolean or r->>'suggested_bupp' is not null or r->'arithmetic'->>'note' <> 'prisgrunnlag_ukjent' then ok := false; end if;
  log := log || format('4 note=%s; ', r->'arithmetic'->>'note');

  -- 5) Dokumentert pris per kg: regnestykket gir 25 kg per sekk.
  insert into invoice_lines (invoice_id, line_number, description, supplier_sku, quantity, unit, unit_price, total_amount, unit_price_basis, raw_material_id, match_confidence, requires_review)
  values (inv, 3, 'TEST mel', 'TMEL', 2, 'sekk', 20, 1000, 'kg', rmkg, 'manual', true) returning id into ln3;
  r := public.rm_infer_package(ln3, null);
  if (r->>'suggested_bupp')::numeric <> 25 or r->>'source' <> 'regnestykke' then ok := false; end if;
  log := log || format('5 kilde=%s bupp=%s; ', r->>'source', r->>'suggested_bupp');

  -- 6) Enheten på linjen er fortsatt «pose» (ingen omskriving til sekk).
  if (select unit from invoice_lines where id = ln) <> 'pose' then ok := false; end if;

  raise exception 'RESULTAT: % %', case when ok then 'ALLE OK' else 'FEIL' end, log;
end $$;
