
-- 1) Spor-kolonne + idempotens-indeks
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS recurring_schedule_id uuid
    REFERENCES public.recurring_order_schedules(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_recurring_unique
  ON public.orders (legal_entity_id, customer_id, delivery_date, recurring_schedule_id)
  WHERE recurring_schedule_id IS NOT NULL;

-- 2) Materialiser-funksjon
CREATE OR REPLACE FUNCTION public.materialize_recurring_orders(
  p_legal_entity_id uuid,
  p_delivery_date   date,
  p_tour_filter     uuid[] DEFAULT NULL,
  p_created_by      uuid   DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_iso_dow       smallint := EXTRACT(ISODOW FROM p_delivery_date)::smallint;
  v_dow_col       text;
  v_orders_made   int := 0;
  v_sched         record;
  v_item          record;
  v_tour_id       uuid;
  v_tour          public.delivery_tours%ROWTYPE;
  v_customer      public.customers%ROWTYPE;
  v_order_id      uuid;
  v_order_number  text;
  v_order_year    integer;
  v_order_seq     integer;
  v_line_no       integer;
  v_unit_price    numeric;
  v_vat_rate      numeric;
  v_price_src     text;
  v_price_src_id  uuid;
  v_line_subtotal numeric;
  v_line_vat      numeric;
  v_line_total    numeric;
  v_subtotal      numeric;
  v_total_vat     numeric;
  v_total_incl    numeric;
  v_product       public.products%ROWTYPE;
  v_customer_snap jsonb;
  v_product_snap  jsonb;
  v_price_row     record;
BEGIN
  v_dow_col := CASE v_iso_dow
    WHEN 1 THEN 'active_monday'   WHEN 2 THEN 'active_tuesday'
    WHEN 3 THEN 'active_wednesday' WHEN 4 THEN 'active_thursday'
    WHEN 5 THEN 'active_friday'   WHEN 6 THEN 'active_saturday'
    WHEN 7 THEN 'active_sunday'
  END;

  FOR v_sched IN
    SELECT s.id, s.customer_id
      FROM public.recurring_order_schedules s
     WHERE s.legal_entity_id = p_legal_entity_id
       AND s.is_active = true
       AND (s.valid_from IS NULL OR s.valid_from <= p_delivery_date)
       AND (s.valid_to   IS NULL OR s.valid_to   >= p_delivery_date)
       AND NOT EXISTS (
         SELECT 1 FROM public.delivery_pauses dp
          WHERE dp.customer_id = s.customer_id
            AND dp.legal_entity_id = s.legal_entity_id
            AND dp.pause_from <= p_delivery_date
            AND (dp.pause_to IS NULL OR dp.pause_to >= p_delivery_date)
       )
       AND EXISTS (
         SELECT 1 FROM public.recurring_order_items i
          WHERE i.schedule_id = s.id AND i.weekday = v_iso_dow AND i.quantity > 0
       )
  LOOP
    -- Idempotens
    IF EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.legal_entity_id = p_legal_entity_id
         AND o.customer_id = v_sched.customer_id
         AND o.delivery_date = p_delivery_date
         AND o.recurring_schedule_id = v_sched.id
    ) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_customer FROM public.customers WHERE id = v_sched.customer_id;
    IF v_customer.id IS NULL OR v_customer.default_price_list_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Bygg liste av items for denne ukedagen, med tur-fallback per item
    -- Vi grupperer items per (resolved tour_id) til separate ordre, fordi orders har én tur.
    -- Men typisk har en kunde kun én tur for ukedagen, så dette ender oftest som én ordre.

    -- Lag en midlertidig tabell pr iteration via CTE i loopen er tungvint;
    -- enklere: bygg dictionary i memory ved å hente alle items først.
    -- Vi kjører to-pass: først finn unike resolved tours, så lag en ordre per tur.

    DECLARE
      v_tour_set uuid[];
      v_tid uuid;
    BEGIN
      -- Samle unike resolved tours
      SELECT array_agg(DISTINCT resolved_tour) FILTER (WHERE resolved_tour IS NOT NULL)
        INTO v_tour_set
      FROM (
        SELECT
          COALESCE(
            i.tour_id,
            (
              SELECT dt.id
                FROM public.delivery_tours dt
               WHERE dt.legal_entity_id = p_legal_entity_id
                 AND dt.status = 'active'
                 AND (
                   (v_iso_dow = 1 AND dt.active_monday)    OR
                   (v_iso_dow = 2 AND dt.active_tuesday)   OR
                   (v_iso_dow = 3 AND dt.active_wednesday) OR
                   (v_iso_dow = 4 AND dt.active_thursday)  OR
                   (v_iso_dow = 5 AND dt.active_friday)    OR
                   (v_iso_dow = 6 AND dt.active_saturday)  OR
                   (v_iso_dow = 7 AND dt.active_sunday)
                 )
               ORDER BY dt.tour_number
               LIMIT 1
            )
          ) AS resolved_tour
          FROM public.recurring_order_items i
         WHERE i.schedule_id = v_sched.id
           AND i.weekday = v_iso_dow
           AND i.quantity > 0
      ) sub;

      IF v_tour_set IS NULL OR array_length(v_tour_set, 1) IS NULL THEN
        CONTINUE;
      END IF;

      FOREACH v_tid IN ARRAY v_tour_set LOOP
        -- Tur-filter
        IF p_tour_filter IS NOT NULL AND NOT (v_tid = ANY(p_tour_filter)) THEN
          CONTINUE;
        END IF;

        -- Idempotens-sjekk inkludert for re-run i samme dato (samme schedule->én ordre uansett antall turer)
        -- Vi tillater per design én ordre per (kunde, dato, schedule), så hvis flere turer, slå sammen.
        -- Derfor: hvis det er flere turer, ta første og legg ALLE linjer i den ene ordren.
        EXIT;
      END LOOP;

      -- Velg første tur fra settet (deterministisk)
      v_tour_id := v_tour_set[1];

      -- Tur-filter på den valgte turen
      IF p_tour_filter IS NOT NULL AND NOT (v_tour_id = ANY(p_tour_filter)) THEN
        CONTINUE;
      END IF;
    END;

    -- Bygg snapshot
    v_customer_snap := jsonb_build_object(
      'id', v_customer.id,
      'customer_number', v_customer.customer_number,
      'display_name', v_customer.display_name,
      'organization_number', v_customer.organization_number,
      'primary_contact_name', v_customer.primary_contact_name,
      'primary_contact_email', v_customer.primary_contact_email,
      'primary_contact_phone', v_customer.primary_contact_phone
    );

    -- Allocate order number (samme logikk som portal_create_order)
    v_order_id   := gen_random_uuid();
    v_order_year := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
    SELECT COALESCE(MAX(order_sequence), 0) + 1 INTO v_order_seq
      FROM public.orders
     WHERE legal_entity_id = p_legal_entity_id AND order_year = v_order_year;
    v_order_number := v_order_year::text || '-' || lpad(v_order_seq::text, 5, '0');

    INSERT INTO public.orders (
      id, legal_entity_id, order_number, order_year, order_sequence,
      source, source_reference, recurring_schedule_id,
      customer_id, customer_snapshot, status, ordered_at,
      delivery_date, delivery_tour_id,
      use_customer_default_address,
      delivery_address_line1, delivery_address_line2,
      delivery_postal_code, delivery_city, delivery_country, delivery_instructions,
      subtotal_excl_vat, total_discount, total_vat, total_incl_vat,
      created_by, created_at, updated_at
    ) VALUES (
      v_order_id, p_legal_entity_id, v_order_number, v_order_year, v_order_seq,
      'recurring', v_sched.id::text, v_sched.id,
      v_customer.id, v_customer_snap, 'confirmed', now(),
      p_delivery_date, v_tour_id,
      true,
      v_customer.delivery_address_line1, v_customer.delivery_address_line2,
      v_customer.delivery_postal_code, v_customer.delivery_city,
      COALESCE(v_customer.delivery_country, 'NO'), v_customer.delivery_instructions,
      0, 0, 0, 0,
      p_created_by, now(), now()
    );

    v_line_no := 0; v_subtotal := 0; v_total_vat := 0; v_total_incl := 0;

    FOR v_item IN
      SELECT i.*
        FROM public.recurring_order_items i
       WHERE i.schedule_id = v_sched.id
         AND i.weekday = v_iso_dow
         AND i.quantity > 0
       ORDER BY i.created_at, i.id
    LOOP
      SELECT * INTO v_product FROM public.products WHERE id = v_item.product_id;
      IF v_product.id IS NULL THEN CONTINUE; END IF;

      -- Pris via standard helper
      SELECT * INTO v_price_row
        FROM public.get_customer_unit_price(v_customer.id, v_product.id, p_delivery_date, 'recurring');

      IF v_price_row.unit_price_excl_mva IS NULL THEN
        -- Hopp over linjer uten pris (i stedet for å feile hele ordren)
        CONTINUE;
      END IF;

      v_unit_price   := v_price_row.unit_price_excl_mva;
      v_vat_rate     := COALESCE(v_price_row.vat_rate, COALESCE(v_product.mva_rate, 0));
      v_price_src    := COALESCE(v_price_row.source, 'price_list');
      v_price_src_id := COALESCE(v_price_row.special_price_id, v_price_row.price_list_id);

      v_line_subtotal := round(v_item.quantity * v_unit_price, 4);
      v_line_vat      := round(v_line_subtotal * v_vat_rate / 100, 4);
      v_line_total    := v_line_subtotal + v_line_vat;

      v_subtotal   := v_subtotal + v_line_subtotal;
      v_total_vat  := v_total_vat + v_line_vat;
      v_total_incl := v_total_incl + v_line_total;

      v_product_snap := jsonb_build_object(
        'id', v_product.id,
        'display_number', v_product.display_number,
        'display_name', v_product.display_name,
        'unit_of_sale', v_product.unit_of_sale,
        'mva_rate', v_product.mva_rate,
        'pieces_per_unit', v_product.pieces_per_unit
      );

      v_line_no := v_line_no + 1;
      INSERT INTO public.order_lines (
        order_id, line_number, product_id, product_snapshot,
        quantity, sales_unit, unit_price, unit_price_source, unit_price_source_id,
        discount_percent, vat_rate,
        line_subtotal_excl_vat, line_vat, line_total_incl_vat, notes
      ) VALUES (
        v_order_id, v_line_no, v_product.id, v_product_snap,
        v_item.quantity, v_product.unit_of_sale, v_unit_price, v_price_src, v_price_src_id,
        0, v_vat_rate,
        v_line_subtotal, v_line_vat, v_line_total, v_item.notes
      );
    END LOOP;

    IF v_line_no = 0 THEN
      -- Ingen gyldige linjer — slett ordren igjen
      DELETE FROM public.orders WHERE id = v_order_id;
      CONTINUE;
    END IF;

    UPDATE public.orders
       SET subtotal_excl_vat = v_subtotal,
           total_vat         = v_total_vat,
           total_incl_vat    = v_total_incl,
           updated_at        = now()
     WHERE id = v_order_id;

    v_orders_made := v_orders_made + 1;
  END LOOP;

  RETURN v_orders_made;
END;
$$;

-- 3) Oppdater generate_delivery_notes til å materialisere først (kun main)
CREATE OR REPLACE FUNCTION public.generate_delivery_notes(
  p_legal_entity_id uuid,
  p_delivery_date   date,
  p_tour_filter     uuid[] DEFAULT NULL,
  p_run_type        text   DEFAULT 'main'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id        uuid;
  v_user_id       uuid := auth.uid();
  v_notes_count   int  := 0;
  v_lines_count   int  := 0;
  v_orders_proc   int  := 0;
  v_orders_skip   int  := 0;
  v_cancelled_cnt int  := 0;
  v_recurring_cnt int  := 0;
  v_order         record;
  v_note_id       uuid;
  v_display_no    text;
  v_route_label   text;
  v_tour_number   smallint;
  v_tour_name     text;
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
    status, started_at, triggered_by,
    details
  )
  VALUES (
    p_legal_entity_id, p_delivery_date, p_run_type, p_tour_filter,
    'running', now(), v_user_id,
    jsonb_build_object('cancelled_count', v_cancelled_cnt, 'recurring_orders_created', v_recurring_cnt)
  )
  RETURNING id INTO v_run_id;

  FOR v_order IN
    SELECT o.*
    FROM public.orders o
    WHERE o.legal_entity_id = p_legal_entity_id
      AND o.delivery_date   = p_delivery_date
      AND o.status IN ('awaiting_confirmation','confirmed','in_production','packed')
      AND (p_tour_filter IS NULL OR o.delivery_tour_id = ANY(p_tour_filter))
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_pauses dp
        WHERE dp.customer_id = o.customer_id
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
    ORDER BY o.delivery_tour_id NULLS LAST, o.order_number
  LOOP
    v_orders_proc := v_orders_proc + 1;
    v_tour_number := NULL;
    v_tour_name   := NULL;
    IF v_order.delivery_tour_id IS NOT NULL THEN
      SELECT dt.tour_number, dt.display_name
        INTO v_tour_number, v_tour_name
        FROM public.delivery_tours dt
       WHERE dt.id = v_order.delivery_tour_id;
    END IF;

    v_route_label := CASE
      WHEN v_tour_number IS NOT NULL THEN
        'Rute ' || v_tour_number::text || COALESCE(' – ' || v_tour_name, '')
      ELSE 'Uten rute'
    END;

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
      v_order.customer_id,
      v_order.delivery_tour_id,
      p_delivery_date,
      v_display_no,
      'draft',
      v_order.customer_snapshot,
      jsonb_build_object(
        'line1', v_order.delivery_address_line1,
        'line2', v_order.delivery_address_line2,
        'postal_code', v_order.delivery_postal_code,
        'city', v_order.delivery_city,
        'country', v_order.delivery_country,
        'instructions', v_order.delivery_instructions
      ),
      v_order.subtotal_excl_vat, v_order.total_vat, v_order.total_incl_vat,
      v_route_label, v_run_id, v_user_id
    )
    RETURNING id INTO v_note_id;
    v_notes_count := v_notes_count + 1;

    INSERT INTO public.delivery_note_lines(
      delivery_note_id, order_id, line_number, product_id, product_snapshot,
      quantity, sales_unit, unit_price,
      line_subtotal_excl_vat, line_vat, line_total_incl_vat, notes
    )
    SELECT v_note_id, ol.order_id, ol.line_number, ol.product_id, ol.product_snapshot,
           ol.quantity, ol.sales_unit, ol.unit_price,
           ol.line_subtotal_excl_vat, ol.line_vat, ol.line_total_incl_vat, ol.notes
      FROM public.order_lines ol
     WHERE ol.order_id = v_order.id
     ORDER BY ol.line_number;

    GET DIAGNOSTICS v_lines_count = ROW_COUNT;
  END LOOP;

  UPDATE public.delivery_note_runs
     SET status = 'completed',
         completed_at = now(),
         notes_generated = v_notes_count,
         lines_generated = v_lines_count,
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
    'lines_generated', v_lines_count,
    'orders_processed', v_orders_proc,
    'orders_skipped', v_orders_skip,
    'notes_cancelled', v_cancelled_cnt,
    'recurring_orders_created', v_recurring_cnt
  );
END;
$function$;
