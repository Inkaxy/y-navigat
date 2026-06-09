-- 1. Fix compute_pos_journal_hash: digest -> extensions.digest
CREATE OR REPLACE FUNCTION public.compute_pos_journal_hash()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  last_hash TEXT;
  input_string TEXT;
BEGIN
  SELECT event_hash INTO last_hash
  FROM public.pos_journal_events
  WHERE terminal_id = NEW.terminal_id
  ORDER BY id DESC
  LIMIT 1
  FOR UPDATE;

  NEW.prev_hash := COALESCE(last_hash, repeat('0', 64));

  input_string := NEW.prev_hash
    || COALESCE(NEW.terminal_id::text, '')
    || NEW.event_type
    || COALESCE(NEW.operator_id::text, '')
    || COALESCE(NEW.session_id::text, '')
    || COALESCE(NEW.transaction_id::text, '')
    || COALESCE(NEW.payload::text, '{}')
    || NEW.event_time::text;

  NEW.event_hash := encode(extensions.digest(input_string, 'sha256'), 'hex');
  RETURN NEW;
END;
$function$;

-- 2. Fix pos_verify_journal_chain: digest -> extensions.digest
CREATE OR REPLACE FUNCTION public.pos_verify_journal_chain(p_terminal_id uuid)
 RETURNS TABLE(is_valid boolean, broken_at_id bigint, total_events bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_rec RECORD;
  v_expected_prev TEXT := repeat('0', 64);
  v_recomputed TEXT;
  v_input TEXT;
  v_total BIGINT := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pos_terminals t
    WHERE t.id = p_terminal_id
      AND (public.has_position_in_entity(t.legal_entity_id) OR public.is_platform_admin())
  ) THEN
    RAISE EXCEPTION 'Not authorized for this terminal';
  END IF;

  FOR v_rec IN
    SELECT id, terminal_id, event_type, operator_id, session_id, transaction_id,
           payload, event_time, prev_hash, event_hash
    FROM public.pos_journal_events
    WHERE terminal_id = p_terminal_id
    ORDER BY id ASC
  LOOP
    v_total := v_total + 1;

    IF v_rec.prev_hash <> v_expected_prev THEN
      RETURN QUERY SELECT false, v_rec.id, v_total;
      RETURN;
    END IF;

    v_input := v_rec.prev_hash
      || COALESCE(v_rec.terminal_id::text, '')
      || v_rec.event_type
      || COALESCE(v_rec.operator_id::text, '')
      || COALESCE(v_rec.session_id::text, '')
      || COALESCE(v_rec.transaction_id::text, '')
      || COALESCE(v_rec.payload::text, '{}')
      || v_rec.event_time::text;

    v_recomputed := encode(extensions.digest(v_input, 'sha256'), 'hex');

    IF v_recomputed <> v_rec.event_hash THEN
      RETURN QUERY SELECT false, v_rec.id, v_total;
      RETURN;
    END IF;

    v_expected_prev := v_rec.event_hash;
  END LOOP;

  RETURN QUERY SELECT true, NULL::BIGINT, v_total;
END;
$function$;

-- 3. Clear debug table, run 11 smoke tests
TRUNCATE public._pos_smoke_debug;

DO $$
DECLARE
  v_tx1 uuid; v_tx2 uuid; v_tx4 uuid; v_tx6 uuid; v_tx7 uuid;
  v_lines jsonb; v_pay jsonb;
  v_session uuid := '44444444-0000-0000-0000-000000000001';
  v_closed  uuid := '44444444-0000-0000-0000-0000000000c0';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"f663bf4a-183b-4fa3-b502-f066b164676c"}', true);

  -- TEST 1: happy path single line 15% MVA
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"Rundstykke","display_number":"100","unit":"stk","mva_rate":15},"quantity":1,"unit_price_excl_mva":98.00,"line_discount":0,"mva_rate":15}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":112.70}],"total_paid":112.70,"rounding":0}'::jsonb;
    v_tx1 := public.pos_record_sale(v_session, v_lines, v_pay);
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 1 PASS tx=' || v_tx1::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 1 FAIL ' || SQLSTATE || ' ' || SQLERRM);
  END;

  -- TEST 2: mixed MVA 15+25
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"Rundstykke","mva_rate":15},"quantity":1,"unit_price_excl_mva":98.00,"line_discount":0,"mva_rate":15},{"product_snapshot":{"display_name":"Brus","mva_rate":25},"quantity":1,"unit_price_excl_mva":80.00,"line_discount":0,"mva_rate":25}]'::jsonb;
    v_pay := '{"payments":[{"method":"card","amount":212.70}],"total_paid":212.70,"rounding":0}'::jsonb;
    v_tx2 := public.pos_record_sale(v_session, v_lines, v_pay);
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 2 PASS tx=' || v_tx2::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 2 FAIL ' || SQLSTATE || ' ' || SQLERRM);
  END;

  -- TEST 3: return UTEN reference (forventet feil)
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"X","mva_rate":15},"quantity":-1,"unit_price_excl_mva":98.00,"mva_rate":15}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":-112.70}],"total_paid":-112.70,"rounding":0}'::jsonb;
    PERFORM public.pos_record_sale(v_session, v_lines, v_pay, 'return');
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 3 FAIL forventet exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 3 PASS (forventet): ' || SQLERRM);
  END;

  -- TEST 4: gyldig return referansert til tx1
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"Rundstykke","mva_rate":15},"quantity":-1,"unit_price_excl_mva":98.00,"mva_rate":15}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":-112.70}],"total_paid":-112.70,"rounding":0}'::jsonb;
    v_tx4 := public.pos_record_sale(v_session, v_lines, v_pay, 'return', 'takeaway', NULL, v_tx1);
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 4 PASS tx=' || v_tx4::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 4 FAIL ' || SQLSTATE || ' ' || SQLERRM);
  END;

  -- TEST 5: payment mismatch (forventet feil)
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"X","mva_rate":15},"quantity":1,"unit_price_excl_mva":98.00,"mva_rate":15}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":100.00}],"total_paid":100.00,"rounding":0}'::jsonb;
    PERFORM public.pos_record_sale(v_session, v_lines, v_pay);
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 5 FAIL forventet exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 5 PASS (forventet): ' || SQLERRM);
  END;

  -- TEST 6: correction referansert til tx1
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"Rundstykke","mva_rate":15},"quantity":1,"unit_price_excl_mva":98.00,"mva_rate":15}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":112.70}],"total_paid":112.70,"rounding":0}'::jsonb;
    v_tx6 := public.pos_record_sale(v_session, v_lines, v_pay, 'correction', 'takeaway', NULL, v_tx1);
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 6 PASS tx=' || v_tx6::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 6 FAIL ' || SQLSTATE || ' ' || SQLERRM);
  END;

  -- TEST 7: training
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"Trening","mva_rate":15},"quantity":1,"unit_price_excl_mva":98.00,"mva_rate":15}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":112.70}],"total_paid":112.70,"rounding":0}'::jsonb;
    v_tx7 := public.pos_record_sale(v_session, v_lines, v_pay, 'training', 'takeaway', NULL, NULL, true);
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 7 PASS tx=' || v_tx7::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 7 FAIL ' || SQLSTATE || ' ' || SQLERRM);
  END;

  -- TEST 8: invalid mva_rate 10 (forventet feil)
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"X","mva_rate":10},"quantity":1,"unit_price_excl_mva":100,"mva_rate":10}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":110}],"total_paid":110,"rounding":0}'::jsonb;
    PERFORM public.pos_record_sale(v_session, v_lines, v_pay);
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 8 FAIL forventet exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 8 PASS (forventet): ' || SQLERRM);
  END;

  -- TEST 9: stengt sesjon (forventet feil)
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"X","mva_rate":15},"quantity":1,"unit_price_excl_mva":98,"mva_rate":15}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":112.70}],"total_paid":112.70,"rounding":0}'::jsonb;
    PERFORM public.pos_record_sale(v_closed, v_lines, v_pay);
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 9 FAIL forventet exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 9 PASS (forventet): ' || SQLERRM);
  END;

  -- TEST 10: invalid dining_mode (forventet feil)
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"X","mva_rate":15},"quantity":1,"unit_price_excl_mva":98,"mva_rate":15}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":112.70}],"total_paid":112.70,"rounding":0}'::jsonb;
    PERFORM public.pos_record_sale(v_session, v_lines, v_pay, 'sale', 'standing');
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 10 FAIL forventet exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 10 PASS (forventet): ' || SQLERRM);
  END;

  -- TEST 11: tom lines-array (forventet feil)
  BEGIN
    PERFORM public.pos_record_sale(v_session, '[]'::jsonb, '{"payments":[],"total_paid":0,"rounding":0}'::jsonb);
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 11 FAIL forventet exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST 11 PASS (forventet): ' || SQLERRM);
  END;

  INSERT INTO public._pos_smoke_debug(note) VALUES ('SEED-IDS tx1=' || v_tx1::text || ' tx2=' || v_tx2::text || ' tx4=' || COALESCE(v_tx4::text,'NULL') || ' tx6=' || COALESCE(v_tx6::text,'NULL') || ' tx7=' || COALESCE(v_tx7::text,'NULL'));
END $$;