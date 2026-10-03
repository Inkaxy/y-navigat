ALTER TABLE public.invoice_lines ADD COLUMN IF NOT EXISTS package_source_rms_id uuid;
COMMENT ON COLUMN public.invoice_lines.package_source_rms_id IS
  'Leverandørkoblingen matchemotoren brukte som pakningskilde ved siste beregning (null = ingen entydig kobling).';

-- Ett servergenerert grunnlag for linjens pris. Brukes både til lagring og til
-- sammenligning med det klienten så.
CREATE OR REPLACE FUNCTION public.invoice_line_price_basis(p_line public.invoice_lines)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'raw_material_id', p_line.raw_material_id,
    'quantity', round(p_line.quantity, 4),
    'unit', p_line.unit,
    'unit_price', round(p_line.unit_price, 4),
    'total_amount', round(p_line.total_amount, 4),
    'base_quantity', round(p_line.base_quantity, 4),
    'package_size', round(p_line.package_size, 4),
    'package_unit', p_line.package_unit,
    'count_per_package', round(p_line.count_per_package, 4),
    'price_per_base_unit', round(p_line.price_per_base_unit, 4),
    'expected_price_per_base_unit', round(p_line.expected_price_per_base_unit, 4),
    'price_reference_source', p_line.price_reference_source,
    'price_reference_id', p_line.price_reference_id,
    'price_reference_date', p_line.price_reference_date,
    'rms_id', p_line.package_source_rms_id,
    'rms_package', (
      SELECT jsonb_build_object(
        'package_size', r.package_size, 'package_unit', r.package_unit,
        'base_units_per_package', r.base_units_per_package, 'package_confirmed_at', r.package_confirmed_at)
      FROM public.raw_material_suppliers r WHERE r.id = p_line.package_source_rms_id)
  );
$$;
REVOKE ALL ON FUNCTION public.invoice_line_price_basis(public.invoice_lines) FROM PUBLIC, anon, authenticated;

-- Normaliserer klientens observerte grunnlag til samme form (tall avrundet til 4 desimaler).
CREATE OR REPLACE FUNCTION public._normalize_price_basis(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  k text;
  out jsonb := '{}'::jsonb;
  numeric_keys constant text[] := ARRAY['quantity','unit_price','total_amount','base_quantity','package_size',
    'count_per_package','price_per_base_unit','expected_price_per_base_unit'];
  text_keys constant text[] := ARRAY['raw_material_id','unit','package_unit','price_reference_source',
    'price_reference_id','price_reference_date'];
BEGIN
  FOREACH k IN ARRAY numeric_keys LOOP
    out := out || jsonb_build_object(k,
      CASE WHEN p->k IS NULL OR jsonb_typeof(p->k) = 'null' THEN NULL ELSE round((p->>k)::numeric, 4) END);
  END LOOP;
  FOREACH k IN ARRAY text_keys LOOP
    out := out || jsonb_build_object(k, CASE WHEN jsonb_typeof(p->k) = 'null' THEN NULL ELSE p->>k END);
  END LOOP;
  RETURN out;
END;
$$;

DROP FUNCTION IF EXISTS public.accept_invoice_line_price_variance(uuid, numeric, numeric);

CREATE OR REPLACE FUNCTION public.accept_invoice_line_price_variance(
  p_line_id uuid,
  p_observed jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line public.invoice_lines%ROWTYPE;
  v_inv  public.invoices%ROWTYPE;
  v_uid uuid := auth.uid();
  v_reasons text[];
  v_basis jsonb;
  v_current jsonb;
  v_snapshot jsonb;
  v_allowed constant text[] := ARRAY['price_variance','price_increase','price_drop'];
  v_invoice_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF p_observed IS NULL OR jsonb_typeof(p_observed) <> 'object' THEN
    RAISE EXCEPTION 'stale_line' USING ERRCODE = '40001';
  END IF;

  -- Samme låserekkefølge som rm_reconcile_invoice: faktura først, så linjer.
  SELECT invoice_id INTO v_invoice_id FROM public.invoice_lines WHERE id = p_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'line_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_inv FROM public.invoices WHERE id = v_invoice_id FOR UPDATE;
  IF NOT public.has_ravarer_invoice_access(v_inv.legal_entity_id, 'write') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_line FROM public.invoice_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND OR v_line.invoice_id <> v_inv.id THEN
    RAISE EXCEPTION 'stale_line' USING ERRCODE = '40001';
  END IF;

  IF v_inv.status IN ('reconciled','flagged','cancelled') OR v_inv.flagged_at IS NOT NULL THEN
    RAISE EXCEPTION 'invoice_locked' USING ERRCODE = 'P0001';
  END IF;
  -- Bare en bekreftet eller radpresis kobling — aldri et forslag.
  IF v_line.raw_material_id IS NULL OR coalesce(v_line.match_confidence, '') NOT IN ('manual','auto_high') THEN
    RAISE EXCEPTION 'line_not_linked' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.rm_is_finite(v_line.price_per_base_unit) OR v_line.price_per_base_unit <= 0
     OR NOT public.rm_is_finite(v_line.expected_price_per_base_unit) OR v_line.expected_price_per_base_unit <= 0 THEN
    RAISE EXCEPTION 'price_basis_missing' USING ERRCODE = 'P0001';
  END IF;

  v_reasons := array_remove(string_to_array(coalesce(v_line.review_reason, ''), ','), '');
  IF coalesce(array_length(v_reasons, 1), 0) = 0 OR NOT (v_reasons <@ v_allowed)
     OR NOT coalesce(v_line.requires_review, false) THEN
    RAISE EXCEPTION 'not_only_price_variance' USING ERRCODE = 'P0001';
  END IF;

  v_basis := public.invoice_line_price_basis(v_line);
  v_current := v_basis - 'rms_id' - 'rms_package';
  BEGIN
    IF public._normalize_price_basis(p_observed) IS DISTINCT FROM public._normalize_price_basis(v_current) THEN
      RAISE EXCEPTION 'stale_line' USING ERRCODE = '40001';
    END IF;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'stale_line' USING ERRCODE = '40001';
  END;

  v_snapshot := v_basis || jsonb_build_object(
    'accepted_reasons', to_jsonb(v_reasons),
    'price_variance_pct', v_line.price_variance_pct,
    'accepted_by', v_uid,
    'accepted_at', now());

  UPDATE public.invoice_lines SET
    requires_review = false,
    review_reason = NULL,
    resolution_note = 'Prisavvik godtatt',
    resolved_by = v_uid,
    resolved_at = now(),
    price_acceptance = v_snapshot,
    updated_at = now()
  WHERE id = p_line_id;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  VALUES (v_uid, 'invoice_line.price_variance_accepted', 'invoice_line', p_line_id, v_inv.legal_entity_id,
          v_snapshot, 'Prisavvik godtatt', 'ravarer');

  RETURN v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invoice_line_price_variance(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invoice_line_price_variance(uuid, jsonb) TO authenticated;