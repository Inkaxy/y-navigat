
CREATE OR REPLACE FUNCTION public._portal_create_customer_order_impl(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_customer       public.customers%ROWTYPE;
  v_distribution   text;
  v_delivery_date  date;
  v_delivery_time  time;
  v_delivery_tour_id uuid;
  v_tour           public.delivery_tours%ROWTYPE;
  v_lines          jsonb;
  v_line           jsonb;
  v_product        public.products%ROWTYPE;
  v_pli            public.price_list_items%ROWTYPE;
  v_qty            numeric;
  v_max_lead       integer := 0;
  v_min_delivery   date;
  v_order_id       uuid := gen_random_uuid();
  v_order_number   text;
  v_order_year     integer;
  v_order_seq      integer;
  v_subtotal       numeric := 0;
  v_total_vat      numeric := 0;
  v_total_incl     numeric := 0;
  v_line_no        integer := 0;
  v_line_subtotal  numeric;
  v_line_vat       numeric;
  v_line_total     numeric;
  v_unit_price     numeric;
  v_customer_snap  jsonb;
  v_product_snap   jsonb;
  v_iso_dow        smallint;
  v_tour_active    boolean;
  v_final_name     text;
  v_final_email    text;
  v_final_phone    text;
  v_send_sms       boolean;
  v_send_email     boolean;
  v_cake           record;
  v_external_id    text;
  v_existing_id    uuid;
  v_product_ids    uuid[] := ARRAY[]::uuid[];
  v_validation     jsonb;
  v_passes         boolean;
  v_initial_status text;
BEGIN
  SELECT c.* INTO v_customer
  FROM customer_portal_accounts cpa
  JOIN customers c ON c.id = cpa.customer_id
  WHERE cpa.user_id = auth.uid() AND cpa.is_active = true;

  IF v_customer.id IS NULL THEN RAISE EXCEPTION 'Ingen aktiv portal-konto'; END IF;
  IF v_customer.credit_hold THEN RAISE EXCEPTION 'Bestilling blokkert: kontakt regnskap'; END IF;
  IF v_customer.default_price_list_id IS NULL THEN RAISE EXCEPTION 'Kunden har ingen aktiv prisliste'; END IF;

  v_distribution     := COALESCE(p_payload->>'distribution', 'pickup');
  v_delivery_date    := (p_payload->>'delivery_date')::date;
  v_delivery_time    := NULLIF(p_payload->>'delivery_time','')::time;
  v_delivery_tour_id := NULLIF(p_payload->>'delivery_tour_id','')::uuid;
  v_lines            := p_payload->'lines';
  v_final_name       := NULLIF(TRIM(p_payload->>'final_customer_name'), '');
  v_final_email      := NULLIF(TRIM(p_payload->>'final_customer_email'), '');
  v_final_phone      := NULLIF(TRIM(p_payload->>'final_customer_phone'), '');
  v_send_sms         := COALESCE((p_payload->>'send_sms_confirm')::boolean, false);
  v_send_email       := COALESCE((p_payload->>'send_email_confirm')::boolean, false);
  v_external_id      := NULLIF(TRIM(p_payload->>'source_external_id'), '');

  IF v_final_name IS NULL THEN RAISE EXCEPTION 'Sluttkundenavn er påkrevd for kundeordre'; END IF;
  IF v_distribution NOT IN ('delivery','pickup') THEN RAISE EXCEPTION 'Ugyldig distribusjon: %', v_distribution; END IF;
  IF v_delivery_date IS NULL THEN RAISE EXCEPTION 'Leveringsdato mangler'; END IF;
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Ordre må ha minst én linje';
  END IF;
  IF v_send_sms AND v_final_phone IS NULL THEN RAISE EXCEPTION 'Telefon er påkrevd for SMS-bekreftelse'; END IF;
  IF v_send_email AND v_final_email IS NULL THEN RAISE EXCEPTION 'E-post er påkrevd for e-post-bekreftelse'; END IF;

  IF v_external_id IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM orders
     WHERE source = 'portal' AND source_external_id = v_external_id LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object('order_id', v_existing_id, 'duplicate', true,
        'message', 'Bestilling med denne referansen finnes allerede');
    END IF;
  END IF;

  IF v_delivery_tour_id IS NOT NULL THEN
    SELECT * INTO v_tour FROM delivery_tours
    WHERE id = v_delivery_tour_id AND legal_entity_id = v_customer.legal_entity_id AND status = 'active';
    IF v_tour.id IS NULL THEN RAISE EXCEPTION 'Ugyldig eller inaktiv tur'; END IF;
    v_iso_dow := EXTRACT(ISODOW FROM v_delivery_date)::smallint;
    v_tour_active := CASE v_iso_dow
      WHEN 1 THEN v_tour.active_monday  WHEN 2 THEN v_tour.active_tuesday
      WHEN 3 THEN v_tour.active_wednesday WHEN 4 THEN v_tour.active_thursday
      WHEN 5 THEN v_tour.active_friday   WHEN 6 THEN v_tour.active_saturday
      WHEN 7 THEN v_tour.active_sunday END;
    IF NOT v_tour_active THEN
      RAISE EXCEPTION 'Tur % går ikke på %', v_tour.tour_number, to_char(v_delivery_date, 'DD.MM.YYYY');
    END IF;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines)
  LOOP
    v_qty := (v_line->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Ugyldig kvantum på linje'; END IF;

    SELECT * INTO v_cake FROM _validate_and_resolve_cake_line(v_customer.legal_entity_id, v_line->'merknad');

    IF v_cake.is_cake THEN
      SELECT * INTO v_product FROM products WHERE id = v_cake.resolved_product_id;
      IF v_product.id IS NULL THEN RAISE EXCEPTION 'Kake-base-produkt finnes ikke'; END IF;
      IF v_product.status = 'discontinued' THEN RAISE EXCEPTION 'Kake-base-produkt er utgått'; END IF;
      IF COALESCE(v_product.lead_time_days, 0) > v_max_lead THEN v_max_lead := v_product.lead_time_days; END IF;
      v_product_ids := v_product_ids || v_product.id;
    ELSE
      SELECT * INTO v_product FROM products WHERE id = (v_line->>'product_id')::uuid;
      IF v_product.id IS NULL THEN RAISE EXCEPTION 'Produkt ikke funnet'; END IF;
      IF v_product.is_for_sale = false OR v_product.status = 'discontinued' THEN
        RAISE EXCEPTION 'Produkt ikke tilgjengelig: %', v_product.display_name;
      END IF;
      IF v_product.is_divisible = false AND v_qty <> floor(v_qty) THEN
        RAISE EXCEPTION 'Produkt % kan ikke deles', v_product.display_name;
      END IF;
      IF v_product.pause_delivery_from IS NOT NULL AND v_product.pause_delivery_to IS NOT NULL
         AND v_delivery_date BETWEEN v_product.pause_delivery_from AND v_product.pause_delivery_to THEN
        RAISE EXCEPTION 'Produkt % er pauset', v_product.display_name;
      END IF;
      SELECT * INTO v_pli FROM price_list_items
        WHERE price_list_id = v_customer.default_price_list_id AND product_id = v_product.id
          AND valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE);
      IF v_pli.id IS NULL THEN
        RAISE EXCEPTION 'Produkt % er ikke på din prisliste', v_product.display_name;
      END IF;
      IF COALESCE(v_product.lead_time_days, 0) > v_max_lead THEN v_max_lead := v_product.lead_time_days; END IF;
      v_product_ids := v_product_ids || v_product.id;
    END IF;
  END LOOP;

  v_min_delivery := CURRENT_DATE + v_max_lead;
  IF v_delivery_date < v_min_delivery THEN
    RAISE EXCEPTION 'For kort frist — tidligste leveringsdato er %', to_char(v_min_delivery, 'DD.MM.YYYY');
  END IF;

  v_validation := public.validate_order_delivery_rules(
    v_customer.legal_entity_id, v_customer.id, v_delivery_date,
    v_delivery_tour_id, v_product_ids, now());
  v_passes := COALESCE((v_validation->>'passes')::boolean, false);
  v_initial_status := CASE WHEN v_passes THEN 'confirmed' ELSE 'awaiting_confirmation' END;

  SELECT order_number, order_year, order_sequence
    INTO v_order_number, v_order_year, v_order_seq
    FROM next_order_number(v_customer.legal_entity_id);

  v_customer_snap := jsonb_build_object(
    'id', v_customer.id, 'customer_number', v_customer.customer_number,
    'display_name', v_customer.display_name, 'organization_number', v_customer.organization_number
  );

  INSERT INTO orders (
    id, legal_entity_id, order_number, order_year, order_sequence,
    source, source_external_id, customer_id, customer_snapshot, status,
    confirmed_at, confirmed_by, status_changed_at, status_changed_by,
    ordered_at, delivery_date, delivery_time, delivery_tour_id, distribution,
    use_customer_default_address, is_customer_order, is_return,
    final_customer_name, final_customer_email, final_customer_phone,
    send_sms_confirm, send_email_confirm, customer_notes,
    subtotal_excl_vat, total_discount, total_vat, total_incl_vat,
    created_by, created_at, updated_at
  ) VALUES (
    v_order_id, v_customer.legal_entity_id, v_order_number, v_order_year, v_order_seq,
    'portal', v_external_id, v_customer.id, v_customer_snap, v_initial_status,
    CASE WHEN v_passes THEN now() ELSE NULL END,
    CASE WHEN v_passes THEN auth.uid() ELSE NULL END,
    now(), auth.uid(),
    now(), v_delivery_date, v_delivery_time, v_delivery_tour_id, v_distribution,
    true, true, false,
    v_final_name, v_final_email, v_final_phone, v_send_sms, v_send_email,
    NULLIF(p_payload->>'customer_notes', ''),
    0, 0, 0, 0, auth.uid(), now(), now()
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines)
  LOOP
    v_line_no := v_line_no + 1;
    v_qty := (v_line->>'quantity')::numeric;

    SELECT * INTO v_cake FROM _validate_and_resolve_cake_line(v_customer.legal_entity_id, v_line->'merknad');

    IF v_cake.is_cake THEN
      SELECT * INTO v_product FROM products WHERE id = v_cake.resolved_product_id;
      v_unit_price := v_cake.resolved_unit_price;
      v_line_subtotal := round(v_qty * v_unit_price, 4);
      v_line_vat := round(v_line_subtotal * COALESCE(v_product.mva_rate, 0) / 100, 4);
      v_line_total := v_line_subtotal + v_line_vat;
      v_product_snap := jsonb_build_object(
        'id', v_product.id, 'display_number', v_product.display_number,
        'display_name', v_product.display_name, 'unit_of_sale', v_product.unit_of_sale,
        'mva_rate', v_product.mva_rate, 'pieces_per_unit', v_product.pieces_per_unit,
        'cake_category_id', v_cake.category_id, 'cake_category_name', v_cake.category_name
      );
      v_subtotal := v_subtotal + v_line_subtotal;
      v_total_vat := v_total_vat + v_line_vat;
      v_total_incl := v_total_incl + v_line_total;

      INSERT INTO order_lines (
        order_id, line_number, product_id, product_snapshot,
        quantity, sales_unit, unit_price, unit_price_source, unit_price_source_id,
        discount_percent, vat_rate,
        line_subtotal_excl_vat, line_vat, line_total_incl_vat, merknad, notes
      ) VALUES (
        v_order_id, v_line_no, v_product.id, v_product_snap,
        v_qty, v_product.unit_of_sale, v_unit_price, 'cake_builder', v_cake.category_id,
        0, COALESCE(v_product.mva_rate, 0),
        v_line_subtotal, v_line_vat, v_line_total,
        v_line->'merknad', NULLIF(v_line->>'notes','')
      );
    ELSE
      SELECT * INTO v_product FROM products WHERE id = (v_line->>'product_id')::uuid;
      SELECT * INTO v_pli FROM price_list_items
        WHERE price_list_id = v_customer.default_price_list_id AND product_id = v_product.id
          AND valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE);

      v_line_subtotal := round(v_qty * v_pli.price, 4);
      v_line_vat := round(v_line_subtotal * COALESCE(v_product.mva_rate, 0) / 100, 4);
      v_line_total := v_line_subtotal + v_line_vat;
      v_subtotal := v_subtotal + v_line_subtotal;
      v_total_vat := v_total_vat + v_line_vat;
      v_total_incl := v_total_incl + v_line_total;

      v_product_snap := jsonb_build_object(
        'id', v_product.id, 'display_number', v_product.display_number,
        'display_name', v_product.display_name, 'unit_of_sale', v_product.unit_of_sale,
        'mva_rate', v_product.mva_rate, 'pieces_per_unit', v_product.pieces_per_unit
      );

      INSERT INTO order_lines (
        order_id, line_number, product_id, product_snapshot,
        quantity, sales_unit, unit_price, unit_price_source, unit_price_source_id,
        discount_percent, vat_rate,
        line_subtotal_excl_vat, line_vat, line_total_incl_vat, merknad, notes
      ) VALUES (
        v_order_id, v_line_no, v_product.id, v_product_snap,
        v_qty, v_product.unit_of_sale, v_pli.price, 'price_list', v_pli.id,
        0, COALESCE(v_product.mva_rate, 0),
        v_line_subtotal, v_line_vat, v_line_total,
        CASE WHEN jsonb_typeof(v_line->'merknad') = 'object' THEN v_line->'merknad' ELSE NULL END,
        NULLIF(v_line->>'notes','')
      );
    END IF;
  END LOOP;

  UPDATE orders
     SET subtotal_excl_vat = v_subtotal, total_vat = v_total_vat,
         total_incl_vat = v_total_incl, updated_at = now()
   WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'order_id', v_order_id, 'order_number', v_order_number,
    'final_customer_name', v_final_name, 'total_incl_vat', v_total_incl,
    'status', v_initial_status, 'auto_confirmed', v_passes,
    'broken_rules', COALESCE(v_validation->'broken_rules', '[]'::jsonb)
  );
END;
$function$;
