ALTER TABLE public.invoice_lines ADD COLUMN IF NOT EXISTS price_acceptance jsonb;

COMMENT ON COLUMN public.invoice_lines.price_acceptance IS
  'Servergenerert grunnlag for et godtatt prisavvik. Matchemotoren beholder godkjenningen kun når grunnlaget er identisk.';

CREATE OR REPLACE FUNCTION public.accept_invoice_line_price_variance(
  p_line_id uuid,
  p_expected_price_per_base_unit numeric,
  p_expected_reference_price numeric
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
  v_snapshot jsonb;
  v_allowed constant text[] := ARRAY['price_variance','price_increase','price_drop'];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;

  SELECT * INTO v_line FROM public.invoice_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'line_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_inv FROM public.invoices WHERE id = v_line.invoice_id;

  IF NOT public.has_ravarer_invoice_access(v_inv.legal_entity_id, 'write') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status IN ('reconciled','flagged','cancelled') THEN
    RAISE EXCEPTION 'invoice_locked' USING ERRCODE = 'P0001';
  END IF;
  IF v_line.raw_material_id IS NULL OR v_line.match_confidence = 'not_applicable' THEN
    RAISE EXCEPTION 'line_not_linked' USING ERRCODE = 'P0001';
  END IF;
  IF v_line.price_per_base_unit IS NULL OR v_line.price_per_base_unit <= 0
     OR v_line.expected_price_per_base_unit IS NULL OR v_line.expected_price_per_base_unit <= 0 THEN
    RAISE EXCEPTION 'price_basis_missing' USING ERRCODE = 'P0001';
  END IF;

  v_reasons := array_remove(string_to_array(coalesce(v_line.review_reason, ''), ','), '');
  IF coalesce(array_length(v_reasons, 1), 0) = 0 OR NOT (v_reasons <@ v_allowed) THEN
    RAISE EXCEPTION 'not_only_price_variance' USING ERRCODE = 'P0001';
  END IF;

  IF p_expected_price_per_base_unit IS NULL OR p_expected_reference_price IS NULL
     OR round(v_line.price_per_base_unit, 4) <> round(p_expected_price_per_base_unit, 4)
     OR round(v_line.expected_price_per_base_unit, 4) <> round(p_expected_reference_price, 4) THEN
    RAISE EXCEPTION 'stale_line' USING ERRCODE = '40001';
  END IF;

  v_snapshot := jsonb_build_object(
    'raw_material_id', v_line.raw_material_id,
    'quantity', v_line.quantity,
    'unit', v_line.unit,
    'unit_price', v_line.unit_price,
    'total_amount', v_line.total_amount,
    'base_quantity', v_line.base_quantity,
    'package_size', v_line.package_size,
    'package_unit', v_line.package_unit,
    'count_per_package', v_line.count_per_package,
    'price_per_base_unit', round(v_line.price_per_base_unit, 4),
    'expected_price_per_base_unit', round(v_line.expected_price_per_base_unit, 4),
    'price_reference_source', v_line.price_reference_source,
    'price_reference_id', v_line.price_reference_id,
    'price_reference_date', v_line.price_reference_date,
    'price_variance_pct', v_line.price_variance_pct,
    'accepted_reasons', to_jsonb(v_reasons),
    'accepted_by', v_uid,
    'accepted_at', now()
  );

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

REVOKE ALL ON FUNCTION public.accept_invoice_line_price_variance(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invoice_line_price_variance(uuid, numeric, numeric) TO authenticated;