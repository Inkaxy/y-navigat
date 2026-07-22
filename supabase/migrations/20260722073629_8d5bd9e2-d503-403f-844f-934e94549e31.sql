
-- 1) NEW COLUMNS ON ORDERS
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS rule_override_reason text,
  ADD COLUMN IF NOT EXISTS rule_flags jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2) HELPER: notify all users with write access to the 'ordre' app
CREATE OR REPLACE FUNCTION public._notify_ordre_team(
  p_legal_entity_id uuid,
  p_title text,
  p_body text,
  p_order_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, order_id)
  SELECT DISTINCT up.user_id, 'delivery_rule_block', p_title, p_body, p_order_id
    FROM public.position_app_access paa
    JOIN public.positions p       ON p.id  = paa.position_id
    JOIN public.user_positions up ON up.position_id = p.id
    JOIN public.apps a            ON a.id  = paa.app_id
   WHERE a.code = 'ordre'
     AND paa.level IN ('write','approve','admin')
     AND up.valid_from <= current_date
     AND (up.valid_to IS NULL OR up.valid_to >= current_date);
END;
$$;

-- 3) CORE ENFORCEMENT — called from triggers on orders and order_lines
CREATE OR REPLACE FUNCTION public._enforce_order_delivery_rules(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order              public.orders%ROWTYPE;
  v_customer_group_ids uuid[];
  v_product_ids        uuid[];
  v_product_group_ids  uuid[];
  v_today              date := (now() AT TIME ZONE 'Europe/Oslo')::date;
  v_res                record;
  v_blocks             jsonb := '[]'::jsonb;
  v_flags              jsonb := '[]'::jsonb;
  v_block_rule_ids     uuid[] := ARRAY[]::uuid[];
  v_msg                text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RETURN; END IF;

  -- Historical orders: no retroactive enforcement
  IF v_order.delivery_date IS NULL OR v_order.delivery_date < v_today THEN
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(group_id), ARRAY[]::uuid[])
    INTO v_customer_group_ids
    FROM public.customer_group_members
   WHERE customer_id = v_order.customer_id;

  SELECT
    COALESCE(array_agg(DISTINCT ol.product_id) FILTER (WHERE ol.product_id IS NOT NULL), ARRAY[]::uuid[]),
    COALESCE(array_agg(DISTINCT psg.sales_group_id) FILTER (WHERE psg.sales_group_id IS NOT NULL), ARRAY[]::uuid[])
    INTO v_product_ids, v_product_group_ids
    FROM public.order_lines ol
    LEFT JOIN public.product_sales_groups psg ON psg.product_id = ol.product_id
   WHERE ol.order_id = v_order.id;

  FOR v_res IN
    SELECT * FROM public.evaluate_delivery_rules(
      v_order.legal_entity_id,
      v_order.customer_id,
      v_customer_group_ids,
      v_order.delivery_date,
      v_order.delivery_tour_id,
      v_product_ids,
      v_product_group_ids,
      COALESCE(v_order.ordered_at, now()),
      v_order.id
    )
    WHERE matched
  LOOP
    IF v_res.effect = 'block' THEN
      v_blocks := v_blocks || jsonb_build_object(
        'rule_id', v_res.rule_id, 'name', v_res.rule_name,
        'type', v_res.rule_type, 'message', v_res.message
      );
      v_block_rule_ids := v_block_rule_ids || v_res.rule_id;
    ELSE
      v_flags := v_flags || jsonb_build_object(
        'rule_id', v_res.rule_id, 'name', v_res.rule_name,
        'type', v_res.rule_type, 'effect', v_res.effect, 'message', v_res.message
      );
    END IF;
  END LOOP;

  -- Persist non-blocking warn/info flags (skip if unchanged to avoid trigger noise)
  IF v_order.rule_flags IS DISTINCT FROM v_flags THEN
    UPDATE public.orders SET rule_flags = v_flags WHERE id = v_order.id;
  END IF;

  IF jsonb_array_length(v_blocks) = 0 THEN
    RETURN;
  END IF;

  SELECT string_agg('• ' || (b->>'name') || ': ' || (b->>'message'), E'\n')
    INTO v_msg
    FROM jsonb_array_elements(v_blocks) b;

  -- Blocked with no override reason -> hard stop
  IF v_order.rule_override_reason IS NULL OR btrim(v_order.rule_override_reason) = '' THEN
    RAISE EXCEPTION E'Leveringsregel blokkerer ordre %:\n%\n\nSett rule_override_reason for å overstyre (krever ordrekontor-tilgang i NBHub).',
      COALESCE(v_order.order_number, v_order.id::text), v_msg
      USING ERRCODE = 'check_violation';
  END IF;

  -- Reason present -> caller MUST have write access to the 'ordre' app.
  -- Service roles, portal users, imports and system jobs never have this.
  IF NOT public.has_app_write_access('ordre') THEN
    RAISE EXCEPTION 'Overstyring av leveringsregel krever ordrekontor-tilgang i NBHub'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Allowed override -> log to audit_log
  INSERT INTO public.audit_log (
    user_id, action, entity_type, entity_id, entity_display_reference,
    legal_entity_id, changes, reason, source_app
  ) VALUES (
    auth.uid(), 'delivery_rule_overridden', 'order', v_order.id, v_order.order_number,
    v_order.legal_entity_id,
    jsonb_build_object('blocked_rules', v_blocks, 'rule_ids', v_block_rule_ids),
    v_order.rule_override_reason, 'ordre'
  );
END;
$$;

-- 4) TRIGGERS

-- Orders: fire only when delivery_date, delivery_tour_id, customer or override reason changes
CREATE OR REPLACE FUNCTION public._trg_orders_enforce_delivery_rules()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.delivery_date        IS NOT DISTINCT FROM OLD.delivery_date
       AND NEW.delivery_tour_id IS NOT DISTINCT FROM OLD.delivery_tour_id
       AND NEW.customer_id      IS NOT DISTINCT FROM OLD.customer_id
       AND NEW.rule_override_reason IS NOT DISTINCT FROM OLD.rule_override_reason THEN
      RETURN NULL;
    END IF;
  END IF;
  PERFORM public._enforce_order_delivery_rules(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS orders_enforce_delivery_rules ON public.orders;
CREATE TRIGGER orders_enforce_delivery_rules
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public._trg_orders_enforce_delivery_rules();

-- Order lines: re-evaluate parent order when lines change
CREATE OR REPLACE FUNCTION public._trg_order_lines_enforce_delivery_rules()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_order_id uuid;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  IF v_order_id IS NOT NULL THEN
    PERFORM public._enforce_order_delivery_rules(v_order_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS order_lines_enforce_delivery_rules ON public.order_lines;
CREATE TRIGGER order_lines_enforce_delivery_rules
  AFTER INSERT OR UPDATE OR DELETE ON public.order_lines
  FOR EACH ROW EXECUTE FUNCTION public._trg_order_lines_enforce_delivery_rules();

-- 5) PATCH materialize_recurring_orders: catch block errors, hold order, notify team
CREATE OR REPLACE FUNCTION public.materialize_recurring_orders(
  p_legal_entity_id uuid,
  p_delivery_date date,
  p_tour_filter uuid[] DEFAULT NULL::uuid[],
  p_created_by uuid DEFAULT NULL::uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_block_msg     text;
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

    DECLARE v_tour_set uuid[];
    BEGIN
      SELECT array_agg(DISTINCT resolved_tour) FILTER (WHERE resolved_tour IS NOT NULL)
        INTO v_tour_set
      FROM (
        SELECT COALESCE(
          i.tour_id,
          (SELECT dt.id FROM public.delivery_tours dt
            WHERE dt.legal_entity_id = p_legal_entity_id AND dt.status = 'active'
              AND ((v_iso_dow=1 AND dt.active_monday) OR (v_iso_dow=2 AND dt.active_tuesday)
                OR (v_iso_dow=3 AND dt.active_wednesday) OR (v_iso_dow=4 AND dt.active_thursday)
                OR (v_iso_dow=5 AND dt.active_friday) OR (v_iso_dow=6 AND dt.active_saturday)
                OR (v_iso_dow=7 AND dt.active_sunday))
            ORDER BY dt.tour_number LIMIT 1)
        ) AS resolved_tour
        FROM public.recurring_order_items i
        WHERE i.schedule_id = v_sched.id AND i.weekday = v_iso_dow AND i.quantity > 0
      ) sub;
      IF v_tour_set IS NULL OR array_length(v_tour_set,1) IS NULL THEN
        v_tour_id := NULL;
      ELSE
        v_tour_id := v_tour_set[1];
        IF p_tour_filter IS NOT NULL AND NOT (v_tour_id = ANY(p_tour_filter)) THEN CONTINUE; END IF;
      END IF;
    END;

    v_customer_snap := jsonb_build_object(
      'id', v_customer.id, 'customer_number', v_customer.customer_number,
      'display_name', v_customer.display_name, 'organization_number', v_customer.organization_number,
      'primary_contact_name', v_customer.primary_contact_name,
      'primary_contact_email', v_customer.primary_contact_email,
      'primary_contact_phone', v_customer.primary_contact_phone
    );

    v_order_id   := gen_random_uuid();
    v_order_year := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
    SELECT COALESCE(MAX(order_sequence),0)+1 INTO v_order_seq
      FROM public.orders
     WHERE legal_entity_id = p_legal_entity_id AND order_year = v_order_year;
    v_order_number := v_order_year::text || '-' || lpad(v_order_seq::text,5,'0');

    -- Wrap the entire order creation in a subtxn so a block-rule exception
    -- rolls back the partial order but not the outer loop.
    BEGIN
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
        'subscription', v_sched.id::text, v_sched.id,
        v_customer.id, v_customer_snap, 'confirmed', now(),
        p_delivery_date, v_tour_id,
        true,
        v_customer.delivery_address_line1, v_customer.delivery_address_line2,
        v_customer.delivery_postal_code, v_customer.delivery_city,
        COALESCE(v_customer.delivery_country,'NO'), v_customer.delivery_instructions,
        0,0,0,0, p_created_by, now(), now()
      );

      v_line_no := 0; v_subtotal := 0; v_total_vat := 0; v_total_incl := 0;

      FOR v_item IN
        SELECT i.* FROM public.recurring_order_items i
         WHERE i.schedule_id = v_sched.id AND i.weekday = v_iso_dow AND i.quantity > 0
         ORDER BY i.created_at, i.id
      LOOP
        SELECT * INTO v_product FROM public.products WHERE id = v_item.product_id;
        IF v_product.id IS NULL THEN CONTINUE; END IF;

        v_unit_price := NULL;
        v_vat_rate   := COALESCE(v_product.mva_rate,0);
        v_price_src  := NULL; v_price_src_id := NULL;

        IF v_customer.default_price_list_id IS NOT NULL THEN
          SELECT * INTO v_price_row FROM public.get_customer_unit_price(
            v_customer.id, v_product.id, p_delivery_date, 'recurring');
          IF v_price_row.unit_price_excl_mva IS NOT NULL THEN
            v_unit_price   := v_price_row.unit_price_excl_mva;
            v_vat_rate     := COALESCE(v_price_row.vat_rate, v_vat_rate);
            v_price_src    := COALESCE(v_price_row.source,'price_list');
            v_price_src_id := COALESCE(v_price_row.special_price_id, v_price_row.price_list_id);
          END IF;
        END IF;

        IF v_unit_price IS NULL THEN
          v_unit_price := 0;
          v_price_src  := COALESCE(v_price_src,'no_price');
        END IF;

        v_line_subtotal := round(v_item.quantity * v_unit_price, 4);
        v_line_vat      := round(v_line_subtotal * v_vat_rate / 100, 4);
        v_line_total    := v_line_subtotal + v_line_vat;

        v_subtotal   := v_subtotal + v_line_subtotal;
        v_total_vat  := v_total_vat + v_line_vat;
        v_total_incl := v_total_incl + v_line_total;

        v_product_snap := jsonb_build_object(
          'id', v_product.id, 'display_number', v_product.display_number,
          'display_name', v_product.display_name, 'unit_of_sale', v_product.unit_of_sale,
          'mva_rate', v_product.mva_rate, 'pieces_per_unit', v_product.pieces_per_unit
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
         SET subtotal_excl_vat = v_subtotal, total_vat = v_total_vat,
             total_incl_vat = v_total_incl, updated_at = now()
       WHERE id = v_order_id;

      v_orders_made := v_orders_made + 1;
    EXCEPTION WHEN check_violation THEN
      v_block_msg := SQLERRM;
      PERFORM public._notify_ordre_team(
        p_legal_entity_id,
        'Fastordre blokkert av leveringsregel',
        format('Kunde %s (%s), levering %s: %s',
          v_customer.display_name, v_customer.customer_number,
          to_char(p_delivery_date,'DD.MM.YYYY'), v_block_msg),
        NULL
      );
      -- do not create the order; move on to next schedule
    END;
  END LOOP;

  RETURN v_orders_made;
END;
$function$;
