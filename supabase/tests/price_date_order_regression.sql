-- Regresjon: datorekkefølge i priskontroll. Kjøres som ÉN blokk som alltid
-- avsluttes med RAISE, slik at alt rulles tilbake (ingen ekte data endres).
-- Resultatet står i feilmeldingen: «RESULT: ...». Alle linjer må være OK.
DO $t$
DECLARE
  le uuid := (SELECT id FROM legal_entities ORDER BY created_at LIMIT 1);
  sup uuid; sup2 uuid; rm uuid;
  out text := '';
  ref jsonb; cost numeric;
  i_jan uuid; i_mar uuid; i_feb1 uuid; i_feb2 uuid; i_usd uuid; i_oth uuid; i_apr uuid;
  l_mar uuid; l_apr uuid;
  ok boolean;
  FUNCTION_UNUSED int;
BEGIN
  INSERT INTO suppliers(legal_entity_id, name) VALUES (le, 'ZZ test lev A') RETURNING id INTO sup;
  INSERT INTO suppliers(legal_entity_id, name) VALUES (le, 'ZZ test lev B') RETURNING id INTO sup2;
  INSERT INTO raw_materials(legal_entity_id, sku, name, base_unit) VALUES (le, 'ZZTEST-DATO', 'ZZ testmel', 'kg') RETURNING id INTO rm;

  CREATE TEMP TABLE _mk(k text, inv uuid, line uuid) ON COMMIT DROP;

  -- Hjelper som lager en faktura med én linje (10 kg × pris).
  CREATE OR REPLACE FUNCTION pg_temp.mk(p_le uuid, p_sup uuid, p_rm uuid, p_no text, p_date date, p_price numeric, p_cur text DEFAULT 'NOK')
  RETURNS uuid LANGUAGE plpgsql AS $f$
  DECLARE v_i uuid;
  BEGIN
    INSERT INTO invoices(legal_entity_id, supplier_id, invoice_number, invoice_date, status, currency, total_amount, lines_sum_status)
    VALUES (p_le, p_sup, p_no, p_date, 'needs_review', p_cur, p_price*10, 'ok') RETURNING id INTO v_i;
    INSERT INTO invoice_lines(invoice_id, description, quantity, unit, unit_price, total_amount, base_quantity,
                              price_per_base_unit, raw_material_id, match_confidence, requires_review)
    VALUES (v_i, 'Testmel', 10, 'kg', p_price, p_price*10, 10, p_price, p_rm, 'manual', false);
    RETURN v_i;
  END $f$;

  -- (1) Rekkefølge mar120 først, så jan100.
  i_mar := pg_temp.mk(le, sup, rm, 'T-MAR', '2026-03-10', 120);
  i_jan := pg_temp.mk(le, sup, rm, 'T-JAN', '2026-01-10', 100);
  ref := rm_price_reference(rm, sup, i_jan, '2026-01-10');
  out := out || format('jan_for_mar_ref=%s;', ref->>'source');
  PERFORM _rm_reconcile_core(i_mar, NULL, 'manual');
  ref := rm_price_reference(rm, sup, i_jan, '2026-01-10');
  out := out || format('jan_etter_mar_ref=%s(%s);', ref->>'source', CASE WHEN ref->>'source'='none' THEN 'OK' ELSE 'FEIL' END);
  PERFORM _rm_reconcile_core(i_jan, NULL, 'manual');
  SELECT current_cost_price INTO cost FROM raw_materials WHERE id = rm;
  out := out || format('kost_etter_jan=%s(%s);', cost, CASE WHEN cost=120 THEN 'OK' ELSE 'FEIL' END);
  ref := rm_price_reference(rm, sup, i_mar, '2026-03-10');
  out := out || format('mar_ref=%s:%s(%s);', ref->>'source', ref->>'price', CASE WHEN ref->>'source'='last_purchase' AND (ref->>'price')::numeric=100 THEN 'OK' ELSE 'FEIL' END);
  -- Historikk beholder fakturadato.
  SELECT bool_and(h.effective_date = i.invoice_date AND h.supplier_id = sup AND h.currency='NOK') INTO ok
    FROM raw_material_price_history h JOIN invoices i ON i.id=h.invoice_id WHERE h.raw_material_id = rm;
  out := out || format('historikk_dato(%s);', CASE WHEN ok THEN 'OK' ELSE 'FEIL' END);

  -- (2) Eldre etterimport: april-faktura vurderes mot mars, ikke senere/egen.
  i_apr := pg_temp.mk(le, sup, rm, 'T-APR', '2026-04-10', 150);
  ref := rm_price_reference(rm, sup, i_apr, '2026-04-10');
  out := out || format('apr_ref=%s(%s);', ref->>'price', CASE WHEN (ref->>'price')::numeric=120 THEN 'OK' ELSE 'FEIL' END);

  -- (3) Samme dato, ulik pris -> konflikt, uavhengig av rekkefølge.
  i_feb1 := pg_temp.mk(le, sup, rm, 'T-FEB1', '2026-02-10', 110);
  i_feb2 := pg_temp.mk(le, sup, rm, 'T-FEB2', '2026-02-10', 115);
  PERFORM _rm_reconcile_core(i_feb2, NULL, 'manual');
  PERFORM _rm_reconcile_core(i_feb1, NULL, 'manual');
  ref := rm_price_reference(rm, sup, i_mar, '2026-03-10');
  out := out || format('samme_dato=%s/%s(%s);', ref->>'source', ref->>'reason', CASE WHEN ref->>'source'='conflict' THEN 'OK' ELSE 'FEIL' END);
  -- Ny faktura samme dato som feb ser fortsatt bare jan (strengt før).
  ref := rm_price_reference(rm, sup, NULL, '2026-02-10');
  out := out || format('feb_samme_dag=%s(%s);', ref->>'price', CASE WHEN (ref->>'price')::numeric=100 THEN 'OK' ELSE 'FEIL' END);
  SELECT current_cost_price INTO cost FROM raw_materials WHERE id = rm;
  out := out || format('kost_fortsatt_mar=%s(%s);', cost, CASE WHEN cost=120 THEN 'OK' ELSE 'FEIL' END);

  -- (4) Annen leverandør og valuta brukes ikke.
  ref := rm_price_reference(rm, sup2, NULL, '2026-12-31');
  out := out || format('annen_lev=%s(%s);', ref->>'source', CASE WHEN ref->>'source'='none' THEN 'OK' ELSE 'FEIL' END);
  i_usd := pg_temp.mk(le, sup, rm, 'T-USD', '2026-03-20', 5, 'USD');
  ref := rm_price_reference(rm, sup, NULL, '2026-03-25');
  out := out || format('usd_ignorert=%s(%s);', ref->>'price', CASE WHEN (ref->>'price')::numeric=120 THEN 'OK' ELSE 'FEIL' END);

  -- (5) Manglende historikk = eksplisitt ukjent.
  ref := rm_price_reference(rm, sup, NULL, '2025-06-01');
  out := out || format('ingen_historikk=%s(%s);', ref->>'reason', CASE WHEN ref->>'source'='none' THEN 'OK' ELSE 'FEIL' END);

  -- (6) Godtatt prisavvik på april: forrige kjøp mar (2026-03-10).
  SELECT id INTO l_apr FROM invoice_lines WHERE invoice_id = i_apr;
  UPDATE invoice_lines SET expected_price_per_base_unit = 110, price_reference_source='last_purchase',
         price_reference_id = gen_random_uuid(), price_reference_date = '2026-02-10' WHERE id = l_apr;
  UPDATE invoice_lines l SET price_acceptance = invoice_line_price_basis(l) || jsonb_build_object('accepted_reasons', jsonb_build_array('price_increase')),
         requires_review=false, review_reason=null, resolution_note='Prisavvik godtatt' WHERE id = l_apr;
  -- Motoren: eldre/nyere kjøp (mars) flyttet referansen, linjen uendret.
  UPDATE invoice_lines SET price_acceptance=NULL, expected_price_per_base_unit=120, price_reference_date='2026-03-10',
         price_reference_id=gen_random_uuid(), requires_review=true, review_reason='price_increase' WHERE id = l_apr;
  SELECT price_acceptance IS NOT NULL AND NOT requires_review AND review_reason IS NULL INTO ok FROM invoice_lines WHERE id = l_apr;
  out := out || format('godkjenning_beholdt(%s);', CASE WHEN ok THEN 'OK' ELSE 'FEIL' END);
  -- Rematch uten endring (samme referanse) beholder også.
  UPDATE invoice_lines SET price_acceptance=NULL, requires_review=true, review_reason='price_increase' WHERE id = l_apr;
  SELECT price_acceptance IS NOT NULL AND NOT requires_review INTO ok FROM invoice_lines WHERE id = l_apr;
  out := out || format('rematch_uendret(%s);', CASE WHEN ok THEN 'OK' ELSE 'FEIL' END);
  -- Andre årsaker står.
  UPDATE invoice_lines SET price_acceptance=NULL, requires_review=true, review_reason='price_increase,unknown_package_size' WHERE id = l_apr;
  SELECT requires_review AND review_reason='unknown_package_size' INTO ok FROM invoice_lines WHERE id = l_apr;
  out := out || format('andre_aarsaker_star(%s);', CASE WHEN ok THEN 'OK' ELSE 'FEIL' END);
  UPDATE invoice_lines SET requires_review=false, review_reason=null WHERE id = l_apr;
  -- Endret mengde åpner kontrollen.
  UPDATE invoice_lines SET price_acceptance=NULL, quantity=12, requires_review=true, review_reason='price_increase' WHERE id = l_apr;
  SELECT price_acceptance IS NULL AND requires_review INTO ok FROM invoice_lines WHERE id = l_apr;
  out := out || format('endret_mengde_gjenapnet(%s);', CASE WHEN ok THEN 'OK' ELSE 'FEIL' END);
  -- Ny avtale som grunnlag åpner kontrollen.
  UPDATE invoice_lines l SET quantity=10, price_acceptance = invoice_line_price_basis(l) || jsonb_build_object('accepted_reasons', jsonb_build_array('price_increase')),
         requires_review=false, review_reason=null WHERE id = l_apr;
  UPDATE invoice_lines SET price_acceptance=NULL, price_reference_source='agreement', requires_review=true, review_reason='price_increase' WHERE id = l_apr;
  SELECT price_acceptance IS NULL AND requires_review INTO ok FROM invoice_lines WHERE id = l_apr;
  out := out || format('avtale_gjenapnet(%s);', CASE WHEN ok THEN 'OK' ELSE 'FEIL' END);
  -- Ukjent grunnlag (none) åpner kontrollen.
  UPDATE invoice_lines l SET price_reference_source='last_purchase', price_acceptance = invoice_line_price_basis(l) || jsonb_build_object('accepted_reasons', jsonb_build_array('price_increase')),
         requires_review=false, review_reason=null WHERE id = l_apr;
  UPDATE invoice_lines SET price_acceptance=NULL, price_reference_source='none', price_reference_date=NULL, requires_review=true, review_reason='no_automatic_basis' WHERE id = l_apr;
  SELECT price_acceptance IS NULL AND requires_review INTO ok FROM invoice_lines WHERE id = l_apr;
  out := out || format('ukjent_gjenapnet(%s);', CASE WHEN ok THEN 'OK' ELSE 'FEIL' END);

  RAISE EXCEPTION 'RESULT: %', out;
END $t$;
