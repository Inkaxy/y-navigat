-- Regresjon (fix_packing_confirmation_aliases): rm_confirm_line_match med p_confirm_package=true,
-- EKSISTERENDE raw_material_suppliers-rad og container-UPDATE-grenen (tidligere fixture gikk utenom den).
-- Syntetiske data; blokken avslutter ALLTID med RAISE (rollback). Ingen ekte fakturaer berøres.
do $$
declare
  le uuid := '751709bc-04b3-4449-867d-b97faa9ab373';
  w uuid; uid uuid; rm uuid; sup uuid; rms uuid; inv uuid; inv2 uuid; inv3 uuid; ln uuid; ln_other uuid; ln2 uuid; ln3 uuid;
  r jsonb; s record; log text := ''; ok boolean := true; other_before text;
begin
  for w in select id from auth.users order by created_at loop
    perform set_config('request.jwt.claims', json_build_object('sub', w, 'role', 'authenticated')::text, true);
    if public.has_ravarer_invoice_access(le, 'write') then uid := w; exit; end if;
  end loop;
  if uid is null then raise exception 'RESULTAT: FEIL ingen bruker med skrivetilgang'; end if;

  insert into raw_materials (legal_entity_id, sku, name, item_type, base_unit) values (le, 'TEST-CONF-A', 'Testvare pose 100g', 'ravare', 'kg') returning id into rm;
  insert into suppliers (legal_entity_id, name) values (le, 'Testleverandør confirm') returning id into sup;
  -- Eksisterende kobling uten pakning: UPDATE-grenen + container-UPDATE kjøres.
  insert into raw_material_suppliers (raw_material_id, supplier_id, supplier_sku) values (rm, sup, 'DEMO-T1') returning id into rms;
  insert into invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, total_amount, currency, status)
  values (le, sup, 'DEMO1042', '2026-09-01', 950, 'NOK', 'needs_review') returning id into inv;
  insert into invoice_lines (invoice_id, line_number, description, supplier_sku, quantity, unit, unit_price, total_amount, discount_amount, unit_price_basis, requires_review)
  values (inv, 1, 'Testvare pose 100g', 'DEMO-T1', 10, 'Pose', 120, 950, 250, 'pakning', true) returning id into ln;
  insert into invoice_lines (invoice_id, line_number, description, supplier_sku, quantity, unit, unit_price, total_amount, requires_review, review_reason)
  values (inv, 2, 'Annen testvare', 'DEMO-T2', 1, 'stk', 10, 10, true, 'unmatched') returning id into ln_other;
  select review_reason into other_before from invoice_lines where id = ln_other;

  -- 1) Faktisk confirm-kall: tidligere «column reference s.id is ambiguous».
  r := public.rm_confirm_line_match(ln, rm, 100, 'g', 0.1, true, null, false, null, false);
  if coalesce((r->>'ok')::boolean, false) is not true or (r->>'raw_material_supplier_id')::uuid <> rms then ok := false; end if;
  select * into s from raw_material_suppliers where id = rms;
  if s.package_size <> 100 or s.package_unit <> 'g' or s.base_units_per_package <> 0.1 or s.container_unit is distinct from 'pose'
     or s.package_confirmed_at is null or s.package_confirmed_by <> uid then ok := false; end if;
  log := log || format('1 ok=%s size=%s unit=%s bupp=%s container=%s; ', r->>'ok', s.package_size, s.package_unit, s.base_units_per_package, s.container_unit);

  -- 2) Variant lagret med beholder og innhold.
  if not exists (select 1 from raw_material_supplier_packages p where p.raw_material_supplier_id = rms and p.package_size = 100
                 and p.package_unit = 'g' and p.base_units_per_package = 0.1 and p.container_unit = 'pose' and p.superseded_at is null) then ok := false; end if;

  -- 3) Bare valgt linje endret; mengde/pris/sum/enhet uendret; base_quantity 1 kg.
  if (select raw_material_id from invoice_lines where id = ln_other) is not null
     or (select review_reason from invoice_lines where id = ln_other) is distinct from other_before then ok := false; end if;
  if exists (select 1 from invoice_lines where id = ln and (quantity <> 10 or unit <> 'Pose' or unit_price <> 120 or total_amount <> 950
             or discount_amount <> 250 or raw_material_id <> rm or base_quantity <> 1)) then ok := false; end if;
  log := log || format('3 base_qty=%s; ', (select base_quantity from invoice_lines where id = ln));

  -- 4) Audit skrevet for linjen.
  if not exists (select 1 from audit_log a where a.action = 'invoice_line_match_confirmed' and a.entity_id = ln
                 and (a.changes->>'package_confirmed')::boolean and a.user_id = uid) then ok := false; end if;

  -- 5) Godkjent faktura avvises, ingen skriving.
  insert into invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, total_amount, currency, status)
  values (le, sup, 'DEMO1043', '2026-09-02', 950, 'NOK', 'needs_review') returning id into inv2;
  insert into invoice_lines (invoice_id, line_number, description, supplier_sku, quantity, unit, unit_price, total_amount, requires_review)
  values (inv2, 1, 'Testvare pose 100g', 'DEMO-T1', 10, 'pose', 95, 950, true) returning id into ln2;
  insert into invoice_internal_approvals (invoice_id, legal_entity_id, approved_by, status) values (inv2, le, uid, 'approved');
  r := public.rm_confirm_line_match(ln2, rm, 100, 'g', 0.1, true, null, false, null, false);
  if r->>'reason' is distinct from 'faktura_godkjent' or (select raw_material_id from invoice_lines where id = ln2) is not null then ok := false; end if;
  log := log || format('5 %s; ', r->>'reason');

  -- 6) Ført kostpris avvises, ingen skriving.
  insert into invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, total_amount, currency, status)
  values (le, sup, 'DEMO1044', '2026-09-03', 950, 'NOK', 'needs_review') returning id into inv3;
  insert into invoice_lines (invoice_id, line_number, description, supplier_sku, quantity, unit, unit_price, total_amount, requires_review)
  values (inv3, 1, 'Testvare pose 100g', 'DEMO-T1', 10, 'pose', 95, 950, true) returning id into ln3;
  insert into invoice_line_cost_postings (invoice_line_id, invoice_id, legal_entity_id, posted_by) values (ln3, inv3, le, uid);
  r := public.rm_confirm_line_match(ln3, rm, 100, 'g', 0.1, true, null, false, null, false);
  if r->>'reason' is distinct from 'kostpris_fort' or (select raw_material_id from invoice_lines where id = ln3) is not null then ok := false; end if;
  log := log || format('6 %s; ', r->>'reason');

  raise exception 'RESULTAT: % %', case when ok then 'ALLE OK' else 'FEIL' end, log;
end $$;
