-- 1. Schema additions to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pickup_location_id uuid REFERENCES public.pickup_locations(id),
  ADD COLUMN IF NOT EXISTS payment_mode text,
  ADD COLUMN IF NOT EXISTS cake_payload jsonb;

CREATE INDEX IF NOT EXISTS idx_orders_pickup_location_date
  ON public.orders (legal_entity_id, pickup_location_id, delivery_date)
  WHERE pickup_location_id IS NOT NULL;

-- 2. RPC: create cake pickup order from POS
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
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_order_year int;
  v_order_seq int;
  v_num_row record;
  v_main_line jsonb := v_cake_result->'order_line';
  v_acc_lines jsonb := COALESCE(v_cake_result->'accessory_lines','[]'::jsonb);
  v_label_payload jsonb := v_cake_result->'label_payload';
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
  IF v_legal_entity_id IS NULL OR v_pickup_date IS NULL OR v_cake_result IS NULL OR v_main_line IS NULL THEN
    RAISE EXCEPTION 'Mangler påkrevde felter: legal_entity_id, pickup_date, cake_result.order_line';
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
    'main_order_line_id', v_main_order_line_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_create_cake_order(jsonb) TO authenticated, service_role;

-- 3. RPC: list pickup orders for terminal+date
CREATE OR REPLACE FUNCTION public.pos_list_pickup_orders(
  p_legal_entity_id uuid,
  p_pickup_location_id uuid,
  p_date date
)
RETURNS TABLE(
  id uuid,
  order_number text,
  delivery_date date,
  final_customer_name text,
  final_customer_phone text,
  is_paid boolean,
  payment_mode text,
  status text,
  total_incl_vat numeric,
  picked_up_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT o.id, o.order_number, o.delivery_date,
         o.final_customer_name, o.final_customer_phone,
         o.is_paid, o.payment_mode, o.status, o.total_incl_vat, o.picked_up_at
  FROM public.orders o
  WHERE o.legal_entity_id = p_legal_entity_id
    AND o.distribution = 'pickup'
    AND (p_pickup_location_id IS NULL OR o.pickup_location_id = p_pickup_location_id)
    AND o.delivery_date <= p_date
    AND o.status NOT IN ('cancelled')
    AND o.picked_up_at IS NULL
  ORDER BY o.delivery_date ASC, o.order_number ASC;
$$;

GRANT EXECUTE ON FUNCTION public.pos_list_pickup_orders(uuid, uuid, date) TO authenticated, service_role;

-- 4. RPC: load pickup order lines (price=0 if already paid)
CREATE OR REPLACE FUNCTION public.pos_load_pickup_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_lines jsonb;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Henteordre ikke funnet';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'order_line_id', ol.id,
    'product_id', ol.product_id,
    'product_snapshot', ol.product_snapshot,
    'quantity', ol.quantity,
    'unit_price_excl_mva', CASE WHEN v_order.is_paid THEN 0 ELSE ol.unit_price END,
    'mva_rate', ol.vat_rate,
    'original_unit_price', ol.unit_price
  ) ORDER BY ol.line_number), '[]'::jsonb)
  INTO v_lines
  FROM public.order_lines ol
  WHERE ol.order_id = p_order_id;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'is_paid', v_order.is_paid,
    'payment_mode', v_order.payment_mode,
    'final_customer_name', v_order.final_customer_name,
    'final_customer_phone', v_order.final_customer_phone,
    'delivery_date', v_order.delivery_date,
    'total_incl_vat', v_order.total_incl_vat,
    'lines', v_lines
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_load_pickup_order(uuid) TO authenticated, service_role;

-- 5. RPC: complete pickup order (after POS sale)
CREATE OR REPLACE FUNCTION public.pos_complete_pickup_order(
  p_order_id uuid,
  p_pos_transaction_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.orders
  SET picked_up_at = now(),
      is_paid = true,
      status = CASE WHEN status IN ('confirmed','in_production','ready') THEN 'delivered' ELSE status END,
      source_reference = COALESCE(source_reference, 'pos_tx:' || p_pos_transaction_id::text)
  WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_complete_pickup_order(uuid, uuid) TO authenticated, service_role;