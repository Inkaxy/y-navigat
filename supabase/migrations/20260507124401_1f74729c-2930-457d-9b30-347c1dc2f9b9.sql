
DROP FUNCTION IF EXISTS public.save_matrix_changes(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.save_matrix_changes(p_customer_id uuid, p_changes jsonb)
RETURNS TABLE(
  orders_created integer,
  orders_deleted integer,
  lines_created integer,
  lines_updated integer,
  lines_deleted integer,
  has_zero_fallback_lines uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_legal_entity_id UUID;
  v_customer_snapshot JSONB;
  v_change JSONB;
  v_date DATE;
  v_tour_id UUID;
  v_product_id UUID;
  v_quantity NUMERIC;
  v_has_merknad_key BOOLEAN;
  v_merknad JSONB;
  v_order_id UUID;
  v_order_number TEXT;
  v_order_seq INT;
  v_order_year INT;
  v_price RECORD;
  v_unit_price NUMERIC;
  v_unit_price_source TEXT;
  v_unit_price_source_id UUID;
  v_is_fallback BOOLEAN;
  v_mva_rate NUMERIC;
  v_unit_of_sale TEXT;
  v_product_name TEXT;
  v_product_snapshot JSONB;
  v_line_subtotal NUMERIC;
  v_line_vat NUMERIC;
  v_line_total NUMERIC;
  v_existing_line_id UUID;
  v_existing_qty NUMERIC;
  v_existing_merknad JSONB;
  v_orders_created INT := 0;
  v_orders_deleted INT := 0;
  v_lines_created INT := 0;
  v_lines_updated INT := 0;
  v_lines_deleted INT := 0;
  v_max_line_no INT;
  v_affected_orders UUID[] := ARRAY[]::UUID[];
  v_zero_fallback_lines UUID[] := ARRAY[]::UUID[];
  v_oid UUID;
  v_num_row RECORD;
  v_new_line_id UUID;
BEGIN
  SELECT c.legal_entity_id, to_jsonb(c.*)
    INTO v_legal_entity_id, v_customer_snapshot
  FROM public.customers c WHERE c.id = p_customer_id;

  IF v_legal_entity_id IS NULL THEN
    RAISE EXCEPTION 'Kunde finnes ikke';
  END IF;

  FOR v_change IN SELECT * FROM jsonb_array_elements(p_changes)
  LOOP
    v_date := (v_change->>'date')::DATE;
    v_tour_id := (v_change->>'tour_id')::UUID;
    v_product_id := (v_change->>'product_id')::UUID;
    v_quantity := COALESCE((v_change->>'quantity')::NUMERIC, 0);

    v_has_merknad_key := (v_change ? 'merknad');
    IF v_has_merknad_key THEN
      IF jsonb_typeof(v_change->'merknad') = 'null' THEN
        v_merknad := NULL;
      ELSE
        v_merknad := v_change->'merknad';
      END IF;
    ELSE
      v_merknad := NULL;
    END IF;

    SELECT o.id INTO v_order_id
    FROM public.orders o
    WHERE o.customer_id = p_customer_id
      AND o.delivery_date = v_date
      AND o.delivery_tour_id = v_tour_id
      AND o.status NOT IN ('cancelled')
    LIMIT 1;

    IF v_order_id IS NULL AND (v_quantity > 0 OR (v_has_merknad_key AND v_merknad IS NOT NULL)) THEN
      SELECT * INTO v_num_row FROM public.next_order_number(v_legal_entity_id);
      v_order_number := v_num_row.order_number;
      v_order_year := v_num_row.order_year;
      v_order_seq := v_num_row.order_sequence;

      INSERT INTO public.orders (
        legal_entity_id, customer_id, customer_snapshot,
        order_number, order_sequence, order_year,
        delivery_date, delivery_tour_id,
        source, status, use_customer_default_address
      ) VALUES (
        v_legal_entity_id, p_customer_id, v_customer_snapshot,
        v_order_number, v_order_seq, v_order_year,
        v_date, v_tour_id,
        'matrix_entry', 'confirmed', true
      ) RETURNING id INTO v_order_id;
      v_orders_created := v_orders_created + 1;
    END IF;

    IF v_order_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT ol.id, ol.quantity, ol.merknad
      INTO v_existing_line_id, v_existing_qty, v_existing_merknad
    FROM public.order_lines ol
    WHERE ol.order_id = v_order_id AND ol.product_id = v_product_id
    LIMIT 1;

    IF v_quantity <= 0 AND NOT v_has_merknad_key THEN
      IF v_existing_line_id IS NOT NULL THEN
        DELETE FROM public.order_lines WHERE id = v_existing_line_id;
        v_lines_deleted := v_lines_deleted + 1;
        v_affected_orders := array_append(v_affected_orders, v_order_id);
      END IF;
      CONTINUE;
    END IF;

    IF v_quantity <= 0 AND v_has_merknad_key AND v_merknad IS NULL THEN
      IF v_existing_line_id IS NOT NULL THEN
        DELETE FROM public.order_lines WHERE id = v_existing_line_id;
        v_lines_deleted := v_lines_deleted + 1;
        v_affected_orders := array_append(v_affected_orders, v_order_id);
      END IF;
      CONTINUE;
    END IF;

    SELECT p.display_name, p.unit_of_sale
      INTO v_product_name, v_unit_of_sale
    FROM public.products p WHERE p.id = v_product_id;

    -- Sentralisert prisoppslag (special_prices → prislister → fallback_zero)
    SELECT * INTO v_price
    FROM public.get_customer_unit_price(p_customer_id, v_product_id, v_date, 'matrix_save');

    v_unit_price := COALESCE(v_price.unit_price_excl_mva, 0);
    v_mva_rate := COALESCE(v_price.vat_rate, 15);
    v_unit_price_source := COALESCE(v_price.source, 'fallback_zero');
    v_unit_price_source_id := COALESCE(v_price.special_price_id, v_price.price_list_id);
    v_is_fallback := COALESCE(v_price.is_fallback, true);

    v_product_snapshot := jsonb_build_object(
      'display_name', v_product_name,
      'unit_of_sale', v_unit_of_sale,
      'mva_rate', v_mva_rate
    );

    v_line_subtotal := ROUND(v_quantity * v_unit_price, 2);
    v_line_vat := ROUND(v_line_subtotal * v_mva_rate / 100.0, 2);
    v_line_total := v_line_subtotal + v_line_vat;

    IF v_existing_line_id IS NOT NULL THEN
      UPDATE public.order_lines SET
        quantity = v_quantity,
        unit_price = v_unit_price,
        unit_price_source = v_unit_price_source,
        unit_price_source_id = v_unit_price_source_id,
        sales_unit = v_unit_of_sale,
        product_snapshot = v_product_snapshot,
        vat_rate = v_mva_rate,
        line_subtotal_excl_vat = v_line_subtotal,
        line_vat = v_line_vat,
        line_total_incl_vat = v_line_total,
        merknad = CASE WHEN v_has_merknad_key THEN v_merknad ELSE merknad END
      WHERE id = v_existing_line_id;
      v_lines_updated := v_lines_updated + 1;
      IF v_is_fallback THEN
        v_zero_fallback_lines := array_append(v_zero_fallback_lines, v_existing_line_id);
      END IF;
    ELSE
      SELECT COALESCE(MAX(line_number), 0) INTO v_max_line_no
      FROM public.order_lines WHERE order_id = v_order_id;

      INSERT INTO public.order_lines (
        order_id, line_number, product_id, product_snapshot,
        quantity, sales_unit, unit_price, unit_price_source, unit_price_source_id,
        discount_percent, line_subtotal_excl_vat, vat_rate,
        line_vat, line_total_incl_vat, merknad
      ) VALUES (
        v_order_id, v_max_line_no + 1, v_product_id, v_product_snapshot,
        v_quantity, v_unit_of_sale, v_unit_price, v_unit_price_source, v_unit_price_source_id,
        0, v_line_subtotal, v_mva_rate,
        v_line_vat, v_line_total, CASE WHEN v_has_merknad_key THEN v_merknad ELSE NULL END
      ) RETURNING id INTO v_new_line_id;
      v_lines_created := v_lines_created + 1;
      IF v_is_fallback THEN
        v_zero_fallback_lines := array_append(v_zero_fallback_lines, v_new_line_id);
      END IF;
    END IF;
    v_affected_orders := array_append(v_affected_orders, v_order_id);
  END LOOP;

  FOREACH v_oid IN ARRAY v_affected_orders LOOP
    IF NOT EXISTS (SELECT 1 FROM public.order_lines WHERE order_id = v_oid) THEN
      DELETE FROM public.orders WHERE id = v_oid;
      v_orders_deleted := v_orders_deleted + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_orders_created, v_orders_deleted, v_lines_created, v_lines_updated, v_lines_deleted, v_zero_fallback_lines;
END;
$function$;
