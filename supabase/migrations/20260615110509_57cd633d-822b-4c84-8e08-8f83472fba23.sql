-- 1) build_cake_order_line: legg til merknad i return-objektet
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
  v_merknad JSONB;
  v_fyll TEXT;
  v_pynt TEXT;
  v_has_sukkerbilde BOOLEAN := false;
  v_notes TEXT;
  v_has_base_step BOOLEAN;
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

  -- Velg hoved-produkt (prioritet base-steg → cake_role=base → kategoriens basis)
  SELECT p.id, p.display_number, p.display_name, p.mva_rate,
         p.label_mode, p.label_print_model, p.cake_role
    INTO v_main_product
  FROM jsonb_array_elements(COALESCE(p_selections, '[]'::jsonb)) sel,
       jsonb_array_elements_text(COALESCE(sel->'option_ids', '[]'::jsonb)) oid_text
  JOIN public.cake_step_products csp ON csp.id = oid_text::uuid
  JOIN public.cake_steps cs ON cs.id = csp.cake_step_id AND cs.cake_category_id = p_category_id
  JOIN public.products p ON p.id = csp.product_id
  WHERE cs.suggested_role = 'base'
  ORDER BY cs.step_order, csp.sort_order
  LIMIT 1;

  IF v_main_product.id IS NULL THEN
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
  END IF;

  IF v_main_product.id IS NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.cake_steps cs
      WHERE cs.cake_category_id = p_category_id
        AND cs.suggested_role = 'base'
        AND cs.required = true
    ) INTO v_has_base_step;

    IF v_has_base_step THEN
      RAISE EXCEPTION 'Du må velge en størrelse/basis-vare før bestillingen kan opprettes.'
        USING ERRCODE = '23502';
    END IF;

    v_main_product := v_base_product;
  END IF;

  -- Tilbehørslinjer
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
      AND csp.product_id <> v_main_product.id
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

  -- Komponentliste (også brukt til fyll/pynt aggregat)
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

    IF rec.role IN ('fyll','filling','fill') THEN
      v_fyll := CASE WHEN v_fyll IS NULL OR v_fyll = '' THEN rec.display_name
                     ELSE v_fyll || ', ' || rec.display_name END;
    ELSIF rec.role IN ('pynt','dekor','topping','decor') THEN
      v_pynt := CASE WHEN v_pynt IS NULL OR v_pynt = '' THEN rec.display_name
                     ELSE v_pynt || ', ' || rec.display_name END;
    ELSIF rec.role IN ('sukkerbilde','sugar_image') THEN
      v_has_sukkerbilde := true;
    END IF;
  END LOOP;

  -- Label-felter (fra cake_steps.label_field_key)
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

  -- Merknad: oppfyller etikett-feltene fyll/pynt/tekst/bestilt_av/telefon/tid/fritekst_1/sukkerbilde
  v_merknad := jsonb_build_object(
    'bestilt_av',  COALESCE(NULLIF(v_label_fields->>'bestilt_av',''),
                            NULLIF(v_label_fields->>'recipient',''),
                            NULLIF(v_label_fields->>'customer_name','')),
    'telefon',     COALESCE(NULLIF(v_label_fields->>'telefon',''),
                            NULLIF(v_label_fields->>'phone','')),
    'sukkerbilde', CASE WHEN v_has_sukkerbilde THEN true ELSE NULL END,
    'fyll',        COALESCE(NULLIF(v_label_fields->>'fyll',''), v_fyll, ''),
    'tekst',       COALESCE(NULLIF(v_label_fields->>'cake_text',''),
                            NULLIF(v_label_fields->>'tekst',''), ''),
    'pynt',        COALESCE(NULLIF(v_label_fields->>'pynt',''), v_pynt, ''),
    'fritekst_1',  COALESCE(NULLIF(v_label_fields->>'note',''),
                            NULLIF(v_label_fields->>'kommentar',''), ''),
    'fritekst_2',  '',
    'fritekst_3',  '',
    'sendes_med',  COALESCE(NULLIF(v_label_fields->>'pickup_tour',''), ''),
    'tid',         COALESCE(NULLIF(v_label_fields->>'pickup_time',''), ''),
    'antall_etiketter', NULL
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
    'merknad',          v_merknad,
    'price_breakdown',  v_price
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.build_cake_order_line(uuid, uuid, jsonb) TO authenticated, service_role;


-- 2) pos_create_cake_order: skriv merknad til hovedordrelinjen
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
  v_merknad jsonb;
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

  v_rebuilt_result := public.build_cake_order_line(
    v_category_id,
    v_price_list_id,
    COALESCE(v_cake_result->'selections', '[]'::jsonb)
  );

  v_cake_result := v_cake_result || jsonb_build_object(
    'order_line', v_rebuilt_result->'order_line',
    'accessory_lines', COALESCE(v_rebuilt_result->'accessory_lines', '[]'::jsonb),
    'label_payload', v_rebuilt_result->'label_payload',
    'merknad', v_rebuilt_result->'merknad',
    'price_breakdown', v_rebuilt_result->'price_breakdown',
    'total_ex_mva', COALESCE((v_rebuilt_result->'price_breakdown'->>'total_ex_mva')::numeric, (v_cake_result->>'total_ex_mva')::numeric, 0),
    'total_inc_mva', COALESCE((v_rebuilt_result->'price_breakdown'->>'total_inc_mva')::numeric, (v_cake_result->>'total_inc_mva')::numeric, 0)
  );

  v_main_line := v_cake_result->'order_line';
  v_acc_lines := COALESCE(v_cake_result->'accessory_lines','[]'::jsonb);
  v_label_payload := v_cake_result->'label_payload';
  v_merknad := v_cake_result->'merknad';

  IF v_main_line IS NULL OR v_main_line = 'null'::jsonb THEN
    RAISE EXCEPTION 'Mangler påkrevd felt: cake_result.order_line';
  END IF;

  -- Berik merknad med kundens navn/telefon hvis ikke satt fra steg
  IF v_merknad IS NOT NULL THEN
    IF COALESCE(v_merknad->>'bestilt_av','') = '' AND v_customer_name IS NOT NULL THEN
      v_merknad := jsonb_set(v_merknad, '{bestilt_av}', to_jsonb(v_customer_name));
    END IF;
    IF COALESCE(v_merknad->>'telefon','') = '' AND v_customer_phone IS NOT NULL THEN
      v_merknad := jsonb_set(v_merknad, '{telefon}', to_jsonb(v_customer_phone));
    END IF;
  END IF;

  -- Find or create customer
  IF v_customer_phone IS NOT NULL THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE legal_entity_id = v_legal_entity_id
      AND (mobile_phone = v_customer_phone OR primary_contact_phone = v_customer_phone)
    LIMIT 1;
  END IF;

  IF v_customer_id IS NULL THEN
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

  SELECT * INTO v_num_row FROM public.next_order_number(v_legal_entity_id);
  v_order_number := v_num_row.order_number;
  v_order_year := v_num_row.order_year;
  v_order_seq := v_num_row.order_sequence;

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
    notes, cake_config, merknad
  ) VALUES (
    v_order_id, v_idx, v_product_id,
    jsonb_build_object(
      'display_name', v_main_line->>'display_name',
      'display_number', v_main_line->>'display_number',
      'mva_rate', v_vat_rate
    ),
    v_qty, 'stk', v_price, 'cake_builder',
    0, v_line_excl, v_vat_rate, v_line_vat, v_line_incl,
    COALESCE(v_main_line->>'notes',''), v_cake_result, v_merknad
  ) RETURNING id INTO v_main_order_line_id;

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