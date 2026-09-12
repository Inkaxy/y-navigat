CREATE OR REPLACE FUNCTION public.order_save_with_lines(p_order_id uuid, p_header jsonb, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_entity uuid;
  v_keep uuid[] := ARRAY[]::uuid[];
  v_existing_ids uuid[];
  v_deleted int := 0;
  v_updated int := 0;
  v_inserted int := 0;
  v_header_rows int := 0;
  v_count int;
  r jsonb;
  v_id uuid;
  v_line_no int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Ikke innlogget' USING ERRCODE = '28000';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Ordre mangler' USING ERRCODE = '22023';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Ordrelinjene mangler' USING ERRCODE = '22023';
  END IF;

  -- Lås ordren. RLS avgjør om brukeren i det hele tatt ser den.
  SELECT o.legal_entity_id INTO v_entity
  FROM orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordren finnes ikke, eller du har ikke tilgang til den'
      USING ERRCODE = '42501';
  END IF;

  -- Skrivetilgang må kontrolleres eksplisitt: en bruker med kun lesetilgang
  -- skal ikke få «suksess» på et tomt linjesett.
  IF v_entity IS NULL
     OR NOT has_position_in_entity(v_entity)
     OR NOT has_app_write_access('ordre') THEN
    RAISE EXCEPTION 'Mangler skrivetilgang til ordre i dette selskapet'
      USING ERRCODE = '42501';
  END IF;

  -- Duplikatvern i inndata: samme linje eller samme linjenummer to ganger ville
  -- gitt ikke-deterministisk resultat eller nummerkollisjon.
  SELECT count(*) INTO v_count
  FROM (
    SELECT NULLIF(e.value ->> 'id', '')::uuid AS id
    FROM jsonb_array_elements(p_lines) e
    WHERE NULLIF(e.value ->> 'id', '') IS NOT NULL
  ) s;
  IF v_count <> (
    SELECT count(DISTINCT NULLIF(e.value ->> 'id', '')::uuid)
    FROM jsonb_array_elements(p_lines) e
    WHERE NULLIF(e.value ->> 'id', '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Samme ordrelinje er sendt inn flere ganger' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) e
    WHERE NULLIF(e.value ->> 'line_number', '') IS NULL
       OR (e.value ->> 'line_number')::int < 1
  ) THEN
    RAISE EXCEPTION 'Ordrelinjene mangler gyldig linjenummer' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), count(DISTINCT (e.value ->> 'line_number')::int)
    INTO v_count, v_header_rows
  FROM jsonb_array_elements(p_lines) e;
  IF v_count <> v_header_rows THEN
    RAISE EXCEPTION 'To ordrelinjer har samme linjenummer' USING ERRCODE = '22023';
  END IF;
  v_header_rows := 0;

  SELECT array_agg(id) INTO v_existing_ids FROM order_lines WHERE order_id = p_order_id;
  v_existing_ids := COALESCE(v_existing_ids, ARRAY[]::uuid[]);

  -- Hode: kun kjente felt, aldri fritt utvalg fra klienten.
  IF p_header IS NOT NULL AND jsonb_typeof(p_header) = 'object' THEN
    UPDATE orders o SET
      source = COALESCE((p_header ->> 'source'), o.source),
      delivery_date = COALESCE((p_header ->> 'delivery_date')::date, o.delivery_date),
      delivery_time = CASE WHEN p_header ? 'delivery_time'
                           THEN NULLIF(p_header ->> 'delivery_time', '')::time
                           ELSE o.delivery_time END,
      delivery_tour_id = CASE WHEN p_header ? 'delivery_tour_id'
                              THEN NULLIF(p_header ->> 'delivery_tour_id', '')::uuid
                              ELSE o.delivery_tour_id END,
      distribution = COALESCE((p_header ->> 'distribution'), o.distribution),
      final_customer_name = CASE WHEN p_header ? 'final_customer_name'
                                 THEN NULLIF(p_header ->> 'final_customer_name', '')
                                 ELSE o.final_customer_name END,
      final_customer_email = CASE WHEN p_header ? 'final_customer_email'
                                  THEN NULLIF(p_header ->> 'final_customer_email', '')
                                  ELSE o.final_customer_email END,
      final_customer_phone = CASE WHEN p_header ? 'final_customer_phone'
                                  THEN NULLIF(p_header ->> 'final_customer_phone', '')
                                  ELSE o.final_customer_phone END,
      send_sms_confirm = COALESCE((p_header ->> 'send_sms_confirm')::boolean, o.send_sms_confirm),
      send_email_confirm = COALESCE((p_header ->> 'send_email_confirm')::boolean, o.send_email_confirm),
      is_paid = COALESCE((p_header ->> 'is_paid')::boolean, o.is_paid),
      rule_override_reason = CASE WHEN p_header ? 'rule_override_reason'
                                  THEN NULLIF(p_header ->> 'rule_override_reason', '')
                                  ELSE o.rule_override_reason END
    WHERE o.id = p_order_id;
    GET DIAGNOSTICS v_header_rows = ROW_COUNT;
    IF v_header_rows <> 1 THEN
      RAISE EXCEPTION 'Ordrehodet kunne ikke oppdateres — mangler skrivetilgang'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Alle innsendte linje-id-er må tilhøre ordren.
  FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_id := NULLIF(r ->> 'id', '')::uuid;
    IF v_id IS NOT NULL THEN
      IF NOT (v_id = ANY (v_existing_ids)) THEN
        RAISE EXCEPTION 'Ordrelinjen % hører ikke til denne ordren', v_id
          USING ERRCODE = '22023';
      END IF;
      v_keep := array_append(v_keep, v_id);
    END IF;
  END LOOP;

  -- Trinn 1: parkér alle eksisterende linjenumre på midlertidige, garantert
  -- ledige negative verdier. Da kan vi både fjerne den første linjen, bytte
  -- rekkefølge og gjenbruke et frigjort nummer uten å kollidere med den delte
  -- unike indeksen (order_id, line_number).
  UPDATE order_lines l
     SET line_number = s.tmp
    FROM (
      SELECT id, -(row_number() OVER (ORDER BY line_number, id))::int AS tmp
      FROM order_lines WHERE order_id = p_order_id
    ) s
   WHERE l.id = s.id AND l.order_id = p_order_id;

  -- Trinn 2: fjern linjene brukeren faktisk slettet, før nye numre settes.
  DELETE FROM order_lines
   WHERE order_id = p_order_id
     AND NOT (id = ANY (v_keep));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Trinn 3: oppdater beholdte linjer (med endelig nummer) og sett inn nye.
  FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_id := NULLIF(r ->> 'id', '')::uuid;
    v_line_no := (r ->> 'line_number')::int;

    IF v_id IS NOT NULL THEN
      UPDATE order_lines SET
        line_number = v_line_no,
        product_id = (r ->> 'product_id')::uuid,
        product_snapshot = COALESCE(r -> 'product_snapshot', '{}'::jsonb),
        quantity = (r ->> 'quantity')::numeric,
        sales_unit = r ->> 'sales_unit',
        unit_price = (r ->> 'unit_price')::numeric,
        unit_price_source = NULLIF(r ->> 'unit_price_source', ''),
        unit_price_source_id = NULLIF(r ->> 'unit_price_source_id', '')::uuid,
        discount_percent = COALESCE((r ->> 'discount_percent')::numeric, 0),
        line_subtotal_excl_vat = (r ->> 'line_subtotal_excl_vat')::numeric,
        vat_rate = (r ->> 'vat_rate')::numeric,
        line_vat = (r ->> 'line_vat')::numeric,
        line_total_incl_vat = (r ->> 'line_total_incl_vat')::numeric,
        merknad = CASE WHEN r -> 'merknad' IS NULL OR jsonb_typeof(r -> 'merknad') = 'null'
                       THEN NULL ELSE r -> 'merknad' END,
        notes = NULLIF(r ->> 'notes', '')
      WHERE id = v_id AND order_id = p_order_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Kunne ikke oppdatere ordrelinjen %', v_id USING ERRCODE = '42501';
      END IF;
      v_updated := v_updated + 1;
    ELSE
      INSERT INTO order_lines (
        order_id, line_number, product_id, product_snapshot, quantity, sales_unit,
        unit_price, unit_price_source, unit_price_source_id, discount_percent,
        line_subtotal_excl_vat, vat_rate, line_vat, line_total_incl_vat, merknad, notes
      ) VALUES (
        p_order_id,
        v_line_no,
        (r ->> 'product_id')::uuid,
        COALESCE(r -> 'product_snapshot', '{}'::jsonb),
        (r ->> 'quantity')::numeric,
        r ->> 'sales_unit',
        (r ->> 'unit_price')::numeric,
        NULLIF(r ->> 'unit_price_source', ''),
        NULLIF(r ->> 'unit_price_source_id', '')::uuid,
        COALESCE((r ->> 'discount_percent')::numeric, 0),
        (r ->> 'line_subtotal_excl_vat')::numeric,
        (r ->> 'vat_rate')::numeric,
        (r ->> 'line_vat')::numeric,
        (r ->> 'line_total_incl_vat')::numeric,
        CASE WHEN r -> 'merknad' IS NULL OR jsonb_typeof(r -> 'merknad') = 'null'
             THEN NULL ELSE r -> 'merknad' END,
        NULLIF(r ->> 'notes', '')
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM order_lines WHERE order_id = p_order_id AND line_number < 1
  ) THEN
    RAISE EXCEPTION 'Intern feil: en ordrelinje står igjen med midlertidig nummer'
      USING ERRCODE = 'XX000';
  END IF;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'inserted', v_inserted,
    'deleted', v_deleted,
    'line_ids', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', l.id, 'line_number', l.line_number)
                                ORDER BY l.line_number), '[]'::jsonb)
      FROM order_lines l WHERE l.order_id = p_order_id
    )
  );
END;
$function$;