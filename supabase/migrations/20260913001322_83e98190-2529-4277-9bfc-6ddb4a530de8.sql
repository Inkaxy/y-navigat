-- NBHUB repo-rekonsiliering (konsolidering, IKKE ny historikk).
--
-- Bakgrunn: de to sikkerhetsrettingene under ble anvendt direkte mot databasen
-- 2026-09-12 som versjonene 20260912204709 (close_delivered_orders) og
-- 20260912210449 (save_production_plan_snapshot). Speilene ligger som
-- revisjonsbevis i supabase/applied-sql/ og skal ikke endres.
--
-- Problemet denne migrasjonen løser: en replay av supabase/migrations/ i et
-- NYTT miljø ville ikke gjenskape rettingene, fordi de originale versjonene
-- aldri ble skrevet inn i migrasjonsmappen. Derfor bærer denne ene migrasjonen
-- begge gjeldende definisjoner.
--
-- Hver CREATE OR REPLACE er BETINGET: pg_get_functiondef for dagens funksjon
-- sammenlignes med den forventede definisjonen, og EXECUTE kjøres kun ved
-- forskjell (eller når funksjonen mangler). På dagens database er begge
-- sammenligninger like, så migrasjonen er en no-op.
--
-- Signatur, eier, ACL, SECURITY DEFINER/INVOKER, search_path, cron/service-
-- oppførsel og RLS er uendret. Ingen forretningsdata røres, ingen nye tabeller
-- opprettes og ingen rettigheter utvides.

DO $mig_close$
DECLARE
  v_expected text := $expected_close$CREATE OR REPLACE FUNCTION public.close_delivered_orders(p_until date DEFAULT (CURRENT_DATE - 1))
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- Innlogget bruker må ha skrivetilgang på ordre. Kall uten JWT-kontekst
  -- (cron/service) slipper gjennom, men de kan uansett ikke nås fra PostgREST lenger.
  IF auth.uid() IS NOT NULL AND public.has_app_write_access('ordre') IS NOT TRUE THEN
    RAISE EXCEPTION 'Mangler skrivetilgang på ordre' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NULL AND auth.role() IS NOT NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Ikke autorisert' USING ERRCODE = '42501';
  END IF;

  WITH lukkbare AS (
    SELECT o.id
    FROM public.orders o
    WHERE o.delivery_date <= p_until
      AND (auth.uid() IS NULL OR public.has_position_in_entity(o.legal_entity_id))
      AND COALESCE(o.is_return, false) = false
      AND o.status IN ('confirmed','in_production','packed')
      AND EXISTS (
        SELECT 1 FROM public.delivery_note_lines dnl
        JOIN public.delivery_notes dn ON dn.id = dnl.delivery_note_id
        WHERE dnl.order_id = o.id AND dn.status <> 'cancelled'
      )
  )
  UPDATE public.orders o
     SET status = 'delivered', status_changed_at = now(), updated_at = now()
    FROM lukkbare l
   WHERE o.id = l.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$
$expected_close$;
  v_current text;
BEGIN
  v_current := pg_get_functiondef(to_regprocedure('public.close_delivered_orders(date)'));
  IF v_current IS DISTINCT FROM v_expected THEN
    EXECUTE v_expected;
    RAISE NOTICE 'close_delivered_orders(date) rekonsilert';
  ELSE
    RAISE NOTICE 'close_delivered_orders(date) allerede i forventet tilstand (no-op)';
  END IF;
END
$mig_close$;

DO $mig_snap$
DECLARE
  v_expected text := $expected_snap$CREATE OR REPLACE FUNCTION public.save_production_plan_snapshot(p_attempt_id uuid, p_legal_entity_id uuid, p_production_date date, p_criteria jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing public.production_plan_snapshots%ROWTYPE;
  v_expected int;
  v_inserted int;
  v_existing_count int;
  v_tours int[];
  v_incoming_items jsonb;
  v_existing_items jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Ikke innlogget' USING ERRCODE = '42501';
  END IF;
  IF p_attempt_id IS NULL OR p_legal_entity_id IS NULL OR p_production_date IS NULL THEN
    RAISE EXCEPTION 'Mangler forsøks-id, selskap eller dato' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_position_in_entity(p_legal_entity_id) THEN
    RAISE EXCEPTION 'Ingen stilling i selskapet' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_app_write_access('produksjon') OR public.has_app_write_access('varer')) THEN
    RAISE EXCEPTION 'Mangler skrivetilgang i Produksjon' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Varelinjene må være en liste' USING ERRCODE = '22023';
  END IF;

  -- Serialiser forsøk uten SELECT FOR UPDATE: tabellen er append-only og
  -- har bevisst ingen UPDATE-policy for authenticated.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_attempt_id::text, 0));

  -- Idempotens: samme utskriftsforsøk skal aldri gi to grunnlag, og samme
  -- forsøks-id kan ikke gjenbrukes på et ANNET innhold.
  SELECT * INTO v_existing
  FROM public.production_plan_snapshots
  WHERE id = p_attempt_id;

  IF FOUND THEN
    IF v_existing.legal_entity_id <> p_legal_entity_id
       OR v_existing.production_date <> p_production_date THEN
      RAISE EXCEPTION 'Forsøks-id er allerede brukt på et annet grunnlag' USING ERRCODE = '23505';
    END IF;

    IF COALESCE(v_existing.criteria_copy, '{}'::jsonb) IS DISTINCT FROM COALESCE(p_criteria, '{}'::jsonb) THEN
      RAISE EXCEPTION 'Forsøks-id er allerede brukt med andre kriterier' USING ERRCODE = '23505';
    END IF;

    SELECT COALESCE(jsonb_agg(t ORDER BY t::text), '[]'::jsonb) INTO v_incoming_items
    FROM (
      SELECT jsonb_build_object(
        'row_key', COALESCE(x.row_key, ''),
        'product_id', x.product_id,
        'quantity_ordered', COALESCE(x.quantity_ordered, 0)::numeric,
        'quantity_from_stock', COALESCE(x.quantity_from_stock, 0)::numeric,
        'quantity_to_produce', COALESCE(x.quantity_to_produce, 0)::numeric,
        'trays_full', COALESCE(x.trays_full, 0),
        'trays_partial', COALESCE(x.trays_partial, 0)
      ) AS t
      FROM jsonb_to_recordset(p_items) AS x(
        row_key text,
        product_id uuid,
        quantity_ordered numeric,
        quantity_from_stock numeric,
        quantity_to_produce numeric,
        trays_full int,
        trays_partial int
      )
    ) s;

    SELECT COALESCE(jsonb_agg(t ORDER BY t::text), '[]'::jsonb) INTO v_existing_items
    FROM (
      SELECT jsonb_build_object(
        'row_key', COALESCE(i.row_key, ''),
        'product_id', i.product_id,
        'quantity_ordered', COALESCE(i.quantity_ordered, 0)::numeric,
        'quantity_from_stock', COALESCE(i.quantity_from_stock, 0)::numeric,
        'quantity_to_produce', COALESCE(i.quantity_to_produce, 0)::numeric,
        'trays_full', COALESCE(i.trays_full, 0),
        'trays_partial', COALESCE(i.trays_partial, 0)
      ) AS t
      FROM public.production_plan_snapshot_items i
      WHERE i.snapshot_id = v_existing.id
    ) s;

    IF v_existing_items IS DISTINCT FROM v_incoming_items THEN
      RAISE EXCEPTION 'Forsøks-id er allerede brukt med andre varelinjer' USING ERRCODE = '23505';
    END IF;

    SELECT count(*) INTO v_existing_count
    FROM public.production_plan_snapshot_items
    WHERE snapshot_id = v_existing.id;

    RETURN jsonb_build_object(
      'id', v_existing.id,
      'item_count', v_existing_count,
      'already_saved', true
    );
  END IF;

  SELECT COALESCE(array_agg((t)::int ORDER BY (t)::int), '{}'::int[])
  INTO v_tours
  FROM jsonb_array_elements_text(COALESCE(p_criteria -> 'tour_numbers', '[]'::jsonb)) AS t;

  INSERT INTO public.production_plan_snapshots
    (id, legal_entity_id, production_date, tours, criteria_copy, list_type, created_by)
  VALUES
    (p_attempt_id, p_legal_entity_id, p_production_date, v_tours,
     COALESCE(p_criteria, '{}'::jsonb), 'produksjonsliste', auth.uid());

  v_expected := jsonb_array_length(p_items);

  IF v_expected > 0 THEN
    INSERT INTO public.production_plan_snapshot_items
      (snapshot_id, row_key, product_id, quantity_ordered, quantity_from_stock,
       quantity_to_produce, trays_full, trays_partial)
    SELECT
      p_attempt_id,
      COALESCE(x.row_key, ''),
      x.product_id,
      COALESCE(x.quantity_ordered, 0),
      COALESCE(x.quantity_from_stock, 0),
      COALESCE(x.quantity_to_produce, 0),
      COALESCE(x.trays_full, 0),
      COALESCE(x.trays_partial, 0)
    FROM jsonb_to_recordset(p_items) AS x(
      row_key text,
      product_id uuid,
      quantity_ordered numeric,
      quantity_from_stock numeric,
      quantity_to_produce numeric,
      trays_full int,
      trays_partial int
    );
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted <> v_expected THEN
      RAISE EXCEPTION 'Lagret % av % varelinjer', v_inserted, v_expected USING ERRCODE = '23514';
    END IF;
  ELSE
    v_inserted := 0;
  END IF;

  RETURN jsonb_build_object('id', p_attempt_id, 'item_count', v_inserted, 'already_saved', false);
END;
$function$
$expected_snap$;
  v_current text;
BEGIN
  v_current := pg_get_functiondef(to_regprocedure('public.save_production_plan_snapshot(uuid,uuid,date,jsonb,jsonb)'));
  IF v_current IS DISTINCT FROM v_expected THEN
    EXECUTE v_expected;
    RAISE NOTICE 'save_production_plan_snapshot(...) rekonsilert';
  ELSE
    RAISE NOTICE 'save_production_plan_snapshot(...) allerede i forventet tilstand (no-op)';
  END IF;
END
$mig_snap$;