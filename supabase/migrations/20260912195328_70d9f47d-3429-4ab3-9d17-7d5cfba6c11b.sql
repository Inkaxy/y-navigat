-- 1) Etikettjobber: ta med profil, ordrelinje og etikettnummer i kollisjonssjekken.
CREATE OR REPLACE FUNCTION public.label_units_mark_printed(p_legal_entity_id uuid, p_department_id uuid, p_profile_id uuid, p_status text, p_jobs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_counted int := 0;
  v_already int := 0;
  v_unit_ids uuid[];
  v_job_ids uuid[];
  v_locked int;
  r record;
  v_existing record;
  v_unit record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Ikke innlogget' USING ERRCODE = '28000';
  END IF;

  IF p_status NOT IN ('printed', 'failed') THEN
    RAISE EXCEPTION 'Ugyldig utskriftsstatus: %', p_status USING ERRCODE = '22023';
  END IF;

  IF p_legal_entity_id IS NULL OR p_department_id IS NULL THEN
    RAISE EXCEPTION 'Selskap og produksjonsavdeling må oppgis' USING ERRCODE = '22023';
  END IF;

  IF NOT has_position_in_entity(p_legal_entity_id)
     OR NOT has_app_write_access('produksjon') THEN
    RAISE EXCEPTION 'Mangler skriverettighet for etiketter i dette selskapet'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM production_departments d
    WHERE d.id = p_department_id AND d.legal_entity_id = p_legal_entity_id
  ) THEN
    RAISE EXCEPTION 'Produksjonsavdelingen hører ikke til dette selskapet'
      USING ERRCODE = '22023';
  END IF;

  IF p_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM label_print_profiles pr
    WHERE pr.id = p_profile_id AND pr.legal_entity_id = p_legal_entity_id
  ) THEN
    RAISE EXCEPTION 'Etikettprofilen hører ikke til dette selskapet'
      USING ERRCODE = '22023';
  END IF;

  IF p_jobs IS NULL OR jsonb_typeof(p_jobs) <> 'array' OR jsonb_array_length(p_jobs) = 0 THEN
    RAISE EXCEPTION 'Utskriftsforsøket inneholder ingen etiketter' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _lump_jobs (
    job_id uuid NOT NULL,
    label_unit_id uuid NOT NULL
  ) ON COMMIT DROP;
  DELETE FROM _lump_jobs;

  INSERT INTO _lump_jobs (job_id, label_unit_id)
  SELECT (e ->> 'job_id')::uuid, (e ->> 'label_unit_id')::uuid
  FROM jsonb_array_elements(p_jobs) e;

  IF EXISTS (SELECT 1 FROM _lump_jobs WHERE job_id IS NULL OR label_unit_id IS NULL) THEN
    RAISE EXCEPTION 'Utskriftsforsøket mangler jobb-id eller etikett-id' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT label_unit_id), array_agg(DISTINCT job_id)
    INTO v_unit_ids, v_job_ids
  FROM _lump_jobs;

  IF array_length(v_unit_ids, 1) <> (SELECT count(*) FROM _lump_jobs)
     OR array_length(v_job_ids, 1) <> (SELECT count(*) FROM _lump_jobs) THEN
    RAISE EXCEPTION 'Utskriftsforsøket har duplikate etiketter eller jobb-id-er'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_locked
  FROM (
    SELECT u.id
    FROM label_units u
    WHERE u.id = ANY (v_unit_ids)
      AND u.legal_entity_id = p_legal_entity_id
    ORDER BY u.id
    FOR UPDATE
  ) s;

  IF v_locked <> array_length(v_unit_ids, 1) THEN
    RAISE EXCEPTION 'Én eller flere etiketter finnes ikke, eller hører til et annet selskap'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM label_units u
    WHERE u.id = ANY (v_unit_ids) AND u.status = 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Én eller flere etiketter er kansellert og kan ikke skrives ut'
      USING ERRCODE = '22023';
  END IF;

  FOR r IN SELECT job_id, label_unit_id FROM _lump_jobs ORDER BY label_unit_id LOOP
    SELECT * INTO v_unit FROM label_units WHERE id = r.label_unit_id;

    SELECT * INTO v_existing FROM label_print_jobs WHERE id = r.job_id;

    IF FOUND THEN
      -- Gjentatt bekreftelse av samme forsøk: ALT uforanderlig innhold må
      -- stemme, ellers er jobb-id-en kollidert og feilen skal ikke skjules.
      IF v_existing.label_unit_id IS DISTINCT FROM r.label_unit_id
         OR v_existing.legal_entity_id IS DISTINCT FROM p_legal_entity_id
         OR v_existing.production_department_id IS DISTINCT FROM p_department_id
         OR v_existing.product_id IS DISTINCT FROM v_unit.product_id
         OR v_existing.profile_id IS DISTINCT FROM p_profile_id
         OR v_existing.order_line_id IS DISTINCT FROM v_unit.order_line_id
         OR v_existing.label_number IS DISTINCT FROM v_unit.number::text
         OR v_existing.status IS DISTINCT FROM p_status THEN
        RAISE EXCEPTION 'Utskriftsjobben % finnes allerede med annet innhold', r.job_id
          USING ERRCODE = '23505';
      END IF;
      v_already := v_already + 1;
      CONTINUE;
    END IF;

    INSERT INTO label_print_jobs (
      id, label_number, label_unit_id, product_id, order_line_id,
      legal_entity_id, production_department_id, profile_id,
      quantity, printer_name, printed_by, status
    ) VALUES (
      r.job_id, v_unit.number::text, v_unit.id, v_unit.product_id, v_unit.order_line_id,
      p_legal_entity_id, p_department_id, p_profile_id,
      1, NULL, v_uid, p_status
    );

    IF p_status = 'printed' THEN
      UPDATE label_units
         SET status = 'printed',
             first_printed_at = COALESCE(first_printed_at, v_now),
             print_count = print_count + 1,
             updated_at = v_now
       WHERE id = r.label_unit_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Kunne ikke oppdatere etiketten %', r.label_unit_id
          USING ERRCODE = '42501';
      END IF;
      v_counted := v_counted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status', p_status,
    'counted', v_counted,
    'already_logged', v_already,
    'units', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', u.id, 'number', u.number, 'status', u.status,
        'print_count', u.print_count, 'first_printed_at', u.first_printed_at
      ) ORDER BY u.number), '[]'::jsonb)
      FROM label_units u WHERE u.id = ANY (v_unit_ids)
    )
  );
END;
$function$;

-- 2) Ordre: lagre hode + linjer atomisk UTEN å slette urørte linjer.
CREATE OR REPLACE FUNCTION public.order_save_with_lines(
  p_order_id uuid,
  p_header jsonb,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_keep uuid[] := ARRAY[]::uuid[];
  v_existing_ids uuid[];
  v_deleted int := 0;
  v_updated int := 0;
  v_inserted int := 0;
  r jsonb;
  v_id uuid;
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
  PERFORM 1 FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordren finnes ikke, eller du har ikke tilgang til den'
      USING ERRCODE = '42501';
  END IF;

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
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_id := NULLIF(r ->> 'id', '')::uuid;

    IF v_id IS NOT NULL THEN
      IF NOT (v_id = ANY (v_existing_ids)) THEN
        RAISE EXCEPTION 'Ordrelinjen % hører ikke til denne ordren', v_id
          USING ERRCODE = '22023';
      END IF;
      UPDATE order_lines SET
        line_number = (r ->> 'line_number')::int,
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
        (r ->> 'line_number')::int,
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
      ) RETURNING id INTO v_id;
      v_inserted := v_inserted + 1;
    END IF;

    v_keep := array_append(v_keep, v_id);
  END LOOP;

  DELETE FROM order_lines
   WHERE order_id = p_order_id
     AND NOT (id = ANY (v_keep));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

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

REVOKE EXECUTE ON FUNCTION public.order_save_with_lines(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_save_with_lines(uuid, jsonb, jsonb) TO authenticated, service_role;