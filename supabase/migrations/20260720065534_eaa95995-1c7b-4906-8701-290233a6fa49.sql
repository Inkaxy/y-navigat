
-- 1) Oppdater generate_delivery_notes: sett status='finalized' og finalized_at ved opprettelse
CREATE OR REPLACE FUNCTION public.generate_delivery_notes(
  p_legal_entity_id uuid,
  p_delivery_date date,
  p_tour_filter uuid[] DEFAULT NULL::uuid[],
  p_run_type text DEFAULT 'main'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id        uuid;
  v_user_id       uuid := auth.uid();
  v_notes_count   int  := 0;
  v_lines_total   int  := 0;
  v_orders_proc   int  := 0;
  v_orders_skip   int  := 0;
  v_cancelled_cnt int  := 0;
  v_recurring_cnt int  := 0;
  v_grp           record;
  v_first_order   record;
  v_note_id       uuid;
  v_display_no    text;
  v_route_label   text;
  v_tour_number   smallint;
  v_tour_name     text;
  v_lines_added   int;
  v_subtotal      numeric;
  v_vat           numeric;
  v_total         numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (has_position_in_entity(p_legal_entity_id) AND has_app_write_access('ordre')) THEN
    RAISE EXCEPTION 'Insufficient privileges for legal_entity %', p_legal_entity_id;
  END IF;

  IF p_run_type NOT IN ('main','additional','correction') THEN
    RAISE EXCEPTION 'Invalid run_type: %', p_run_type;
  END IF;

  IF p_run_type = 'main' THEN
    v_recurring_cnt := public.materialize_recurring_orders(
      p_legal_entity_id, p_delivery_date, p_tour_filter, v_user_id
    );
  END IF;

  IF p_run_type = 'correction' THEN
    UPDATE public.delivery_notes dn
       SET status = 'cancelled',
           cancelled_at = now(),
           cancelled_by = v_user_id,
           cancelled_reason = 'replaced_by_correction',
           updated_at = now()
     WHERE dn.legal_entity_id = p_legal_entity_id
       AND dn.delivery_date   = p_delivery_date
       AND dn.status <> 'cancelled'
       AND (
         p_tour_filter IS NULL
         OR dn.delivery_tour_id = ANY(p_tour_filter)
         OR (dn.delivery_tour_id IS NULL AND p_tour_filter IS NULL)
       );
    GET DIAGNOSTICS v_cancelled_cnt = ROW_COUNT;
  END IF;

  INSERT INTO public.delivery_note_runs(
    legal_entity_id, delivery_date, run_type, tour_filter,
    status, started_at, triggered_by, details
  )
  VALUES (
    p_legal_entity_id, p_delivery_date, p_run_type, p_tour_filter,
    'running', now(), v_user_id,
    jsonb_build_object('cancelled_count', v_cancelled_cnt, 'recurring_orders_created', v_recurring_cnt)
  )
  RETURNING id INTO v_run_id;

  FOR v_grp IN
    SELECT
      o.customer_id,
      o.delivery_tour_id,
      array_agg(o.id ORDER BY o.order_number) AS order_ids
    FROM public.orders o
    WHERE o.legal_entity_id = p_legal_entity_id
      AND o.delivery_date   = p_delivery_date
      AND o.status IN ('awaiting_confirmation','confirmed','in_production','packed')
      AND (p_tour_filter IS NULL OR o.delivery_tour_id = ANY(p_tour_filter))
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_pauses dp
        WHERE dp.customer_id    = o.customer_id
          AND dp.legal_entity_id = o.legal_entity_id
          AND dp.pause_from <= p_delivery_date
          AND (dp.pause_to IS NULL OR dp.pause_to >= p_delivery_date)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.delivery_note_lines dnl
        JOIN public.delivery_notes dn ON dn.id = dnl.delivery_note_id
        WHERE dnl.order_id = o.id
          AND dn.status <> 'cancelled'
      )
    GROUP BY o.customer_id, o.delivery_tour_id
    ORDER BY o.delivery_tour_id NULLS LAST, o.customer_id
  LOOP
    SELECT * INTO v_first_order
      FROM public.orders
     WHERE id = v_grp.order_ids[1];

    v_orders_proc := v_orders_proc + array_length(v_grp.order_ids, 1);

    v_tour_number := NULL;
    v_tour_name   := NULL;
    IF v_grp.delivery_tour_id IS NOT NULL THEN
      SELECT dt.tour_number, dt.display_name
        INTO v_tour_number, v_tour_name
        FROM public.delivery_tours dt
       WHERE dt.id = v_grp.delivery_tour_id;
    END IF;

    v_route_label := CASE
      WHEN v_tour_number IS NOT NULL THEN
        'Rute ' || v_tour_number::text || COALESCE(' – ' || v_tour_name, '')
      ELSE 'Uten rute'
    END;

    SELECT
      COALESCE(SUM(o.subtotal_excl_vat), 0),
      COALESCE(SUM(o.total_vat), 0),
      COALESCE(SUM(o.total_incl_vat), 0)
    INTO v_subtotal, v_vat, v_total
    FROM public.orders o
    WHERE o.id = ANY(v_grp.order_ids);

    v_display_no := public.next_display_number(p_legal_entity_id, 'delivery_note');

    INSERT INTO public.delivery_notes(
      legal_entity_id, customer_id, delivery_tour_id, delivery_date,
      display_number, status,
      customer_snapshot, delivery_address_snapshot,
      subtotal_excl_vat, total_vat, total_incl_vat,
      route_label, generated_by_run_id, created_by,
      finalized_at, finalized_by
    )
    VALUES (
      p_legal_entity_id,
      v_grp.customer_id,
      v_grp.delivery_tour_id,
      p_delivery_date,
      v_display_no,
      'finalized',
      v_first_order.customer_snapshot,
      jsonb_build_object(
        'line1',        v_first_order.delivery_address_line1,
        'line2',        v_first_order.delivery_address_line2,
        'postal_code',  v_first_order.delivery_postal_code,
        'city',         v_first_order.delivery_city,
        'country',      v_first_order.delivery_country,
        'instructions', v_first_order.delivery_instructions
      ),
      v_subtotal, v_vat, v_total,
      v_route_label, v_run_id, v_user_id,
      now(), v_user_id
    )
    RETURNING id INTO v_note_id;
    v_notes_count := v_notes_count + 1;

    WITH src AS (
      SELECT
        ol.*,
        row_number() OVER (
          ORDER BY array_position(v_grp.order_ids, ol.order_id), ol.line_number
        ) AS new_line_no
      FROM public.order_lines ol
      WHERE ol.order_id = ANY(v_grp.order_ids)
    )
    INSERT INTO public.delivery_note_lines(
      delivery_note_id, order_id, order_line_id, line_number, product_id, product_snapshot,
      quantity, sales_unit, unit_price,
      line_subtotal_excl_vat, line_vat, line_total_incl_vat, notes, merknad
    )
    SELECT
      v_note_id, src.order_id, src.id, src.new_line_no, src.product_id, src.product_snapshot,
      src.quantity, src.sales_unit, src.unit_price,
      src.line_subtotal_excl_vat, src.line_vat, src.line_total_incl_vat, src.notes, src.merknad
    FROM src;

    GET DIAGNOSTICS v_lines_added = ROW_COUNT;
    v_lines_total := v_lines_total + v_lines_added;
  END LOOP;

  UPDATE public.delivery_note_runs
     SET status = 'completed',
         completed_at = now(),
         notes_generated = v_notes_count,
         lines_generated = v_lines_total,
         orders_processed = v_orders_proc,
         orders_skipped = v_orders_skip,
         details = details || jsonb_build_object('recurring_orders_created', v_recurring_cnt)
   WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'run_type', p_run_type,
    'tour_filter', p_tour_filter,
    'delivery_date', p_delivery_date,
    'notes_generated', v_notes_count,
    'lines_generated', v_lines_total,
    'orders_processed', v_orders_proc,
    'orders_skipped', v_orders_skip,
    'notes_cancelled', v_cancelled_cnt,
    'notes_finalized', v_notes_count,
    'recurring_orders_created', v_recurring_cnt
  );
END;
$function$;

-- 2) Ny funksjon: tilbakekjøring (av-finalisering)
CREATE OR REPLACE FUNCTION public.unfinalize_delivery_notes(
  p_ids uuid[],
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id     uuid := auth.uid();
  v_updated     int  := 0;
  v_blocked     int  := 0;
  v_legal_ids   uuid[];
  v_le          uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('updated', 0, 'blocked', 0);
  END IF;

  -- Sjekk tilgang per legal_entity som er berørt
  SELECT array_agg(DISTINCT legal_entity_id) INTO v_legal_ids
    FROM public.delivery_notes WHERE id = ANY(p_ids);

  FOREACH v_le IN ARRAY COALESCE(v_legal_ids, ARRAY[]::uuid[]) LOOP
    IF NOT (has_position_in_entity(v_le) AND has_app_write_access('ordre')) THEN
      RAISE EXCEPTION 'Insufficient privileges for legal_entity %', v_le;
    END IF;
  END LOOP;

  -- Tell blokkerte (kansellerte kan ikke tilbakekjøres)
  SELECT count(*) INTO v_blocked
    FROM public.delivery_notes
   WHERE id = ANY(p_ids)
     AND status = 'cancelled';

  UPDATE public.delivery_notes
     SET status = 'draft',
         finalized_at = NULL,
         finalized_by = NULL,
         notes = CASE
           WHEN p_reason IS NOT NULL AND length(p_reason) > 0
             THEN COALESCE(notes || E'\n', '') || '[Tilbakekjørt ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ']: ' || p_reason
           ELSE notes
         END,
         updated_at = now()
   WHERE id = ANY(p_ids)
     AND status = 'finalized';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('updated', v_updated, 'blocked', v_blocked);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.unfinalize_delivery_notes(uuid[], text) TO authenticated;
