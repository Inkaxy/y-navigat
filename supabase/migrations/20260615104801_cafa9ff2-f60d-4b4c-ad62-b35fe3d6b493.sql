CREATE OR REPLACE FUNCTION public.pos_create_cake_order(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_legal_entity_id uuid := (p_payload->>'legal_entity_id')::uuid;
  v_pickup_location_id uuid := NULLIF(p_payload->>'pickup_location_id','')::uuid;
  v_pickup_date date := (p_payload->>'pickup_date')::date;
  v_customer_name text := COALESCE(NULLIF(trim(p_payload->>'customer_name'),''),'POS-kunde');
  v_customer_phone text := NULLIF(trim(p_payload->>'customer_phone'),'');
  v_customer_email text := NULLIF(trim(p_payload->>'customer_email'),'');
  v_payment_mode text := COALESCE(p_payload->>'payment_mode','later');
  v_cake_result jsonb := p_payload->'cake_result';
  v_category_id uuid;
  v_price_list_id uuid;
  v_rebuilt_result jsonb;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_order_year int;
  v_order_seq int;
  v_num_row record;
  v_main_line jsonb;
  v_acc_lines jsonb;
  v_label_payload jsonb;
  v_total_excl numeric := 0;
  v_total_vat numeric := 0;
  v_total_incl numeric := 0;
  v_line record;
  v_idx int := 0;
  v_qty numeric;
  v_price numeric;
  v_vat_rate numeric;
  v_line_excl numeric;
  v_line_vat numeric;
  v_line_incl numeric;
  v_product_id uuid;
  v_main_order_line_id uuid;
  v_label_product_id uuid;
BEGIN
  IF v_legal_entity_id IS NULL OR v_pickup_date IS NULL OR v_cake_result IS NULL THEN
    RAISE EXCEPTION 'Mangler påkrevde felter: legal_entity_id, pickup_date, cake_result';
  END IF;

  v_category_id := NULLIF(v_cake_result->>'category_id','')::uuid;
  v_price_list_id := NULLIF(COALESCE(v_cake_result->>'price_list_id', p_payload->>'price_list_id'),'')::uuid;

  IF v_category_id IS NULL OR v_price_list_id IS NULL THEN
    RAISE EXCEPTION 'Mangler kakekategori eller prisliste i kakebygger-resultatet.';
  END IF;

  -- Serveren bestemmer alltid endelig ordrelinje på nytt fra valgene.
  -- Dette hindrer at et gammelt iframe-/klientresultat sender kategoriens basisvare (628)
  -- når kunden faktisk har valgt en størrelse med eget varenummer (f.eks. 1791/1792).
  v_rebuilt_result := public.build_cake_order_line(
    v_category_id,
    v_price_list_id,
    COALESCE(v_cake_result->'selections', '[]'::jsonb)
  );

  v_cake_result := v_cake_result || jsonb_build_object(
    'order_line', v_rebuilt_result->'order_line',
    'accessory_lines', COALESCE(v_rebuilt_result->'accessory_lines', '[]'::jsonb),
    'label_payload', v_rebuilt_result->'label_payload',
    'price_breakdown', v_rebuilt_result->'price_breakdown',
    'total_ex_mva', COALESCE((v_rebuilt_result->'price_breakdown'->>'total_ex_mva')::numeric, (v_cake_result->>'total_ex_mva')::numeric, 0),
    'total_inc_mva', COALESCE((v_rebuilt_result->'price_breakdown'->>'total_inc_mva')::numeric, (v_cake_result->>'total_inc_mva')::numeric, 0)
  );

  v_main_line := v_cake_result->'order_line';
  v_acc_lines := COALESCE(v_cake_result->'accessory_lines','[]'::jsonb);
  v_label_payload := v_cake_result->'label_payload';

  IF v_main_line IS NULL OR v_main_line = 'null'::jsonb THEN
    RAISE EXCEPTION 'Mangler påkrevd felt: cake_result.order_line';
  END IF;

  -- Find or create customer (match on mobile_phone within entity)
  IF v_customer_phone IS NOT NULL THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE legal_entity_id = v_legal_entity_id
      AND (mobile_phone = v_customer_phone OR primary_contact_phone = v_customer_phone)
    LIMIT 1;
  END IF;

  IF v_customer_id IS NULL THEN
    -- Allocate customer number
    INSERT INTO public.number_sequences (legal_entity_id, domain, next_number)
    VALUES (v_legal_entity_id, 'customer', 20001)
    ON CONFLICT (legal_entity_id, domain) DO NOTHING;

    UPDATE public.number_sequences
    SET next_number = next_number + 1
    WHERE legal_entity_id = v_legal_entity_id AND domain = 'customer'
    RETURNING (next_number - 1) INTO v_order_seq;

    INSERT INTO public.customers (
      legal_entity_id, customer_number, display_name,
      mobile_phone, primary_contact_phone, primary_contact_email,
      is_private_person, customer_category, status, customer_type
    ) VALUES (
      v_legal_entity_id, v_order_seq::text, v_customer_name,
      v_customer_phone, v_customer_phone, v_customer_email,
      true, 'private', 'active', 'private'
    ) RETURNING id INTO v_customer_id;
  END IF;

  -- Allocate order number
  SELECT * INTO v_num_row FROM public.next_order_number(v_legal_entity_id);
  v_order_number := v_num_row.order_number;
  v_order_year := v_num_row.order_year;
  v_order_seq := v_num_row.order_sequence;

  -- Compute totals from main + accessory lines
  v_qty := COALESCE((v_main_line->>'quantity')::numeric, 1);
  v_price := COALESCE((v_main_line->>'unit_price_excl_vat')::numeric, 0);
  v_vat_rate := COALESCE((v_main_line->>'vat_rate')::numeric, 15);
  v_line_excl := v_qty * v_price;
  v_line_vat := v_line_excl * v_vat_rate / 100;
  v_line_incl := v_line_excl + v_line_vat;
  v_total_excl := v_line_excl;
  v_total_vat := v_line_vat;
  v_total_incl := v_line_incl;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_acc_lines) AS j(elem) LOOP
    v_qty := COALESCE((v_line.elem->>'quantity')::numeric, 1);
    v_price := COALESCE((v_line.elem->>'unit_price_excl_vat')::numeric, 0);
    v_vat_rate := COALESCE((v_line.elem->>'vat_rate')::numeric, 15);
    v_line_excl := v_qty * v_price;
    v_total_excl := v_total_excl + v_line_excl;
    v_total_vat := v_total_vat + v_line_excl * v_vat_rate / 100;
  END LOOP;
  v_total_incl := v_total_excl + v_total_vat;

  -- Insert order
  INSERT INTO public.orders (
    legal_entity_id, customer_id,
    customer_snapshot,
    order_number, order_sequence, order_year,
    delivery_date, distribution,
    pickup_location_id,
    final_customer_name, final_customer_phone, final_customer_email,
    source, status,
    is_customer_order, is_paid,
    payment_mode, cake_payload,
    subtotal_excl_vat, total_vat, total_incl_vat, total_discount,
    use_customer_default_address
  ) VALUES (
    v_legal_entity_id, v_customer_id,
    jsonb_build_object('display_name', v_customer_name, 'mobile_phone', v_customer_phone, 'primary_contact_email', v_customer_email),
    v_order_number, v_order_seq, v_order_year,
    v_pickup_date, 'pickup',
    v_pickup_location_id,
    v_customer_name, v_customer_phone, v_customer_email,
    'pos_kakebygger', 'confirmed',
    true, (v_payment_mode = 'now'),
    v_payment_mode, v_cake_result,
    v_total_excl, v_total_vat, v_total_incl, 0,
    false
  ) RETURNING id INTO v_order_id;

  -- Insert main order line
  v_idx := 1;
  v_qty := COALESCE((v_main_line->>'quantity')::numeric, 1);
  v_price := COALESCE((v_main_line->>'unit_price_excl_vat')::numeric, 0);
  v_vat_rate := COALESCE((v_main_line->>'vat_rate')::numeric, 15);
  v_line_excl := v_qty * v_price;
  v_line_vat := v_line_excl * v_vat_rate / 100;
  v_line_incl := v_line_excl + v_line_vat;
  v_product_id := NULLIF(v_main_line->>'product_id','')::uuid;

  INSERT INTO public.order_lines (
    order_id, line_number, product_id, product_snapshot,
    quantity, sales_unit, unit_price, unit_price_source,
    discount_percent, line_subtotal_excl_vat, vat_rate, line_vat, line_total_incl_vat,
    notes, cake_config
  ) VALUES (
    v_order_id, v_idx, v_product_id,
    jsonb_build_object(
      'display_name', v_main_line->>'display_name',
      'display_number', v_main_line->>'display_number',
      'mva_rate', v_vat_rate
    ),
    v_qty, 'stk', v_price, 'cake_builder',
    0, v_line_excl, v_vat_rate, v_line_vat, v_line_incl,
    COALESCE(v_main_line->>'notes',''), v_cake_result
  ) RETURNING id INTO v_main_order_line_id;

  -- Accessory lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_acc_lines) WITH ORDINALITY AS t(elem, ord) LOOP
    v_idx := v_idx + 1;
    v_qty := COALESCE((v_line.elem->>'quantity')::numeric, 1);
    v_price := COALESCE((v_line.elem->>'unit_price_excl_vat')::numeric, 0);
    v_vat_rate := COALESCE((v_line.elem->>'vat_rate')::numeric, 15);
    v_line_excl := v_qty * v_price;
    v_line_vat := v_line_excl * v_vat_rate / 100;
    v_line_incl := v_line_excl + v_line_vat;
    v_product_id := NULLIF(v_line.elem->>'product_id','')::uuid;

    INSERT INTO public.order_lines (
      order_id, line_number, product_id, product_snapshot,
      quantity, sales_unit, unit_price, unit_price_source,
      discount_percent, line_subtotal_excl_vat, vat_rate, line_vat, line_total_incl_vat
    ) VALUES (
      v_order_id, v_idx, v_product_id,
      jsonb_build_object(
        'display_name', v_line.elem->>'display_name',
        'display_number', v_line.elem->>'display_number',
        'mva_rate', v_vat_rate,
        'parent_role', v_line.elem->>'parent_role'
      ),
      v_qty, 'stk', v_price, 'cake_builder',
      0, v_line_excl, v_vat_rate, v_line_vat, v_line_incl
    );
  END LOOP;

  -- Label print job (queued)
  v_label_product_id := NULLIF(v_label_payload->>'product_id','')::uuid;
  IF v_label_product_id IS NOT NULL THEN
    INSERT INTO public.label_print_jobs (
      product_id, order_line_id, legal_entity_id, quantity, status
    ) VALUES (
      v_label_product_id, v_main_order_line_id, v_legal_entity_id, 1, 'queued'
    );
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'customer_id', v_customer_id,
    'total_incl_vat', v_total_incl,
    'main_order_line_id', v_main_order_line_id,
    'cake_result', v_cake_result
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_create_cake_order(jsonb) TO authenticated, service_role;