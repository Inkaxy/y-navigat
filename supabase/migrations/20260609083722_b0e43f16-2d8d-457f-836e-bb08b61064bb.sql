-- 1. Kolonne-fiks: line_total_excl_mva → line_subtotal_excl_mva
CREATE OR REPLACE FUNCTION public._pos_period_aggregate(
  p_terminal_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_totals jsonb;
  v_mva jsonb;
  v_payments jsonb;
  v_last_journal_id bigint;
  v_tx_count int;
  v_refund_count int;
  v_gross numeric(14,2);
  v_net numeric(14,2);
  v_mva_sum numeric(14,2);
  v_refund_total numeric(14,2);
BEGIN
  SELECT
    COALESCE(SUM(t.total_incl_mva), 0)::numeric(14,2),
    COALESCE(SUM(t.subtotal_excl_mva), 0)::numeric(14,2),
    COALESCE(SUM(t.total_mva), 0)::numeric(14,2),
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE t.transaction_type = 'return')::int,
    COALESCE(SUM(t.total_incl_mva) FILTER (WHERE t.transaction_type = 'return'), 0)::numeric(14,2)
  INTO v_gross, v_net, v_mva_sum, v_tx_count, v_refund_count, v_refund_total
  FROM public.pos_transactions t
  WHERE t.terminal_id = p_terminal_id
    AND t.created_at >= p_period_start
    AND t.created_at <  p_period_end
    AND t.is_training = false;

  v_totals := jsonb_build_object(
    'gross', v_gross,
    'net', v_net,
    'mva', v_mva_sum,
    'transaction_count', v_tx_count,
    'refund_count', v_refund_count,
    'refund_total', v_refund_total
  );

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('rate', rate, 'net', net_sum, 'vat', vat_sum, 'gross', gross_sum)
    ORDER BY rate
  ), '[]'::jsonb)
  INTO v_mva
  FROM (
    SELECT
      l.mva_rate AS rate,
      SUM(l.line_subtotal_excl_mva)::numeric(14,2) AS net_sum,
      SUM(l.line_mva)::numeric(14,2) AS vat_sum,
      SUM(l.line_total_incl_mva)::numeric(14,2) AS gross_sum
    FROM public.pos_transaction_lines l
    JOIN public.pos_transactions t ON t.id = l.transaction_id
    WHERE t.terminal_id = p_terminal_id
      AND t.created_at >= p_period_start
      AND t.created_at <  p_period_end
      AND t.is_training = false
    GROUP BY l.mva_rate
  ) g;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('method', method, 'amount', amt_sum, 'count', cnt)
    ORDER BY method
  ), '[]'::jsonb)
  INTO v_payments
  FROM (
    SELECT
      (p->>'method') AS method,
      SUM((p->>'amount')::numeric)::numeric(14,2) AS amt_sum,
      COUNT(DISTINCT t.id)::int AS cnt
    FROM public.pos_transactions t,
         LATERAL jsonb_array_elements(COALESCE(t.payment_summary->'payments', '[]'::jsonb)) AS p
    WHERE t.terminal_id = p_terminal_id
      AND t.created_at >= p_period_start
      AND t.created_at <  p_period_end
      AND t.is_training = false
    GROUP BY (p->>'method')
  ) pg;

  SELECT MAX(id) INTO v_last_journal_id
  FROM public.pos_journal_events
  WHERE terminal_id = p_terminal_id
    AND event_time >= p_period_start
    AND event_time <  p_period_end;

  RETURN jsonb_build_object(
    'totals', v_totals,
    'mva_breakdown', v_mva,
    'payment_breakdown', v_payments,
    'last_journal_id', v_last_journal_id
  );
END;
$function$;

-- 2. Helper-GRANT (intern, kun service_role)
REVOKE EXECUTE ON FUNCTION public._pos_period_aggregate(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._pos_period_aggregate(uuid, timestamptz, timestamptz) TO service_role;

-- 3. X-report (drop PUBLIC + anon, behold authenticated + service_role)
REVOKE EXECUTE ON FUNCTION public.pos_generate_x_report(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pos_generate_x_report(uuid) TO authenticated, service_role;

-- 4. Z-report
REVOKE EXECUTE ON FUNCTION public.pos_generate_z_report(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pos_generate_z_report(uuid, timestamptz, timestamptz) TO authenticated, service_role;

-- 5. pos_record_sale (har PUBLIC EXECUTE default — fjern + tigthen)
REVOKE EXECUTE ON FUNCTION public.pos_record_sale(uuid, jsonb, jsonb, text, text, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pos_record_sale(uuid, jsonb, jsonb, text, text, uuid, uuid, boolean) TO authenticated, service_role;