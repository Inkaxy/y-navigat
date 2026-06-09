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
    RAISE NOTICE 'TEST 1 PASS tx=%', v_tx1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 1 FAIL: % / %', SQLSTATE, SQLERRM;
  END;

  -- TEST 2: mixed MVA 15+25
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"Rundstykke","mva_rate":15},"quantity":1,"unit_price_excl_mva":98.00,"line_discount":0,"mva_rate":15},{"product_snapshot":{"display_name":"Brus","mva_rate":25},"quantity":1,"unit_price_excl_mva":80.00,"line_discount":0,"mva_rate":25}]'::jsonb;
    v_pay := '{"payments":[{"method":"card","amount":212.70}],"total_paid":212.70,"rounding":0}'::jsonb;
    v_tx2 := public.pos_record_sale(v_session, v_lines, v_pay);
    RAISE NOTICE 'TEST 2 PASS tx=%', v_tx2;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 2 FAIL: % / %', SQLSTATE, SQLERRM;
  END;

  -- TEST 3: return UTEN reference (skal feile)
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"X","mva_rate":15},"quantity":-1,"unit_price_excl_mva":98.00,"mva_rate":15}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":-112.70}],"total_paid":-112.70,"rounding":0}'::jsonb;
    PERFORM public.pos_record_sale(v_session, v_lines, v_pay, 'return');
    RAISE NOTICE 'TEST 3 FAIL: forventet exception';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 3 PASS (forventet): %', SQLERRM;
  END;

  -- TEST 4: gyldig return referansert til tx1
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"Rundstykke","mva_rate":15},"quantity":-1,"unit_price_excl_mva":98.00,"mva_rate":15}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":-112.70}],"total_paid":-112.70,"rounding":0}'::jsonb;
    v_tx4 := public.pos_record_sale(v_session, v_lines, v_pay, 'return', 'takeaway', NULL, v_tx1);
    RAISE NOTICE 'TEST 4 PASS tx=%', v_tx4;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 4 FAIL: % / %', SQLSTATE, SQLERRM;
  END;

  -- TEST 5: payment mismatch (skal feile)
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"X","mva_rate":15},"quantity":1,"unit_price_excl_mva":98.00,"mva_rate":15}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":100.00}],"total_paid":100.00,"rounding":0}'::jsonb;
    PERFORM public.pos_record_sale(v_session, v_lines, v_pay);
    RAISE NOTICE 'TEST 5 FAIL: forventet exception';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 5 PASS (forventet): %', SQLERRM;
  END;

  -- TEST 6: correction referansert til tx1
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"Rundstykke","mva_rate":15},"quantity":1,"unit_price_excl_mva":98.00,"mva_rate":15}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":112.70}],"total_paid":112.70,"rounding":0}'::jsonb;
    v_tx6 := public.pos_record_sale(v_session, v_lines, v_pay, 'correction', 'takeaway', NULL, v_tx1);
    RAISE NOTICE 'TEST 6 PASS tx=%', v_tx6;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 6 FAIL: % / %', SQLSTATE, SQLERRM;
  END;

  -- TEST 7: training
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"Trening","mva_rate":15},"quantity":1,"unit_price_excl_mva":98.00,"mva_rate":15}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":112.70}],"total_paid":112.70,"rounding":0}'::jsonb;
    v_tx7 := public.pos_record_sale(v_session, v_lines, v_pay, 'training', 'takeaway', NULL, NULL, true);
    RAISE NOTICE 'TEST 7 PASS tx=%', v_tx7;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 7 FAIL: % / %', SQLSTATE, SQLERRM;
  END;

  -- TEST 8: invalid mva_rate 10 (skal feile)
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"X","mva_rate":10},"quantity":1,"unit_price_excl_mva":100,"mva_rate":10}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":110}],"total_paid":110,"rounding":0}'::jsonb;
    PERFORM public.pos_record_sale(v_session, v_lines, v_pay);
    RAISE NOTICE 'TEST 8 FAIL: forventet exception';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 8 PASS (forventet): %', SQLERRM;
  END;

  -- TEST 9: stengt sesjon (skal feile)
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"X","mva_rate":15},"quantity":1,"unit_price_excl_mva":98,"mva_rate":15}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":112.70}],"total_paid":112.70,"rounding":0}'::jsonb;
    PERFORM public.pos_record_sale(v_closed, v_lines, v_pay);
    RAISE NOTICE 'TEST 9 FAIL: forventet exception';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 9 PASS (forventet): %', SQLERRM;
  END;

  -- TEST 10: invalid dining_mode (skal feile)
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"X","mva_rate":15},"quantity":1,"unit_price_excl_mva":98,"mva_rate":15}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":112.70}],"total_paid":112.70,"rounding":0}'::jsonb;
    PERFORM public.pos_record_sale(v_session, v_lines, v_pay, 'sale', 'standing');
    RAISE NOTICE 'TEST 10 FAIL: forventet exception';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 10 PASS (forventet): %', SQLERRM;
  END;

  -- TEST 11: tom lines-array (skal feile)
  BEGIN
    PERFORM public.pos_record_sale(v_session, '[]'::jsonb, '{"payments":[],"total_paid":0,"rounding":0}'::jsonb);
    RAISE NOTICE 'TEST 11 FAIL: forventet exception';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 11 PASS (forventet): %', SQLERRM;
  END;

  RAISE NOTICE 'SEED-IDS: tx1=% tx2=% tx4=% tx6=% tx7=%', v_tx1, v_tx2, v_tx4, v_tx6, v_tx7;
END $$;