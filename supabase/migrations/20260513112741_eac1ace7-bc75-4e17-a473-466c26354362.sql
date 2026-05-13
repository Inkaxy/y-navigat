CREATE OR REPLACE FUNCTION public.get_customer_matrix_data(p_customer_id uuid, p_date_from date, p_date_to date)
 RETURNS TABLE(section text, payload jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_legal_entity_id UUID;
  v_default_price_list_id UUID;
  v_price_date DATE;
BEGIN
  SELECT c.legal_entity_id, c.default_price_list_id
    INTO v_legal_entity_id, v_default_price_list_id
  FROM customers c WHERE c.id = p_customer_id;

  IF v_legal_entity_id IS NULL THEN
    RAISE EXCEPTION 'Customer not found: %', p_customer_id;
  END IF;

  IF v_default_price_list_id IS NULL THEN
    SELECT pl.id INTO v_default_price_list_id
    FROM price_lists pl
    WHERE pl.legal_entity_id = v_legal_entity_id
      AND pl.is_default = true
      AND pl.status = 'active'
    LIMIT 1;
  END IF;

  -- Bruk dagens dato hvis matrisen viser inneværende/tidligere uke,
  -- ellers ukens mandag. Slik plukkes nylig satte priser opp umiddelbart.
  v_price_date := GREATEST(p_date_from, CURRENT_DATE);

  RETURN QUERY
  SELECT 'customer'::TEXT, jsonb_build_object(
    'item', (
      SELECT to_jsonb(x) FROM (
        SELECT
          c.id, c.customer_number, c.display_name, c.allows_returns,
          c.delivery_address_line1, c.delivery_postal_code, c.delivery_city
        FROM customers c WHERE c.id = p_customer_id
      ) x
    )
  );

  RETURN QUERY
  SELECT 'products'::TEXT, jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'display_number', p.display_number,
          'code', p.code,
          'display_name', p.display_name,
          'sales_unit', p.unit_of_sale,
          'mva_rate', p.mva_rate,
          'unit_price', (SELECT ep.price FROM public.get_effective_price(p.id, p_customer_id, v_default_price_list_id, v_price_date) ep),
          'price_source', COALESCE((SELECT ep.source FROM public.get_effective_price(p.id, p_customer_id, v_default_price_list_id, v_price_date) ep), 'none')
        ) ORDER BY p.display_number
      )
      FROM products p
      WHERE p.legal_entity_id = v_legal_entity_id
        AND p.status <> 'discontinued'
        AND EXISTS (
          SELECT 1 FROM order_lines ol
          JOIN orders o ON o.id = ol.order_id
          WHERE ol.product_id = p.id
            AND o.customer_id = p_customer_id
            AND o.status <> 'cancelled'
        )
    ), '[]'::jsonb)
  );

  RETURN QUERY
  SELECT 'tours'::TEXT, jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', t.id, 'tour_number', t.tour_number, 'display_name', t.display_name,
          'time_from', t.time_from, 'time_to', t.time_to,
          'active_monday', t.active_monday, 'active_tuesday', t.active_tuesday,
          'active_wednesday', t.active_wednesday, 'active_thursday', t.active_thursday,
          'active_friday', t.active_friday, 'active_saturday', t.active_saturday,
          'active_sunday', t.active_sunday
        ) ORDER BY t.tour_number
      )
      FROM delivery_tours t
      WHERE t.legal_entity_id = v_legal_entity_id AND t.status = 'active'
    ), '[]'::jsonb)
  );

  RETURN QUERY
  SELECT 'existing_cells'::TEXT, jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'order_id', o.id,
          'order_number', o.order_number,
          'order_status', o.status,
          'delivery_date', o.delivery_date,
          'delivery_tour_id', o.delivery_tour_id,
          'line_id', ol.id,
          'product_id', ol.product_id,
          'quantity', ol.quantity,
          'unit_price', ol.unit_price,
          'line_total_incl_vat', ol.line_total_incl_vat,
          'merknad', ol.merknad
        )
      )
      FROM orders o
      JOIN order_lines ol ON ol.order_id = o.id
      WHERE o.customer_id = p_customer_id
        AND o.delivery_date >= p_date_from
        AND o.delivery_date <= p_date_to
        AND o.status <> 'cancelled'
    ), '[]'::jsonb)
  );
END;
$function$;