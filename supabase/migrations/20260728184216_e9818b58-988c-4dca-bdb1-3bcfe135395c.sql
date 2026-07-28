
-- 1) _invoice_settings_audit trigger
CREATE OR REPLACE FUNCTION public._invoice_settings_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.audit_log (
    user_id, legal_entity_id, action, entity_type, entity_id,
    entity_display_reference, changes, source_app
  ) VALUES (
    auth.uid(),
    NEW.legal_entity_id,
    CASE WHEN TG_OP = 'INSERT' THEN 'invoice_settings_created' ELSE 'invoice_settings_updated' END,
    'invoice_settings',
    NEW.legal_entity_id,
    NEW.legal_entity_id::text,
    jsonb_build_object(
      'default_due_days', NEW.default_due_days,
      'vat_account_map', NEW.vat_account_map,
      'non_transfer_groups', NEW.non_transfer_groups,
      'internal_groups', NEW.internal_groups
    ),
    'faktura'
  );
  RETURN NEW;
END;
$function$;

-- 2) cancel_invoice_run
CREATE OR REPLACE FUNCTION public.cancel_invoice_run(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entity uuid;
  v_deleted int;
  v_remaining int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING errcode = '42501';
  END IF;

  SELECT legal_entity_id INTO v_entity FROM public.invoice_runs WHERE id = p_run_id;
  IF v_entity IS NULL THEN
    RAISE EXCEPTION 'Run not found' USING errcode = 'P0002';
  END IF;
  IF NOT has_position_in_entity(v_entity) THEN
    RAISE EXCEPTION 'No position in entity' USING errcode = '42501';
  END IF;
  IF NOT has_app_write_access('faktura') THEN
    RAISE EXCEPTION 'No write access to faktura' USING errcode = '42501';
  END IF;

  WITH del AS (
    DELETE FROM public.invoice_basis
    WHERE run_id = p_run_id
      AND status IN ('pending','excluded','skipped','error')
      AND tripletex_order_id IS NULL
    RETURNING id
  )
  SELECT count(*) INTO v_deleted FROM del;

  SELECT count(*) INTO v_remaining FROM public.invoice_basis WHERE run_id = p_run_id;

  IF v_remaining = 0 THEN
    UPDATE public.invoice_runs
    SET status = 'cancelled', completed_at = COALESCE(completed_at, now())
    WHERE id = p_run_id;
  END IF;

  INSERT INTO public.audit_log (
    user_id, legal_entity_id, action, entity_type, entity_id,
    entity_display_reference, changes, source_app
  )
  VALUES (
    auth.uid(), v_entity, 'invoice_run_cancelled', 'invoice_run', p_run_id,
    p_run_id::text,
    jsonb_build_object('deleted_basis_count', v_deleted, 'remaining_basis_count', v_remaining),
    'faktura'
  );

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'deleted_basis_count', v_deleted,
    'remaining_basis_count', v_remaining,
    'run_cancelled', v_remaining = 0
  );
END;
$function$;

-- 3) clear_invoice_tripletex_meta
CREATE OR REPLACE FUNCTION public.clear_invoice_tripletex_meta(p_legal_entity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING errcode = '42501';
  END IF;
  IF app_access_level('faktura'::text) <> 'admin'::access_level
     OR NOT has_position_in_entity(p_legal_entity_id) THEN
    RAISE EXCEPTION 'No admin access to faktura' USING errcode = '42501';
  END IF;

  UPDATE public.invoice_settings
     SET tripletex_meta = '{}'::jsonb,
         updated_at = now()
   WHERE legal_entity_id = p_legal_entity_id;

  INSERT INTO public.audit_log (
    user_id, legal_entity_id, action, entity_type, entity_id,
    entity_display_reference, changes, source_app
  ) VALUES (
    auth.uid(), p_legal_entity_id, 'invoice_tripletex_meta_cleared',
    'invoice_settings', p_legal_entity_id, p_legal_entity_id::text,
    '{}'::jsonb, 'faktura'
  );

  RETURN jsonb_build_object('cleared', true);
END;
$function$;

-- 4) create_invoice_run: set status='pending' initially (transfer sets running); fix audit columns
CREATE OR REPLACE FUNCTION public.create_invoice_run(p_legal_entity_id uuid, p_run_date date, p_groups text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id uuid;
  v_settings record;
  v_non_transfer text[];
  v_basis_count int := 0;
  v_order_count int := 0;
  v_skipped_count int := 0;
  v_total_incl_vat numeric := 0;
  v_seq bigint;
  v_basis_number text;
  v_year int := EXTRACT(YEAR FROM p_run_date)::int;
  v_rec record;
  v_basis_id uuid;
  v_sum_excl numeric;
  v_sum_vat numeric;
  v_sum_incl numeric;
  v_status text;
  v_do_transfer boolean;
  v_transfer_error text;
  v_payment_terms int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING errcode = '42501';
  END IF;
  IF NOT has_position_in_entity(p_legal_entity_id) THEN
    RAISE EXCEPTION 'No position in entity' USING errcode = '42501';
  END IF;
  IF NOT has_app_write_access('faktura') THEN
    RAISE EXCEPTION 'No write access to faktura' USING errcode = '42501';
  END IF;

  IF p_groups IS NULL OR array_length(p_groups, 1) IS NULL THEN
    p_groups := ARRAY[]::text[];
  END IF;

  INSERT INTO public.invoice_settings (legal_entity_id)
  VALUES (p_legal_entity_id)
  ON CONFLICT (legal_entity_id) DO NOTHING;

  SELECT * INTO v_settings
  FROM public.invoice_settings
  WHERE legal_entity_id = p_legal_entity_id;

  v_non_transfer := COALESCE(v_settings.non_transfer_groups, ARRAY[]::text[]);

  INSERT INTO public.invoice_runs (
    legal_entity_id, run_date, groups, status, started_by, started_at
  )
  VALUES (p_legal_entity_id, p_run_date, p_groups, 'pending', auth.uid(), now())
  RETURNING id INTO v_run_id;

  CREATE TEMP TABLE _fk_candidates ON COMMIT DROP AS
  WITH candidate_orders AS (
    SELECT
      o.id AS order_id,
      COALESCE(o.invoice_recipient_customer_id, o.customer_id) AS recipient_id,
      o.customer_id AS source_customer_id,
      o.delivery_date
    FROM public.orders o
    WHERE o.legal_entity_id = p_legal_entity_id
      AND (
        (COALESCE(o.is_return, false) = false AND o.status = 'delivered')
        OR (COALESCE(o.is_return, false) = true AND o.status IN ('confirmed','delivered'))
      )
      AND o.delivery_date <= p_run_date
      AND NOT EXISTS (
        SELECT 1 FROM public.invoice_basis_orders ibo WHERE ibo.order_id = o.id
      )
  )
  SELECT
    co.order_id,
    co.recipient_id,
    co.source_customer_id,
    co.delivery_date,
    NULLIF(COALESCE(c.profile_overrides->>'invoicing_group', cp.invoicing_group), '') AS invoicing_group,
    COALESCE(
      NULLIF(c.profile_overrides->>'one_order_per_invoice','')::boolean,
      cp.one_order_per_invoice,
      false
    ) AS one_order_per_invoice,
    COALESCE(
      NULLIF(c.profile_overrides->>'payment_terms_days','')::int,
      cp.payment_terms_days
    ) AS payment_terms_days,
    COALESCE(c.credit_hold, false) AS credit_hold,
    c.display_name AS recipient_name,
    c.customer_number AS recipient_number,
    c.tripletex_customer_id AS recipient_tripletex_id,
    to_jsonb(c.*) AS customer_snapshot
  FROM candidate_orders co
  LEFT JOIN public.customers c ON c.id = co.recipient_id
  LEFT JOIN public.customer_profiles cp ON cp.id = c.customer_profile_id;

  DELETE FROM _fk_candidates
  WHERE NOT (
    (invoicing_group IS NULL AND '__none__' = ANY(p_groups))
    OR invoicing_group = ANY(p_groups)
  );

  FOR v_rec IN
    SELECT
      recipient_id,
      CASE WHEN bool_or(one_order_per_invoice) THEN order_id ELSE NULL::uuid END AS split_order_id,
      MAX(invoicing_group) AS invoicing_group,
      MAX(payment_terms_days) AS payment_terms_days,
      bool_or(credit_hold) AS credit_hold,
      MAX(recipient_name) AS recipient_name,
      MAX(recipient_number) AS recipient_number,
      MAX(recipient_tripletex_id) AS recipient_tripletex_id,
      (array_agg(customer_snapshot))[1] AS customer_snapshot,
      array_agg(DISTINCT order_id) AS order_ids,
      array_agg(DISTINCT source_customer_id) AS source_customer_ids
    FROM _fk_candidates
    GROUP BY recipient_id, CASE WHEN one_order_per_invoice THEN order_id ELSE NULL::uuid END
  LOOP
    v_do_transfer := true;
    v_transfer_error := NULL;
    v_status := 'pending';

    IF v_rec.credit_hold THEN
      v_status := 'skipped';
      v_do_transfer := false;
      v_transfer_error := 'Kredittsperre';
      v_skipped_count := v_skipped_count + 1;
    ELSIF v_rec.invoicing_group IS NOT NULL AND v_rec.invoicing_group = ANY(v_non_transfer) THEN
      v_status := 'excluded';
      v_do_transfer := false;
    END IF;

    v_payment_terms := COALESCE(v_rec.payment_terms_days, v_settings.default_due_days);

    v_seq := public.next_display_number(p_legal_entity_id, 'invoice_basis');
    v_basis_number := 'FG-' || v_year::text || '-' || lpad(v_seq::text, 4, '0');

    INSERT INTO public.invoice_basis (
      run_id, legal_entity_id, customer_id, source_customer_ids,
      basis_number, invoicing_group, payment_terms_days, do_transfer,
      status, transfer_error, customer_snapshot, tripletex_customer_id
    )
    VALUES (
      v_run_id, p_legal_entity_id, v_rec.recipient_id, v_rec.source_customer_ids,
      v_basis_number, v_rec.invoicing_group, v_payment_terms, v_do_transfer,
      v_status, v_transfer_error, v_rec.customer_snapshot, v_rec.recipient_tripletex_id
    )
    RETURNING id INTO v_basis_id;

    IF v_status = 'skipped' THEN
      v_basis_count := v_basis_count + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.invoice_basis_orders (basis_id, order_id)
    SELECT v_basis_id, unnest(v_rec.order_ids);

    WITH src AS (
      SELECT
        ol.product_id,
        EXTRACT(ISOYEAR FROM o.delivery_date)::int AS iso_year,
        EXTRACT(WEEK FROM o.delivery_date)::int AS iso_week,
        COALESCE(ol.vat_rate, 0) AS vat_rate,
        ol.quantity,
        ol.line_subtotal_excl_vat,
        ol.line_vat,
        ol.line_total_incl_vat,
        ol.sales_unit,
        ol.product_snapshot
      FROM public.order_lines ol
      JOIN public.orders o ON o.id = ol.order_id
      WHERE ol.order_id = ANY(v_rec.order_ids)
    ),
    agg AS (
      SELECT
        product_id,
        iso_week,
        vat_rate,
        SUM(quantity) AS quantity,
        SUM(line_subtotal_excl_vat) AS line_excl_vat,
        SUM(line_vat) AS line_vat,
        SUM(line_total_incl_vat) AS line_incl_vat,
        MAX(sales_unit) AS sales_unit,
        (array_agg(product_snapshot))[1] AS product_snapshot
      FROM src
      GROUP BY product_id, iso_week, vat_rate
    )
    INSERT INTO public.invoice_basis_lines (
      basis_id, line_number, product_id, product_number, description,
      iso_week, quantity, sales_unit, unit_price_excl_vat, vat_rate,
      line_excl_vat, line_vat, line_incl_vat
    )
    SELECT
      v_basis_id,
      row_number() OVER (ORDER BY iso_week, product_id),
      product_id,
      COALESCE(product_snapshot->>'product_number', product_snapshot->>'number'),
      COALESCE(
        product_snapshot->>'product_number', product_snapshot->>'number', ''
      ) || ' ' || COALESCE(product_snapshot->>'name','')
        || ' — uke ' || lpad(iso_week::text, 2, '0'),
      iso_week,
      quantity,
      sales_unit,
      CASE WHEN quantity <> 0 THEN line_excl_vat / quantity ELSE NULL END,
      vat_rate,
      COALESCE(line_excl_vat, 0),
      COALESCE(line_vat, 0),
      COALESCE(line_incl_vat, 0)
    FROM agg;

    SELECT
      COALESCE(SUM(line_excl_vat), 0),
      COALESCE(SUM(line_vat), 0),
      COALESCE(SUM(line_incl_vat), 0)
    INTO v_sum_excl, v_sum_vat, v_sum_incl
    FROM public.invoice_basis_lines
    WHERE basis_id = v_basis_id;

    UPDATE public.invoice_basis
    SET sum_excl_vat = v_sum_excl,
        sum_vat = v_sum_vat,
        sum_incl_vat = v_sum_incl
    WHERE id = v_basis_id;

    v_basis_count := v_basis_count + 1;
    v_order_count := v_order_count + COALESCE(array_length(v_rec.order_ids, 1), 0);
    v_total_incl_vat := v_total_incl_vat + v_sum_incl;
  END LOOP;

  -- Grunnlaget er nå bygget. Setter status='pending' (ikke completed) —
  -- transfer-run flipper til 'running' og deretter completed/completed_with_errors.
  UPDATE public.invoice_runs
  SET basis_count = v_basis_count,
      skipped_count = v_skipped_count,
      total_incl_vat = v_total_incl_vat
  WHERE id = v_run_id;

  INSERT INTO public.audit_log (
    user_id, legal_entity_id, action, entity_type, entity_id,
    entity_display_reference, changes, source_app
  )
  VALUES (
    auth.uid(), p_legal_entity_id, 'invoice_run_created', 'invoice_run', v_run_id,
    v_run_id::text,
    jsonb_build_object(
      'run_date', p_run_date,
      'groups', p_groups,
      'basis_count', v_basis_count,
      'order_count', v_order_count,
      'skipped_count', v_skipped_count,
      'total_incl_vat', v_total_incl_vat
    ),
    'faktura'
  );

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'basis_count', v_basis_count,
    'order_count', v_order_count,
    'total_incl_vat', v_total_incl_vat,
    'skipped', v_skipped_count
  );
END;
$function$;

-- 5) get_invoice_run_preview_customers: c.name -> c.display_name
CREATE OR REPLACE FUNCTION public.get_invoice_run_preview_customers(p_legal_entity_id uuid, p_run_date date, p_groups text[] DEFAULT NULL::text[])
 RETURNS TABLE(recipient_id uuid, customer_name text, invoicing_group text, order_count bigint, sum_incl_vat numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING errcode = '42501';
  END IF;
  IF NOT has_position_in_entity(p_legal_entity_id) THEN
    RAISE EXCEPTION 'No position in entity' USING errcode = '42501';
  END IF;
  IF app_access_level('faktura') = 'none'::access_level THEN
    RAISE EXCEPTION 'No access to faktura' USING errcode = '42501';
  END IF;

  RETURN QUERY
  WITH candidate_orders AS (
    SELECT
      o.id AS order_id,
      COALESCE(o.invoice_recipient_customer_id, o.customer_id) AS rid,
      o.total_incl_vat
    FROM public.orders o
    WHERE o.legal_entity_id = p_legal_entity_id
      AND (
        (COALESCE(o.is_return, false) = false AND o.status = 'delivered')
        OR (COALESCE(o.is_return, false) = true AND o.status IN ('confirmed','delivered'))
      )
      AND o.delivery_date <= p_run_date
      AND NOT EXISTS (SELECT 1 FROM public.invoice_basis_orders ibo WHERE ibo.order_id = o.id)
  ),
  with_group AS (
    SELECT
      co.rid,
      co.order_id,
      co.total_incl_vat,
      COALESCE(c.display_name, '—') AS customer_name,
      NULLIF(COALESCE(c.profile_overrides->>'invoicing_group', cp.invoicing_group), '') AS invoicing_group
    FROM candidate_orders co
    LEFT JOIN public.customers c ON c.id = co.rid
    LEFT JOIN public.customer_profiles cp ON cp.id = c.customer_profile_id
  )
  SELECT
    wg.rid AS recipient_id,
    wg.customer_name,
    wg.invoicing_group,
    COUNT(*)::bigint AS order_count,
    COALESCE(SUM(wg.total_incl_vat), 0)::numeric AS sum_incl_vat
  FROM with_group wg
  WHERE p_groups IS NULL
     OR array_length(p_groups, 1) IS NULL
     OR COALESCE(wg.invoicing_group, '__none') = ANY(p_groups)
  GROUP BY wg.rid, wg.customer_name, wg.invoicing_group
  ORDER BY customer_name;
END;
$function$;
