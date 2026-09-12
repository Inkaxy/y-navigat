CREATE OR REPLACE FUNCTION public.save_production_plan_snapshot(
  p_attempt_id uuid,
  p_legal_entity_id uuid,
  p_production_date date,
  p_criteria jsonb,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_existing public.production_plan_snapshots%ROWTYPE;
  v_expected int;
  v_inserted int;
  v_tours int[];
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

  -- Idempotens: samme utskriftsforsøk skal aldri gi to grunnlag.
  SELECT * INTO v_existing
  FROM public.production_plan_snapshots
  WHERE id = p_attempt_id;

  IF FOUND THEN
    IF v_existing.legal_entity_id <> p_legal_entity_id
       OR v_existing.production_date <> p_production_date THEN
      RAISE EXCEPTION 'Forsøks-id er allerede brukt på et annet grunnlag' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'id', v_existing.id,
      'item_count', (SELECT count(*) FROM public.production_plan_snapshot_items WHERE snapshot_id = v_existing.id),
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
$$;

REVOKE EXECUTE ON FUNCTION public.save_production_plan_snapshot(uuid, uuid, date, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_production_plan_snapshot(uuid, uuid, date, jsonb, jsonb) TO authenticated;