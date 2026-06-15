CREATE OR REPLACE FUNCTION public.build_cake_order_line(p_category_id uuid, p_price_list_id uuid, p_selections jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_category RECORD;
  v_base_product RECORD;
  v_main_product RECORD;
  v_selected_option_ids UUID[];
  v_price JSONB;
  v_total_ex NUMERIC;
  v_total_inc NUMERIC;
  v_order_line JSONB;
  v_accessory_lines JSONB := '[]'::jsonb;
  v_label_payload JSONB;
  v_components JSONB := '[]'::jsonb;
  v_label_fields JSONB := '{}'::jsonb;
  v_notes TEXT;
  rec RECORD;
BEGIN
  SELECT cc.id, cc.name, cc.base_product_id, cc.legal_entity_id, cc.status
    INTO v_category
  FROM public.cake_categories cc
  WHERE cc.id = p_category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kakekategorien finnes ikke.' USING ERRCODE = '02000';
  END IF;

  IF v_category.base_product_id IS NULL THEN
    RAISE EXCEPTION 'Kakekategorien mangler basis-produkt — kan ikke bygge ordrelinje.' USING ERRCODE = '23502';
  END IF;

  SELECT p.id, p.display_number, p.code, p.display_name, p.mva_rate,
         p.label_mode, p.label_print_model, p.cake_role
    INTO v_base_product
  FROM public.products p
  WHERE p.id = v_category.base_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Basis-produktet finnes ikke i produktkatalogen.' USING ERRCODE = '02000';
  END IF;

  SELECT COALESCE(array_agg(opt_id), ARRAY[]::uuid[])
    INTO v_selected_option_ids
  FROM (
    SELECT (oid)::uuid AS opt_id
    FROM jsonb_array_elements(COALESCE(p_selections, '[]'::jsonb)) sel,
         jsonb_array_elements_text(COALESCE(sel->'option_ids', '[]'::jsonb)) oid
  ) s;

  v_price := public.calculate_cake_price(p_category_id, p_price_list_id, v_selected_option_ids);
  v_total_ex := COALESCE((v_price->>'total_ex_mva')::numeric, 0);
  v_total_inc := COALESCE((v_price->>'total_inc_mva')::numeric, 0);

  -- Velg "hoved"-produktet: første valgte byggekloss med cake_role='base'.
  SELECT p.id, p.display_number, p.display_name, p.mva_rate,
         p.label_mode, p.label_print_model, p.cake_role
    INTO v_main_product
  FROM jsonb_array_elements(COALESCE(p_selections, '[]'::jsonb)) sel,
       jsonb_array_elements_text(COALESCE(sel->'option_ids', '[]'::jsonb)) oid_text
  JOIN public.cake_step_products csp ON csp.id = oid_text::uuid
  JOIN public.cake_steps cs ON cs.id = csp.cake_step_id AND cs.cake_category_id = p_category_id
  JOIN public.products p ON p.id = csp.product_id
  WHERE p.cake_role = 'base'
  ORDER BY cs.step_order, csp.sort_order
  LIMIT 1;

  -- Fallback: hvis ingen base-valg, bruk kategoriens basis-produkt.
  IF v_main_product.id IS NULL THEN
    v_main_product := v_base_product;
  END IF;

  FOR rec IN
    SELECT
      csp.product_id,
      p.display_number,
      COALESCE(csp.display_name_override, p.display_name) AS display_name,
      p.mva_rate,
      p.cake_role,
      COALESCE(pli.price, csp.custom_extra_price, 0) AS unit_price
    FROM jsonb_array_elements(COALESCE(p_selections, '[]'::jsonb)) sel,
         jsonb_array_elements_text(COALESCE(sel->'option_ids', '[]'::jsonb)) oid_text
    JOIN public.cake_step_products csp ON csp.id = oid_text::uuid
    JOIN public.cake_steps cs ON cs.id = csp.cake_step_id AND cs.cake_category_id = p_category_id
    LEFT JOIN public.products p ON p.id = csp.product_id
    LEFT JOIN public.price_list_items pli
      ON pli.product_id = csp.product_id AND pli.price_list_id = p_price_list_id
    WHERE csp.product_id IS NOT NULL
      AND COALESCE(p.cake_role, 'topping') <> 'base'
  LOOP
    v_accessory_lines := v_accessory_lines || jsonb_build_object(
      'product_id',           rec.product_id,
      'display_number',       rec.display_number,
      'display_name',         rec.display_name,
      'quantity',             1,
      'unit_price_excl_vat',  COALESCE(rec.unit_price, 0),
      'vat_rate',             COALESCE(rec.mva_rate, 15),
      'parent_role',          COALESCE(rec.cake_role, 'topping')
    );
  END LOOP;

  FOR rec IN
    SELECT
      COALESCE(p.cake_role, 'addon') AS role,
      COALESCE(csp.display_name_override, csp.custom_name, p.display_name, 'Uten navn') AS display_name,
      p.display_number
    FROM jsonb_array_elements(COALESCE(p_selections, '[]'::jsonb)) sel,
         jsonb_array_elements_text(COALESCE(sel->'option_ids', '[]'::jsonb)) oid_text
    JOIN public.cake_step_products csp ON csp.id = oid_text::uuid
    JOIN public.cake_steps cs ON cs.id = csp.cake_step_id AND cs.cake_category_id = p_category_id
    LEFT JOIN public.products p ON p.id = csp.product_id
    ORDER BY cs.step_order, csp.sort_order
  LOOP
    v_components := v_components || jsonb_build_object(
      'role',           rec.role,
      'display_name',   rec.display_name,
      'display_number', rec.display_number
    );
  END LOOP;

  FOR rec IN
    SELECT cs.id AS step_id, cs.label_field_key, cs.selection_type,
           sel->>'text' AS text_val, sel->>'number' AS number_val
    FROM jsonb_array_elements(COALESCE(p_selections, '[]'::jsonb)) sel
    JOIN public.cake_steps cs ON cs.id = (sel->>'step_id')::uuid
    WHERE cs.cake_category_id = p_category_id
      AND cs.label_field_key IS NOT NULL
  LOOP
    v_label_fields := v_label_fields || jsonb_build_object(
      rec.label_field_key,
      COALESCE(NULLIF(TRIM(rec.text_val), ''), NULLIF(rec.number_val, ''))
    );
  END LOOP;

  v_label_payload := jsonb_build_object(
    'product_id',        v_main_product.id,
    'display_number',    v_main_product.display_number,
    'display_name',      v_main_product.display_name,
    'label_mode',        COALESCE(v_main_product.label_mode, v_base_product.label_mode),
    'label_print_model', COALESCE(v_main_product.label_print_model, v_base_product.label_print_model),
    'customer_name',     v_label_fields->>'customer_name',
    'pickup_location',   v_label_fields->>'pickup_location',
    'pickup_date',       v_label_fields->>'pickup_date',
    'pickup_tour',       v_label_fields->>'pickup_tour',
    'pickup_time',       v_label_fields->>'pickup_time',
    'cake_text',         v_label_fields->>'cake_text',
    'recipient',         v_label_fields->>'recipient',
    'note',              v_label_fields->>'note',
    'components',        v_components,
    'total_incl_vat',    v_total_inc
  );

  v_notes := v_main_product.display_name || ' (#' || v_main_product.display_number || ')';

  v_order_line := jsonb_build_object(
    'product_id',          v_main_product.id,
    'display_number',      v_main_product.display_number,
    'display_name',        v_main_product.display_name,
    'quantity',            1,
    'unit_price_excl_vat', v_total_ex,
    'vat_rate',            COALESCE(v_main_product.mva_rate, v_base_product.mva_rate, 15),
    'notes',               v_notes
  );

  RETURN jsonb_build_object(
    'order_line',       v_order_line,
    'accessory_lines',  v_accessory_lines,
    'label_payload',    v_label_payload,
    'price_breakdown',  v_price
  );
END;
$function$;