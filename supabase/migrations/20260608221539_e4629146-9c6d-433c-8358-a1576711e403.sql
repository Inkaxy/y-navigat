
CREATE OR REPLACE FUNCTION public.pos_record_sale(
  p_session_id uuid,
  p_lines jsonb,
  p_payment_summary jsonb,
  p_transaction_type text DEFAULT 'sale',
  p_dining_mode text DEFAULT 'takeaway',
  p_customer_id uuid DEFAULT NULL,
  p_reference_transaction_id uuid DEFAULT NULL,
  p_is_training boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_terminal_id uuid;
  v_operator_id uuid;
  v_session_status text;
  v_transaction_id uuid;
  v_receipt jsonb;
  v_receipt_number text;
  v_receipt_sequence bigint;
  v_line jsonb;
  v_line_number int := 0;
  v_subtotal_excl numeric(12,2) := 0;
  v_total_mva numeric(12,2) := 0;
  v_total_incl numeric(12,2) := 0;
  v_line_subtotal numeric(12,2);
  v_line_mva numeric(12,2);
  v_line_total numeric(12,2);
  v_qty numeric(12,3);
  v_unit_price numeric(12,2);
  v_discount numeric(12,2);
  v_mva_rate numeric(5,2);
  v_mva_breakdown jsonb := '[]'::jsonb;
  v_mva_agg jsonb;
  v_total_paid numeric(12,2);
  v_rounding numeric(12,2);
  v_payload jsonb;
  v_ref_type text;
  v_ref_terminal uuid;
BEGIN
  -- TODO: Endelig Kiosk-auth-modell vedtas i K.0
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'p_lines must be a non-empty JSON array' USING ERRCODE = '22023';
  END IF;
  IF p_payment_summary IS NULL OR jsonb_typeof(p_payment_summary) <> 'object' THEN
    RAISE EXCEPTION 'p_payment_summary must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF p_transaction_type NOT IN ('sale','return','correction','training') THEN
    RAISE EXCEPTION 'Invalid transaction_type: %', p_transaction_type USING ERRCODE = '22023';
  END IF;
  IF p_dining_mode NOT IN ('takeaway','eatin') THEN
    RAISE EXCEPTION 'Invalid dining_mode: %', p_dining_mode USING ERRCODE = '22023';
  END IF;

  SELECT terminal_id, operator_id, status
    INTO v_terminal_id, v_operator_id, v_session_status
  FROM public.pos_sessions WHERE id = p_session_id FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found: %', p_session_id USING ERRCODE = '23503';
  END IF;
  IF v_session_status <> 'open' THEN
    RAISE EXCEPTION 'Session is not open (status=%)', v_session_status USING ERRCODE = '22023';
  END IF;

  IF p_transaction_type IN ('return','correction') THEN
    IF p_reference_transaction_id IS NULL THEN
      RAISE EXCEPTION '% requires p_reference_transaction_id', p_transaction_type USING ERRCODE = '22023';
    END IF;
    SELECT transaction_type, terminal_id INTO v_ref_type, v_ref_terminal
    FROM public.pos_transactions WHERE id = p_reference_transaction_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reference transaction not found: %', p_reference_transaction_id USING ERRCODE = '23503';
    END IF;
    IF v_ref_type <> 'sale' THEN
      RAISE EXCEPTION 'Reference must be a sale (got %)', v_ref_type USING ERRCODE = '22023';
    END IF;
    IF v_ref_terminal <> v_terminal_id THEN
      RAISE EXCEPTION 'Reference must be on same terminal' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_reference_transaction_id IS NOT NULL THEN
      RAISE EXCEPTION '% must not have a reference transaction', p_transaction_type USING ERRCODE = '22023';
    END IF;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_number := v_line_number + 1;
    IF v_line->'product_snapshot' IS NULL OR jsonb_typeof(v_line->'product_snapshot') <> 'object' THEN
      RAISE EXCEPTION 'Line %: product_snapshot required (object)', v_line_number USING ERRCODE = '22023';
    END IF;
    v_qty := COALESCE((v_line->>'quantity')::numeric, 0);
    IF v_qty = 0 THEN
      RAISE EXCEPTION 'Line %: quantity must be non-zero', v_line_number USING ERRCODE = '22023';
    END IF;
    v_unit_price := COALESCE((v_line->>'unit_price_excl_mva')::numeric, 0);
    v_discount := COALESCE((v_line->>'line_discount')::numeric, 0);
    v_mva_rate := COALESCE((v_line->>'mva_rate')::numeric, -1);
    IF v_mva_rate NOT IN (0, 12, 15, 25) THEN
      RAISE EXCEPTION 'Line %: invalid mva_rate % (must be 0, 12, 15, or 25)', v_line_number, v_mva_rate USING ERRCODE = '22023';
    END IF;
    v_line_subtotal := ROUND(v_qty * v_unit_price - v_discount, 2);
    v_line_mva := ROUND(v_line_subtotal * v_mva_rate / 100.0, 2);
    v_line_total := v_line_subtotal + v_line_mva;
    v_subtotal_excl := v_subtotal_excl + v_line_subtotal;
    v_total_mva := v_total_mva + v_line_mva;
    v_total_incl := v_total_incl + v_line_total;
  END LOOP;

  SELECT jsonb_agg(jsonb_build_object(
    'rate', rate, 'base_excl_mva', base_excl,
    'mva_amount', mva_amt, 'total_incl_mva', base_excl + mva_amt
  ) ORDER BY rate)
  INTO v_mva_agg
  FROM (
    SELECT
      (l->>'mva_rate')::numeric AS rate,
      SUM(ROUND((l->>'quantity')::numeric * (l->>'unit_price_excl_mva')::numeric - COALESCE((l->>'line_discount')::numeric,0), 2)) AS base_excl,
      SUM(ROUND(ROUND((l->>'quantity')::numeric * (l->>'unit_price_excl_mva')::numeric - COALESCE((l->>'line_discount')::numeric,0), 2) * (l->>'mva_rate')::numeric / 100.0, 2)) AS mva_amt
    FROM jsonb_array_elements(p_lines) l
    GROUP BY (l->>'mva_rate')::numeric
  ) g;
  v_mva_breakdown := COALESCE(v_mva_agg, '[]'::jsonb);

  v_total_paid := COALESCE((p_payment_summary->>'total_paid')::numeric, 0);
  v_rounding := COALESCE((p_payment_summary->>'rounding')::numeric, 0);

  -- Rounding-semantikk: rounding = total_paid - total_incl_mva.
  --   > 0  = overpaid (kunde betalte mer enn netto)
  --   < 0  = øre-bortavrundet
  -- Toleranse ±0.01 for flytende-punkt-jitter.
  IF ABS((v_total_paid - v_rounding) - v_total_incl) > 0.01 THEN
    RAISE EXCEPTION 'Payment mismatch: total_paid=% rounding=% total_incl_mva=%',
      v_total_paid, v_rounding, v_total_incl USING ERRCODE = '22023';
  END IF;

  v_receipt := public.pos_next_receipt_number(v_terminal_id);
  v_receipt_number := v_receipt->>'receipt_number';
  v_receipt_sequence := (v_receipt->>'receipt_sequence')::bigint;

  INSERT INTO public.pos_transactions (
    session_id, terminal_id, operator_id,
    transaction_type, dining_mode, customer_id, reference_transaction_id,
    receipt_number, receipt_sequence,
    subtotal_excl_mva, total_mva, total_incl_mva, mva_breakdown,
    payment_summary, is_training
  ) VALUES (
    p_session_id, v_terminal_id, v_operator_id,
    p_transaction_type, p_dining_mode, p_customer_id, p_reference_transaction_id,
    v_receipt_number, v_receipt_sequence,
    v_subtotal_excl, v_total_mva, v_total_incl, v_mva_breakdown,
    p_payment_summary, p_is_training
  ) RETURNING id INTO v_transaction_id;

  v_line_number := 0;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_number := v_line_number + 1;
    v_qty := (v_line->>'quantity')::numeric;
    v_unit_price := (v_line->>'unit_price_excl_mva')::numeric;
    v_discount := COALESCE((v_line->>'line_discount')::numeric, 0);
    v_mva_rate := (v_line->>'mva_rate')::numeric;
    v_line_subtotal := ROUND(v_qty * v_unit_price - v_discount, 2);
    v_line_mva := ROUND(v_line_subtotal * v_mva_rate / 100.0, 2);
    v_line_total := v_line_subtotal + v_line_mva;

    INSERT INTO public.pos_transaction_lines (
      transaction_id, line_number, product_id, product_snapshot,
      quantity, unit_price_excl_mva, line_discount, mva_rate,
      line_subtotal_excl_mva, line_mva, line_total_incl_mva,
      dining_mode_override
    ) VALUES (
      v_transaction_id, v_line_number,
      NULLIF(v_line->>'product_id','')::uuid,
      v_line->'product_snapshot',
      v_qty, v_unit_price, v_discount, v_mva_rate,
      v_line_subtotal, v_line_mva, v_line_total,
      NULLIF(v_line->>'dining_mode_override','')
    );
  END LOOP;

  v_payload := jsonb_build_object(
    'receipt_number', v_receipt_number,
    'receipt_sequence', v_receipt_sequence,
    'transaction_type', p_transaction_type,
    'dining_mode', p_dining_mode,
    'subtotal_excl_mva', v_subtotal_excl,
    'total_mva', v_total_mva,
    'total_incl_mva', v_total_incl,
    'mva_breakdown', v_mva_breakdown,
    'payment_summary', p_payment_summary,
    'reference_transaction_id', p_reference_transaction_id,
    'is_training', p_is_training,
    'line_count', jsonb_array_length(p_lines)
  );

  INSERT INTO public.pos_journal_events (
    terminal_id, event_type, operator_id, session_id, transaction_id, payload
  ) VALUES (
    v_terminal_id, p_transaction_type, v_operator_id, p_session_id, v_transaction_id, v_payload
  );

  RETURN v_transaction_id;
END;
$$;
