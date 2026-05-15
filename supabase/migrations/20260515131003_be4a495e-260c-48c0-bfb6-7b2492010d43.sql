CREATE OR REPLACE FUNCTION public.materialize_recurring_orders(
  p_legal_entity_id uuid,
  p_delivery_date   date,
  p_tour_filter     uuid[] DEFAULT NULL,
  p_created_by      uuid   DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_iso_dow       smallint := EXTRACT(ISODOW FROM p_delivery_date)::smallint;
  v_orders_made   int := 0;
  v_sched         record;
  v_item          record;
  v_tour_id       uuid;
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
    IF v_customer.id IS NULL THEN CONTINUE; END IF;

    -- Resolve tour
    DECLARE
      v_tour_set uuid[];
    BEGIN
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

      -- Tillat NULL tour (ordre uten tur)
      IF v_tour_set IS NULL OR array_length(v_tour_set, 1) IS NULL THEN
        v_tour_id := NULL;
      ELSE
        v_tour_id := v_tour_set[1];
        IF p_tour_filter IS NOT NULL AND NOT (v_tour_id = ANY(p_tour_filter)) THEN
          CONTINUE;
        END IF;
      END IF;
    END;

    v_customer_snap := jsonb_build_object(
      'id', v_customer.id,
      'customer_number', v_customer.customer_number,
      'display_name', v_customer.display_name,
      'organization_number', v_customer.organization_number,
      'primary_contact_name', v_customer.primary_contact_name,
      'primary_contact_email', v_customer.primary_contact_email,
      'primary_contact_phone', v_customer.primary_contact_phone
    );

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

      v_unit_price := NULL;
      v_vat_rate   := COALESCE(v_product.mva_rate, 0);
      v_price_src  := NULL;
      v_price_src_id := NULL;

      IF v_customer.default_price_list_id IS NOT NULL THEN
        SELECT * INTO v_price_row
          FROM public.get_customer_unit_price(v_customer.id, v_product.id, p_delivery_date, 'recurring');
        IF v_price_row.unit_price_excl_mva IS NOT NULL THEN
          v_unit_price   := v_price_row.unit_price_excl_mva;
          v_vat_rate     := COALESCE(v_price_row.vat_rate, v_vat_rate);
          v_price_src    := COALESCE(v_price_row.source, 'price_list');
          v_price_src_id := COALESCE(v_price_row.special_price_id, v_price_row.price_list_id);
        END IF;
      END IF;

      -- Hvis ingen pris funnet: bruk 0 (linja blir med på pakkseddel uansett)
      IF v_unit_price IS NULL THEN
        v_unit_price := 0;
        v_price_src  := COALESCE(v_price_src, 'no_price');
      END IF;

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
$function$;