CREATE OR REPLACE FUNCTION public.label_units_mark_printed(
  p_legal_entity_id uuid,
  p_department_id uuid,
  p_profile_id uuid,
  p_status text,
  p_jobs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
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

  -- Lås i stabil rekkefølge (id) slik at to samtidige forsøk ikke låser hverandre fast.
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
      -- Gjentatt bekreftelse av samme forsøk: innholdet må stemme, ellers er
      -- jobb-id-en kollidert og feilen skal ikke skjules.
      IF v_existing.label_unit_id IS DISTINCT FROM r.label_unit_id
         OR v_existing.legal_entity_id IS DISTINCT FROM p_legal_entity_id
         OR v_existing.production_department_id IS DISTINCT FROM p_department_id
         OR v_existing.product_id IS DISTINCT FROM v_unit.product_id
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
$$;

REVOKE EXECUTE ON FUNCTION public.label_units_mark_printed(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.label_units_mark_printed(uuid, uuid, uuid, text, jsonb) TO authenticated;