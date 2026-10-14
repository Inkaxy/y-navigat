-- Regresjon rm_infer_package v3: ubekreftet variant er aldri bekreftet grunnlag; pris per g gir 0,1 kg (ikke 100 kg);
-- ukjent prisgrunnlag og rabatt gir ingen pakningsgjetning. Syntetiske data; avslutter ALLTID med RAISE (rollback).
do $$
declare
  le uuid := '751709bc-04b3-4449-867d-b97faa9ab373';
  w uuid; rm uuid; sup uuid; rms uuid; inv uuid; l1 uuid; l2 uuid; l3 uuid; l4 uuid; r jsonb; ok boolean := true; log text := '';
begin
  for w in select id from auth.users order by created_at loop
    perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
    exit when public.has_ravarer_invoice_access(le, 'read');
  end loop;
  insert into raw_materials (legal_entity_id, sku, name, item_type, base_unit) values (le, 'TEST-INF-3', 'TEST frø', 'ravare', 'kg') returning id into rm;
  insert into suppliers (legal_entity_id, name) values (le, 'TEST infer v3') returning id into sup;
  -- Ubekreftet positiv faktor på koblingsraden (variant-tabellen krever confirmed_at, så ubekreftet finnes bare her).
  insert into raw_material_suppliers (raw_material_id, supplier_id, supplier_sku, package_unit, base_units_per_package) values (rm, sup, 'INF3', 'pose', 1) returning id into rms;
  if exists (select 1 from raw_material_supplier_packages where raw_material_supplier_id = rms) then ok := false; log := log || 'FEIL ubekreftet ble variant; '; end if;
  insert into invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, total_amount, total_vat, currency, status)
  values (le, sup, 'TEST-INF-3', '2026-09-01', 1000, 0, 'NOK', 'needs_review') returning id into inv;
  -- 1) pris per g: 10 pose × 0,5 kr/g = 500 kr → 100 g = 0,1 kg per pose.
  insert into invoice_lines (invoice_id, line_number, description, supplier_sku, quantity, unit, unit_price, total_amount, unit_price_basis, raw_material_id, match_confidence, requires_review)
  values (inv, 1, 'TEST frø', 'INF3', 10, 'pose', 0.5, 500, 'g', rm, 'manual', true) returning id into l1;
  -- 2) ukjent prisgrunnlag, samme tall: ingen pakningsgjetning fra forholdet.
  insert into invoice_lines (invoice_id, line_number, description, supplier_sku, quantity, unit, unit_price, total_amount, raw_material_id, match_confidence, requires_review)
  values (inv, 2, 'TEST frø', 'INF3', 10, 'pose', 0.5, 500, rm, 'manual', true) returning id into l2;
  -- 3) trykt rabatt forklarer summen: aldri pakningsbevis.
  insert into invoice_lines (invoice_id, line_number, description, supplier_sku, quantity, unit, unit_price, total_amount, unit_price_basis, discount_amount, raw_material_id, match_confidence, requires_review)
  values (inv, 3, 'TEST frø', 'INF3', 10, 'pose', 977.74, 6697.50, 'pakning', 3079.90, rm, 'manual', true) returning id into l3;
  -- 4) pris per kg med 25 kg sekk: basis = grunnenhet, faktor 1.
  insert into invoice_lines (invoice_id, line_number, description, supplier_sku, quantity, unit, unit_price, total_amount, unit_price_basis, raw_material_id, match_confidence, requires_review)
  values (inv, 4, 'TEST frø', 'INF3', 2, 'sekk', 20, 1000, 'kg', rm, 'manual', true) returning id into l4;

  r := public.rm_infer_package(l1);
  if (r->'arithmetic'->>'ok')::boolean is not true or (r->'arithmetic'->>'bupp')::numeric <> 0.1 or r->>'source' <> 'regnestykke' or r->'variant' <> 'null'::jsonb and r->'variant' is not null then ok := false; end if;
  log := log || format('g->kg bupp=%s source=%s variant=%s; ', r->'arithmetic'->>'bupp', r->>'source', coalesce(r->>'variant','null'));
  r := public.rm_infer_package(l2);
  if (r->'arithmetic'->>'ok')::boolean or r->'arithmetic'->>'raw' is not null or r->>'suggested_bupp' is not null or r->'arithmetic'->>'note' <> 'prisgrunnlag_ukjent' then ok := false; end if;
  log := log || format('ukjent grunnlag suggested=%s note=%s; ', coalesce(r->>'suggested_bupp','null'), r->'arithmetic'->>'note');
  r := public.rm_infer_package(l3);
  if (r->'arithmetic'->>'ok')::boolean or r->>'suggested_bupp' is not null or r->'arithmetic'->>'note' <> 'rabatt' or (r->>'auto_confirmable')::boolean then ok := false; end if;
  log := log || format('rabatt suggested=%s auto=%s; ', coalesce(r->>'suggested_bupp','null'), r->>'auto_confirmable');
  r := public.rm_infer_package(l4);
  if (r->'arithmetic'->>'bupp')::numeric <> 25 then ok := false; end if;
  log := log || format('kg bupp=%s; ', r->'arithmetic'->>'bupp');

  -- Samme variant bekreftet → brukes; erstattet → brukes ikke.
  insert into raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_size, package_unit, base_units_per_package, confirmed_at)
  values (rms, public.rm_sku_norm('INF3'), 1, 'pose', 1, now());
  r := public.rm_infer_package(l2);
  if r->>'source' <> 'bekreftet_pakning' or (r->>'suggested_bupp')::numeric <> 1 then ok := false; end if;
  log := log || format('bekreftet source=%s; ', r->>'source');
  update raw_material_supplier_packages set superseded_at = now(), superseded_reason = 'test' where raw_material_supplier_id = rms;
  r := public.rm_infer_package(l2);
  if r->>'source' is not null or r->'variant' is not null and r->'variant' <> 'null'::jsonb then ok := false; end if;
  log := log || format('erstattet source=%s; ', coalesce(r->>'source','null'));

  raise exception 'RESULTAT: % %', case when ok then 'ALLE OK' else 'FEIL' end, log;
end $$;
