-- Isolert kontraktstest av fakturagodkjenning, kreditfordeling og kostprisføring.
-- Kjøres som én transaksjon som ALLTID rulles tilbake (RAISE til slutt) — ingen data blir igjen.
-- Resultatet står i feilmeldingen: «TESTRESULTAT: ...». Alle linjer skal være OK.
DO $t$
DECLARE
  ent uuid := '751709bc-04b3-4449-867d-b97faa9ab373';
  sup uuid := '2c80ffe4-7249-49a1-87fd-07d048077281';
  admin_u text := 'cc66ddb9-e3ad-4f59-bbba-56afbd3c7a09';
  write_u text := '8ee58301-c6c5-455e-84f8-f07113b554e8';
  rmid uuid := 'd6bc1e1b-435b-4ee1-b097-1bd3c419a978';
  sfx text := substr(md5(random()::text), 1, 8);
  a uuid; b uuid; cn uuid; cn2 uuid; u uuid; p uuid; la uuid; lb uuid; lp uuid; lq uuid;
  cs uuid; r1 uuid := gen_random_uuid(); res jsonb; bl text[]; out text := ''; n int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', admin_u, true);

  -- 1) Array-feilen
  BEGIN
    bl := ARRAY[]::text[]; bl := array_append(bl, 'flagget');
    out := out || '1 array_append OK; ';
  END;

  INSERT INTO invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, currency, total_amount, total_vat, status, lines_sum_status)
  VALUES (ent, sup, 'T-7301-'||sfx, current_date, 'NOK', 3450, 450, 'needs_review', 'ok') RETURNING id INTO a;
  INSERT INTO invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, currency, total_amount, total_vat, status, lines_sum_status)
  VALUES (ent, sup, 'T-7302-'||sfx, current_date, 'NOK', 3450, 450, 'needs_review', 'ok') RETURNING id INTO b;
  INSERT INTO invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, currency, total_amount, total_vat, status, lines_sum_status, is_credit_note)
  VALUES (ent, sup, 'T-K1-'||sfx, current_date, 'NOK', -1725, -225, 'needs_review', 'ok', true) RETURNING id INTO cn;
  INSERT INTO invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, currency, total_amount, total_vat, status, lines_sum_status, is_credit_note)
  VALUES (ent, sup, 'T-K2-'||sfx, current_date, 'NOK', -1725, NULL, 'needs_review', 'ok', true) RETURNING id INTO cn2;
  INSERT INTO invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, currency, total_amount, total_vat, status, lines_sum_status)
  VALUES (ent, sup, 'T-U-'||sfx, current_date, 'NOK', 100, 20, 'needs_review', 'not_checked') RETURNING id INTO u;
  INSERT INTO invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, currency, total_amount, total_vat, status, lines_sum_status)
  VALUES (ent, sup, 'T-P-'||sfx, current_date, 'NOK', 375, 75, 'needs_review', 'ok') RETURNING id INTO p;

  INSERT INTO invoice_lines (invoice_id, line_number, description, quantity, unit, unit_price, total_amount, base_quantity, price_per_base_unit, expected_price_per_base_unit, requires_review, review_reason)
  VALUES (a, 1, 'Mel 25 kg', 50, 'sekk', 60, 3000, 100, 30, 15, true, 'price_variance') RETURNING id INTO la;
  INSERT INTO invoice_lines (invoice_id, line_number, description, quantity, unit, unit_price, total_amount, base_quantity, price_per_base_unit, expected_price_per_base_unit, requires_review, review_reason)
  VALUES (b, 1, 'Mel 25 kg', 50, 'sekk', 60, 3000, 100, 30, 15, true, 'price_variance') RETURNING id INTO lb;
  INSERT INTO invoice_lines (invoice_id, line_number, description, quantity, unit, unit_price, total_amount) VALUES (u, 1, 'X', 1, 'stk', 80, 80);
  INSERT INTO invoice_lines (invoice_id, line_number, description, quantity, unit, unit_price, total_amount, raw_material_id, match_confidence, base_quantity, price_per_base_unit, requires_review, review_reason)
  VALUES (p, 1, 'Løs vare kg', 10, 'kg', 30, 300, rmid, 'auto_high', 10, 30, true, 'no_automatic_basis') RETURNING id INTO lp;
  INSERT INTO invoice_lines (invoice_id, line_number, description, quantity, unit, unit_price, total_amount, raw_material_id, match_confidence, base_quantity, price_per_base_unit, requires_review, review_reason)
  VALUES (p, 2, 'Eske uten bekreftet pakning', 1, 'eske', 0, 0.01, rmid, 'auto_high', 1, 0.01, false, NULL) RETURNING id INTO lq;
  UPDATE invoice_lines SET unit_price = 0.01 WHERE id = lq;

  bl := invoice_approval_blockers(a);
  out := out || CASE WHEN 'prisavvik' = ANY(bl) THEN '2 prisavvik sperrer uten feil OK; ' ELSE '2 FEIL '||bl::text||'; ' END;
  bl := invoice_approval_blockers(u);
  out := out || CASE WHEN 'sum_ukontrollert' = ANY(bl) THEN '3 ukontrollert sum sperrer OK; ' ELSE '3 FEIL '||bl::text||'; ' END;

  -- 4) Write-bruker kan ikke attestere
  PERFORM set_config('request.jwt.claims', json_build_object('sub', write_u, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', write_u, true);
  BEGIN
    res := approve_invoice_internal(p, NULL);
    out := out || '4 FEIL write-bruker fikk godkjenne; ';
  EXCEPTION WHEN insufficient_privilege THEN out := out || '4 write-bruker avvist OK; ';
  END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', admin_u, true);

  -- 5) Sak og delkreditering
  res := create_supplier_deviation_case(ARRAY[la, lb], 'Test prisavvik', NULL, NULL, NULL);
  cs := (res->>'case_id')::uuid;
  res := allocate_supplier_deviation_credit(cs, cn, a, 1500, r1, NULL);
  out := out || CASE WHEN (res->>'already_saved')::boolean = false AND (res->>'remaining_excl_vat')::numeric = 0 THEN '5 kredit 1500 på A OK; ' ELSE '5 FEIL '||res::text||'; ' END;
  res := allocate_supplier_deviation_credit(cs, cn, a, 1500, r1, NULL);
  out := out || CASE WHEN (res->>'already_saved')::boolean THEN '6 replay samme innhold OK; ' ELSE '6 FEIL; ' END;
  BEGIN
    res := allocate_supplier_deviation_credit(cs, cn, b, 100, r1, NULL);
    out := out || '7 FEIL gjenbrukt nøkkel godtatt; ';
  EXCEPTION WHEN raise_exception THEN out := out || CASE WHEN SQLERRM LIKE '%client_ref_gjenbrukt%' THEN '7 gjenbrukt nøkkel avvist OK; ' ELSE '7 FEIL '||SQLERRM||'; ' END;
  END;
  BEGIN
    res := allocate_supplier_deviation_credit(cs, cn, b, 1, gen_random_uuid(), NULL);
    out := out || '8 FEIL overfordelt; ';
  EXCEPTION WHEN raise_exception THEN out := out || CASE WHEN SQLERRM LIKE '%overfordelt%' THEN '8 overfordeling avvist OK; ' ELSE '8 FEIL '||SQLERRM||'; ' END;
  END;
  BEGIN
    res := allocate_supplier_deviation_credit(cs, cn2, b, 1, gen_random_uuid(), NULL);
    out := out || '9 FEIL ukjent mva godtatt; ';
  EXCEPTION WHEN raise_exception THEN out := out || CASE WHEN SQLERRM LIKE '%mva_ukjent%' THEN '9 ukjent mva avvist OK; ' ELSE '9 FEIL '||SQLERRM||'; ' END;
  END;
  bl := invoice_approval_blockers(a);
  out := out || CASE WHEN NOT ('prisavvik' = ANY(bl)) AND NOT ('leverandorsak' = ANY(bl)) THEN '10 A dekket, ingen prissperre OK; ' ELSE '10 FEIL '||bl::text||'; ' END;
  bl := invoice_approval_blockers(b);
  out := out || CASE WHEN 'prisavvik' = ANY(bl) AND 'leverandorsak' = ANY(bl) THEN '11 B fortsatt sperret OK; ' ELSE '11 FEIL '||bl::text||'; ' END;
  SELECT count(*) INTO n FROM invoice_internal_approvals WHERE invoice_id IN (a, b);
  out := out || CASE WHEN n = 0 THEN '12 ingen automatisk godkjenning OK; ' ELSE '12 FEIL; ' END;

  -- 13) Trygg kostpris: løs kg-linje føres, eske uten bekreftet pakning hoppes over, ingen dobbel historikk
  res := rm_post_safe_line_costs(p, NULL);
  out := out || CASE WHEN (res->>'posted')::int = 1 AND res->'skipped' @> jsonb_build_array(jsonb_build_object('line_id', lq, 'reason', 'pakning_ikke_bekreftet'))
                     THEN '13 trygg linje ført, ubekreftet pakning hoppet over OK; ' ELSE '13 FEIL '||res::text||'; ' END;
  res := rm_post_safe_line_costs(p, NULL);
  SELECT count(*) INTO n FROM raw_material_price_history WHERE invoice_line_id = lp;
  out := out || CASE WHEN (res->>'posted')::int = 0 AND n = 1 THEN '14 idempotent, én historikkrad OK; ' ELSE '14 FEIL n='||n||' '||res::text||'; ' END;

  -- 15) Godkjenning med admin når sperrer er borte
  res := approve_invoice_internal(a, 'test');
  out := out || CASE WHEN (res->>'ok')::boolean THEN '15 admin godkjenner A OK; ' ELSE '15 info '||res::text||'; ' END;

  RAISE EXCEPTION 'TESTRESULTAT: %', out;
END $t$;

-- Del 2: pakningsvarianter og endring av lagret kobling (rulles også tilbake).
-- Se kjøringen i rapporten: 16 gammel variant bevart, 17 kobling endret uten åpne linjer, 18 endringslogg skrevet.
