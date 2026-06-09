CREATE OR REPLACE FUNCTION public.pos_generate_x_report(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_session record;
  v_terminal record;
  v_operator record;
  v_agg jsonb;
  v_period_end timestamptz := now();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  SELECT s.id, s.terminal_id, s.operator_id, s.session_number, s.opened_at, s.status
  INTO v_session
  FROM public.pos_sessions s
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'X-report requires open session (status=%)', v_session.status USING ERRCODE = 'P0001';
  END IF;

  SELECT t.id, t.terminal_code, t.display_name, t.legal_entity_id
  INTO v_terminal
  FROM public.pos_terminals t
  WHERE t.id = v_session.terminal_id;

  IF NOT public.has_position_in_entity(v_terminal.legal_entity_id) THEN
    RAISE EXCEPTION 'forbidden: no access to entity' USING ERRCODE = '42501';
  END IF;

  SELECT o.id, o.operator_code, o.display_name
  INTO v_operator
  FROM public.pos_operators o
  WHERE o.id = v_session.operator_id;

  v_agg := public._pos_period_aggregate(v_terminal.id, v_session.opened_at, v_period_end);

  RETURN jsonb_build_object(
    'report_type', 'x',
    'session_id', v_session.id,
    'session_number', v_session.session_number,
    'terminal_id', v_terminal.id,
    'terminal_code', v_terminal.terminal_code,
    'terminal_name', v_terminal.display_name,
    'operator_id', v_operator.id,
    'operator_code', v_operator.operator_code,
    'operator_name', v_operator.display_name,
    'period_start', v_session.opened_at,
    'period_end', v_period_end,
    'generated_at', v_period_end,
    'totals', v_agg->'totals',
    'mva_breakdown', v_agg->'mva_breakdown',
    'payment_breakdown', v_agg->'payment_breakdown',
    'last_journal_id', v_agg->'last_journal_id'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.pos_generate_z_report(
  p_terminal_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_terminal record;
  v_z_number bigint;
  v_agg jsonb;
  v_totals jsonb;
  v_last_journal_id bigint;
  v_input text;
  v_hash text;
  v_z_id uuid;
  v_open_count int;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end <= p_period_start THEN
    RAISE EXCEPTION 'invalid period: start=% end=%', p_period_start, p_period_end USING ERRCODE = 'P0001';
  END IF;

  SELECT t.id, t.terminal_code, t.legal_entity_id
  INTO v_terminal
  FROM public.pos_terminals t
  WHERE t.id = p_terminal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'terminal not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.has_position_in_entity(v_terminal.legal_entity_id) THEN
    RAISE EXCEPTION 'forbidden: no access to entity' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_open_count
  FROM public.pos_sessions s
  WHERE s.terminal_id = p_terminal_id
    AND s.status = 'open'
    AND s.opened_at < p_period_end;

  IF v_open_count > 0 THEN
    RAISE EXCEPTION 'cannot generate Z-report: % open session(s) overlap period', v_open_count USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pos_terminals
  SET next_z_number = next_z_number + 1
  WHERE id = p_terminal_id
  RETURNING next_z_number - 1 INTO v_z_number;

  v_agg := public._pos_period_aggregate(p_terminal_id, p_period_start, p_period_end);
  v_totals := v_agg->'totals';
  v_last_journal_id := COALESCE((v_agg->>'last_journal_id')::bigint, 0);

  v_input := concat_ws('|',
    p_terminal_id::text,
    v_z_number::text,
    p_period_start::text,
    p_period_end::text,
    (v_totals->>'gross'),
    (v_totals->>'net'),
    (v_totals->>'mva'),
    (v_totals->>'transaction_count'),
    (v_totals->>'refund_count'),
    (v_totals->>'refund_total'),
    v_last_journal_id::text,
    (v_agg->'mva_breakdown')::text,
    (v_agg->'payment_breakdown')::text
  );

  v_hash := encode(extensions.digest(v_input, 'sha256'), 'hex');

  INSERT INTO public.pos_z_reports (
    terminal_id, z_number, period_start, period_end,
    total_sales_incl_mva, total_sales_excl_mva, total_mva,
    mva_breakdown, payment_breakdown,
    transaction_count, refund_count, refund_total,
    last_journal_id, report_hash
  ) VALUES (
    p_terminal_id, v_z_number, p_period_start, p_period_end,
    (v_totals->>'gross')::numeric(14,2),
    (v_totals->>'net')::numeric(14,2),
    (v_totals->>'mva')::numeric(14,2),
    v_agg->'mva_breakdown',
    v_agg->'payment_breakdown',
    (v_totals->>'transaction_count')::int,
    (v_totals->>'refund_count')::int,
    (v_totals->>'refund_total')::numeric(14,2),
    COALESCE(v_last_journal_id, 0),
    v_hash
  )
  RETURNING id INTO v_z_id;

  INSERT INTO public.pos_journal_events (terminal_id, event_type, payload)
  VALUES (
    p_terminal_id,
    'z_report',
    jsonb_build_object(
      'z_id', v_z_id,
      'z_number', v_z_number,
      'period_start', p_period_start,
      'period_end', p_period_end,
      'terminal_id', p_terminal_id,
      'totals', v_totals,
      'report_hash', v_hash
    )
  );

  RETURN v_z_id;
END;
$function$;

-- Re-grant (CREATE OR REPLACE preserves ACL men vi forsikrer)
REVOKE EXECUTE ON FUNCTION public.pos_generate_x_report(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pos_generate_x_report(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.pos_generate_z_report(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pos_generate_z_report(uuid, timestamptz, timestamptz) TO authenticated, service_role;