CREATE TABLE IF NOT EXISTS public._pos_smoke_debug (id serial primary key, ts timestamptz default now(), note text);
GRANT ALL ON public._pos_smoke_debug TO service_role;
GRANT ALL ON SEQUENCE public._pos_smoke_debug_id_seq TO service_role;
DO $$
DECLARE v_uid uuid; v_tx uuid; v_lines jsonb; v_pay jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"f663bf4a-183b-4fa3-b502-f066b164676c"}', true);
  v_uid := auth.uid();
  INSERT INTO public._pos_smoke_debug(note) VALUES ('auth.uid()=' || COALESCE(v_uid::text,'NULL'));
  BEGIN
    v_lines := '[{"product_snapshot":{"display_name":"Rundstykke","mva_rate":15},"quantity":1,"unit_price_excl_mva":98.00,"line_discount":0,"mva_rate":15}]'::jsonb;
    v_pay := '{"payments":[{"method":"cash","amount":112.70}],"total_paid":112.70,"rounding":0}'::jsonb;
    v_tx := public.pos_record_sale('44444444-0000-0000-0000-000000000001', v_lines, v_pay);
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST1 PASS tx=' || v_tx::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._pos_smoke_debug(note) VALUES ('TEST1 FAIL ' || SQLSTATE || ' ' || SQLERRM);
  END;
END $$;