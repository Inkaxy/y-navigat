-- =========================================================
-- 1) generate_delivery_notes: grupperer per (customer_id, delivery_tour_id)
-- =========================================================
CREATE OR REPLACE FUNCTION public.generate_delivery_notes(
  p_legal_entity_id uuid,
  p_delivery_date   date,
  p_tour_filter     uuid[] DEFAULT NULL,
  p_run_type        text   DEFAULT 'main'
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

  -- Materialiser fastordre kun ved hovedkjøring
  IF p_run_type = 'main' THEN
    v_recurring_cnt := public.materialize_recurring_orders(
      p_legal_entity_id, p_delivery_date, p_tour_filter, v_user_id
    );
  END IF;

  -- For correction: annuller eksisterende pakksedler for (date, tour_filter) først
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

  -- Loop per (customer_id, delivery_tour_id) — én pakkseddel per gruppe
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
    -- Hent representativ ordre for snapshots/adresse
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

    -- Summer på tvers av alle ordrene i gruppa
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
      route_label, generated_by_run_id, created_by
    )
    VALUES (
      p_legal_entity_id,
      v_grp.customer_id,
      v_grp.delivery_tour_id,
      p_delivery_date,
      v_display_no,
      'draft',
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
      v_route_label, v_run_id, v_user_id
    )
    RETURNING id INTO v_note_id;
    v_notes_count := v_notes_count + 1;

    -- Linjer fra ALLE ordre i gruppa, renumrert sammenhengende
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
    'recurring_orders_created', v_recurring_cnt
  );
END;
$function$;

-- =========================================================
-- 2) Auto-tilleggkjøring når ordre kommer etter hovedkjøring
-- =========================================================
CREATE OR REPLACE FUNCTION public.auto_additional_run_for_new_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_main_exists boolean;
  v_already_packed boolean;
  v_tour_filter uuid[];
  v_run_id uuid;
BEGIN
  -- Bare aktive ordre kvalifiserer
  IF NEW.status NOT IN ('awaiting_confirmation','confirmed','in_production','packed') THEN
    RETURN NEW;
  END IF;

  -- Krever fullført hovedkjøring for (entity, date)
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_note_runs r
     WHERE r.legal_entity_id = NEW.legal_entity_id
       AND r.delivery_date   = NEW.delivery_date
       AND r.run_type        = 'main'
       AND r.status          = 'completed'
  ) INTO v_main_exists;

  IF NOT v_main_exists THEN
    RETURN NEW;
  END IF;

  -- Ordren har allerede en aktiv pakkseddel-linje
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_note_lines dnl
    JOIN public.delivery_notes dn ON dn.id = dnl.delivery_note_id
    WHERE dnl.order_id = NEW.id AND dn.status <> 'cancelled'
  ) INTO v_already_packed;

  IF v_already_packed THEN
    RETURN NEW;
  END IF;

  -- Synkron tilleggkjøring for kun denne turen (eller alle hvis tur mangler)
  v_tour_filter := CASE
    WHEN NEW.delivery_tour_id IS NULL THEN NULL
    ELSE ARRAY[NEW.delivery_tour_id]
  END;

  -- Kjør additional. Bruker entity-kontekst; hvis auth.uid() er NULL (bakgrunns-kontekst)
  -- skipper vi siden generate_delivery_notes krever auth.uid().
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.generate_delivery_notes(
    NEW.legal_entity_id,
    NEW.delivery_date,
    v_tour_filter,
    'additional'
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Aldri blokker order-insert pga pakkseddel-genererings-feil
  RAISE WARNING 'auto_additional_run_for_new_order failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_orders_auto_pakkseddel_ins ON public.orders;
CREATE TRIGGER trg_orders_auto_pakkseddel_ins
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.auto_additional_run_for_new_order();

DROP TRIGGER IF EXISTS trg_orders_auto_pakkseddel_upd ON public.orders;
CREATE TRIGGER trg_orders_auto_pakkseddel_upd
AFTER UPDATE OF status, delivery_date, delivery_tour_id ON public.orders
FOR EACH ROW
WHEN (
  NEW.status IN ('awaiting_confirmation','confirmed','in_production','packed')
)
EXECUTE FUNCTION public.auto_additional_run_for_new_order();