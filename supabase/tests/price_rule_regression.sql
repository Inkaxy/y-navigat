-- Prisregel: faktiske SQL-regresjonstester (2026-10-11). Kjøres som én blokk; rulles ALLTID tilbake
-- (avsluttes med RAISE). Forventet resultat står i kommentarene. Krever en bruker med råvare-skrivetilgang (uid).
-- Forventet: T1a 100/verifisert · T1b mangler, brukbar=null · T1c has_cost=false · T1d uverifisert, brukbar=50
--            T2a 0 · T2b 41 · T3 10 · T4a 100/verifisert · T4b status=mangler, brukbar=null, has_cost=false
--            T5 l->kg=null kg->l=null l->kg(1.03)=1.03 g->kg=1 ml-med-lagrede-gram=null · T6 endret=0 forhåndsvisning=2
do $$
declare
  le uuid := '751709bc-04b3-4449-867d-b97faa9ab373';
  uid uuid := 'b4074a41-395b-470e-bac9-1cad293bc714';
  sup uuid; rm1 uuid; rm2 uuid; rm3 uuid; rm4 uuid; rm5 uuid; rm6 uuid; h uuid; inv uuid; inv2 uuid; il uuid; prod uuid; prod2 uuid;
  r text := ''; v numeric; s text; n int; j jsonb;
begin
  insert into suppliers(legal_entity_id, name) values (le, 'ZZTEST lev') returning id into sup;
  -- T1: gyldig 100, eneste kilde ugyldiggjøres => mangler i faktisk produktkalkyle
  insert into raw_materials(legal_entity_id, sku, name, base_unit) values (le, 'ZZT1', 'ZZT1', 'kg') returning id into rm1;
  insert into raw_material_price_history(raw_material_id, supplier_id, price, effective_date, source, notes, created_by, currency, cost_eligible)
    values (rm1, sup, 100, current_date - 2, 'manual', 'test kilde', uid, 'NOK', true) returning id into h;
  v := public.rm_apply_derived_cost_price(rm1);
  r := r || format('T1a %s/%s | ', v, (select cost_basis_status from raw_materials where id = rm1));
  update raw_material_price_history set superseded_at = now(), superseded_reason = 'test' where id = h;
  r := r || format('T1b %s brukbar=%s | ', (select cost_basis_status from raw_materials where id = rm1), public.rm_usable_cost(rm1));
  insert into products(legal_entity_id, display_number, code, display_name, product_category, calc_type)
    values (le, 999999901, 'ZZTP', 'ZZT produkt', 'test', 'handelsvare') returning id into prod;
  insert into raw_material_products(product_id, raw_material_id, base_units_per_sold_unit) values (prod, rm1, 1);
  r := r || format('T1c has_cost=%s | ', public.product_cost(prod, 0)->>'has_cost');
  insert into raw_materials(legal_entity_id, sku, name, base_unit, current_cost_price) values (le, 'ZZT1d', 'ZZT1d', 'kg', 50) returning id into rm5;
  perform public.rm_apply_derived_cost_price(rm5);
  r := r || format('T1d %s brukbar=%s | ', (select cost_basis_status from raw_materials where id = rm5), public.rm_usable_cost(rm5));
  -- T2: registrert enhetsbytte
  insert into raw_materials(legal_entity_id, sku, name, base_unit) values (le, 'ZZT2', 'ZZT2', 'kg') returning id into rm2;
  insert into audit_log(action, entity_type, entity_id, legal_entity_id, changes, source_app, occurred_at)
    values ('raw_material.base_unit_changed', 'raw_material', rm2, le, '{}'::jsonb, 'ravarer', now() - interval '1 hour');
  insert into raw_material_price_history(raw_material_id, price, effective_date, source, notes, created_by, currency, cost_eligible)
    values (rm2, 40, current_date - 10, 'manual', 'før byttet', uid, 'NOK', true);
  select count(*) into n from public._rm_cost_candidates(rm2, current_date);
  r := r || format('T2a %s | ', n);
  insert into raw_material_price_history(raw_material_id, price, effective_date, source, notes, created_by, currency, cost_eligible)
    values (rm2, 41, current_date, 'manual', 'etter byttet', uid, 'NOK', true);
  r := r || format('T2b %s | ', (select price from public._rm_cost_candidates(rm2, current_date) limit 1));
  -- T3: gammel historikk-rad uten eksplisitt kvalifisering
  insert into raw_materials(legal_entity_id, sku, name, base_unit) values (le, 'ZZT3', 'ZZT3', 'kg') returning id into rm3;
  insert into raw_material_price_history(raw_material_id, price, effective_date, source, notes, created_by, currency, cost_eligible)
    values (rm3, 10, current_date - 5, 'manual', 'kvalifisert', uid, 'NOK', true),
           (rm3, 99, current_date - 1, 'manual', 'gammel notatrad lang nok', uid, 'NOK', false);
  r := r || format('T3 %s | ', (select price from public._rm_cost_candidates(rm3, current_date) limit 1));
  -- T4: observasjon må stemme med linjen
  insert into raw_materials(legal_entity_id, sku, name, base_unit) values (le, 'ZZT4', 'ZZT4', 'kg') returning id into rm4;
  insert into invoices(legal_entity_id, supplier_id, invoice_number, invoice_date, status, currency, lines_sum_status)
    values (le, sup, 'ZZT-INV-1', current_date - 3, 'reconciled', 'NOK', 'ok') returning id into inv;
  insert into invoice_lines(invoice_id, raw_material_id, description, quantity, unit, unit_price, unit_price_basis, total_amount, base_quantity, price_per_base_unit, match_confidence, requires_review, line_kind)
    values (inv, rm4, 'ZZ vare', 10, 'kg', 100, 'mengdeenhet', 1000, 10, 100, 'manual', false, 'vare') returning id into il;
  insert into products(legal_entity_id, display_number, code, display_name, product_category, calc_type)
    values (le, 999999902, 'ZZTP2', 'ZZT produkt 2', 'test', 'handelsvare') returning id into prod2;
  insert into raw_material_products(product_id, raw_material_id, base_units_per_sold_unit) values (prod2, rm4, 1);
  r := r || format('T4a %s/%s | ', (select current_cost_price from raw_materials where id = rm4), (select cost_basis_status from raw_materials where id = rm4));
  update invoice_lines set total_amount = 10 where id = il;
  r := r || format('T4b %s brukbar=%s has_cost=%s | ', (select cost_basis_status from raw_materials where id = rm4),
       coalesce(public.rm_usable_cost(rm4)::text, 'null'), public.product_cost(prod2, 0)->>'has_cost');
  -- T5: ingen tetthetsantakelse
  r := r || format('T5 %s %s %s %s %s | ',
    coalesce(public.recipe_line_base_qty(1, 'l', null, 'kg')::text, 'null'), coalesce(public.recipe_line_base_qty(1, 'kg', null, 'l')::text, 'null'),
    public.recipe_line_base_qty(1, 'l', null, 'kg', 1.03), public.recipe_line_base_qty(1000, 'g', null, 'kg'),
    coalesce(public.recipe_line_base_qty(500, 'ml', 500, 'kg')::text, 'null'));
  -- T6: ubekreftet OCR-pakning og dagens eneste pakning endrer ikke gamle linjer
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  insert into raw_materials(legal_entity_id, sku, name, base_unit, base_units_per_package) values (le, 'ZZT6', 'ZZT6', 'kg', 5) returning id into rm6;
  insert into raw_material_suppliers(raw_material_id, supplier_id, base_units_per_package, package_confirmed_at) values (rm6, sup, 5, now());
  insert into invoices(legal_entity_id, supplier_id, invoice_number, invoice_date, status, currency, lines_sum_status)
    values (le, sup, 'ZZT-INV-6', current_date - 300, 'reconciled', 'NOK', 'ok') returning id into inv2;
  insert into invoice_lines(invoice_id, raw_material_id, description, quantity, unit, unit_price, total_amount, package_size, package_unit, count_per_package, match_confidence, requires_review, line_kind, base_quantity, price_per_base_unit)
    values (inv2, rm6, 'KJEKS 36X90G', 2, 'eske', 150, 300, 90, 'g', 36, 'auto_high', false, 'vare', 2, 150),
           (inv2, rm6, 'GAMMEL UTEN PAKNING', 1, 'eske', 100, 100, null, null, null, 'auto_high', false, 'vare', 1, 100);
  j := public.recalc_raw_material_cost(rm6, false, 'test');
  r := r || format('T6 endret=%s forhåndsvisning=%s', j->>'lines_changed', j->>'lines_preview_only');
  raise exception 'RESULTAT: %', r;
end $$;

-- T7 (2026-10-11): ekte triggersekvens, ingen manuell rm_apply. Rulles tilbake via exception.
do $$
declare rid uuid; s0 text; s1 text; u1 numeric; s2 text;
begin
  select id, cost_basis_status into rid, s0 from raw_materials where cost_basis_status='verifisert' and cost_source_history_id is not null limit 1;
  update raw_material_price_history set superseded_at=now(), superseded_reason='test' where raw_material_id=rid and superseded_at is null;
  select cost_basis_status into s1 from raw_materials where id=rid; u1 := rm_usable_cost(rid);
  update raw_material_price_history set superseded_at=null, superseded_reason=null where raw_material_id=rid and superseded_reason='test';
  select cost_basis_status into s2 from raw_materials where id=rid;
  if s1 <> 'mangler' or u1 is not null or s2 <> 'verifisert' then raise exception 'T7 FEIL % % %', s1, u1, s2; end if;
  raise exception 'T7 OK (rollback)';
end $$;
