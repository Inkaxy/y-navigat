
-- =========================================================
-- 1) Skuffstatus per terminal
-- =========================================================
ALTER TABLE public.pos_terminals
  ADD COLUMN IF NOT EXISTS drawer_is_open boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS drawer_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS drawer_opened_reason text,
  ADD COLUMN IF NOT EXISTS drawer_opened_operator_id uuid;

-- =========================================================
-- 2) Utvid pos_journal_append med drawer_close + cash_variance_alert
-- =========================================================
CREATE OR REPLACE FUNCTION public.pos_journal_append(
  p_terminal_id uuid,
  p_event_type text,
  p_operator_id uuid DEFAULT NULL,
  p_session_id uuid DEFAULT NULL,
  p_transaction_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id bigint;
  v_le uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;
  IF p_event_type NOT IN (
    'operator_logout','drawer_open','drawer_close','proforma_view',
    'discount_applied','line_correction','error',
    'receipt_delivered','receipt_printed','receipt_copy',
    'cash_variance_alert'
  ) THEN
    RAISE EXCEPTION 'invalid event_type: %', p_event_type USING ERRCODE = '22023';
  END IF;

  SELECT legal_entity_id INTO v_le FROM public.pos_terminals WHERE id = p_terminal_id;
  IF v_le IS NULL THEN
    RAISE EXCEPTION 'terminal not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.has_position_in_entity(v_le) OR public.is_kiosk_user()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.pos_journal_events (
    terminal_id, event_type, operator_id, session_id, transaction_id, payload
  ) VALUES (
    p_terminal_id, p_event_type, p_operator_id, p_session_id, p_transaction_id,
    COALESCE(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- =========================================================
-- 3) pos_open_drawer (nødåpning m/grunn) og pos_close_drawer
-- =========================================================
CREATE OR REPLACE FUNCTION public.pos_open_drawer(
  p_terminal_id uuid,
  p_operator_id uuid,
  p_session_id uuid,
  p_reason text,
  p_context text DEFAULT 'manual'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_le uuid;
  v_id bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'DRAWER_REASON_REQUIRED: grunn må oppgis (minst 3 tegn)'
      USING ERRCODE = '22023';
  END IF;

  SELECT legal_entity_id INTO v_le FROM public.pos_terminals WHERE id = p_terminal_id;
  IF v_le IS NULL THEN
    RAISE EXCEPTION 'terminal not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.has_position_in_entity(v_le) OR public.is_kiosk_user()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.pos_terminals
     SET drawer_is_open = true,
         drawer_opened_at = now(),
         drawer_opened_reason = btrim(p_reason),
         drawer_opened_operator_id = p_operator_id
   WHERE id = p_terminal_id;

  INSERT INTO public.pos_journal_events(
    terminal_id, event_type, operator_id, session_id, payload
  ) VALUES (
    p_terminal_id, 'drawer_open', p_operator_id, p_session_id,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'context', COALESCE(p_context, 'manual'),
      'opened_at', now()
    )
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pos_open_drawer(uuid,uuid,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_open_drawer(uuid,uuid,uuid,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pos_close_drawer(
  p_terminal_id uuid,
  p_operator_id uuid DEFAULT NULL,
  p_session_id uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_le uuid;
  v_id bigint;
  v_opened_at timestamptz;
  v_reason text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  SELECT legal_entity_id, drawer_opened_at, drawer_opened_reason
    INTO v_le, v_opened_at, v_reason
  FROM public.pos_terminals WHERE id = p_terminal_id FOR UPDATE;
  IF v_le IS NULL THEN
    RAISE EXCEPTION 'terminal not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.has_position_in_entity(v_le) OR public.is_kiosk_user()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.pos_terminals
     SET drawer_is_open = false,
         drawer_opened_at = NULL,
         drawer_opened_reason = NULL,
         drawer_opened_operator_id = NULL
   WHERE id = p_terminal_id;

  INSERT INTO public.pos_journal_events(
    terminal_id, event_type, operator_id, session_id, payload
  ) VALUES (
    p_terminal_id, 'drawer_close', p_operator_id, p_session_id,
    jsonb_build_object(
      'opened_at', v_opened_at,
      'closed_at', now(),
      'opened_reason', v_reason,
      'duration_seconds', EXTRACT(EPOCH FROM (now() - COALESCE(v_opened_at, now())))
    )
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pos_close_drawer(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_close_drawer(uuid,uuid,uuid) TO authenticated, service_role;

-- =========================================================
-- 4) Trigger: blokker salg mens skuffen står åpen
-- =========================================================
CREATE OR REPLACE FUNCTION public._pos_block_sale_while_drawer_open()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_open boolean;
BEGIN
  SELECT drawer_is_open INTO v_open
  FROM public.pos_terminals
  WHERE id = NEW.terminal_id;

  IF COALESCE(v_open, false) THEN
    RAISE EXCEPTION 'DRAWER_OPEN: Lukk skuffen for å fortsette'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_transactions_block_when_drawer_open ON public.pos_transactions;
CREATE TRIGGER pos_transactions_block_when_drawer_open
  BEFORE INSERT ON public.pos_transactions
  FOR EACH ROW EXECUTE FUNCTION public._pos_block_sale_while_drawer_open();

-- =========================================================
-- 5) Trigger: auto-åpne skuff etter kontant-salg
-- =========================================================
CREATE OR REPLACE FUNCTION public._pos_auto_open_drawer_on_cash_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_has_cash boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      COALESCE(NEW.payment_summary->'payments', '[]'::jsonb)
    ) AS p WHERE p->>'method' = 'cash'
  ) INTO v_has_cash;

  IF v_has_cash THEN
    UPDATE public.pos_terminals
       SET drawer_is_open = true,
           drawer_opened_at = now(),
           drawer_opened_reason = CASE NEW.transaction_type
             WHEN 'return' THEN 'cash_return'
             ELSE 'cash_sale' END,
           drawer_opened_operator_id = (
             SELECT operator_id FROM public.pos_sessions WHERE id = NEW.session_id
           )
     WHERE id = NEW.terminal_id;

    INSERT INTO public.pos_journal_events(
      terminal_id, event_type, session_id, transaction_id, payload
    ) VALUES (
      NEW.terminal_id, 'drawer_open', NEW.session_id, NEW.id,
      jsonb_build_object(
        'reason', CASE NEW.transaction_type WHEN 'return' THEN 'cash_return' ELSE 'cash_sale' END,
        'context', 'auto',
        'transaction_type', NEW.transaction_type
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_transactions_auto_open_drawer ON public.pos_transactions;
CREATE TRIGGER pos_transactions_auto_open_drawer
  AFTER INSERT ON public.pos_transactions
  FOR EACH ROW EXECUTE FUNCTION public._pos_auto_open_drawer_on_cash_sale();

-- =========================================================
-- 6) pos_z_reports: kolonner for vekslekasse + avvik
-- =========================================================
ALTER TABLE public.pos_z_reports
  ADD COLUMN IF NOT EXISTS opening_float_total numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closing_float_total numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS counted_cash_total  numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_cash_total numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_variance_total numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variance_flagged    boolean       DEFAULT false,
  ADD COLUMN IF NOT EXISTS variance_threshold  numeric(14,2),
  ADD COLUMN IF NOT EXISTS session_breakdown   jsonb         DEFAULT '[]'::jsonb;

-- =========================================================
-- 7) pos_generate_z_report — aggregér vekslekasse + flagge avvik
-- =========================================================
CREATE OR REPLACE FUNCTION public.pos_generate_z_report(
  p_terminal_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
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
  v_opening_total numeric := 0;
  v_closing_total numeric := 0;
  v_counted_total numeric := 0;
  v_expected_total numeric := 0;
  v_variance_total numeric := 0;
  v_threshold numeric := 100;
  v_flagged boolean := false;
  v_session_breakdown jsonb := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end <= p_period_start THEN
    RAISE EXCEPTION 'invalid period: start=% end=%', p_period_start, p_period_end USING ERRCODE = 'P0001';
  END IF;

  SELECT t.id, t.terminal_code, t.legal_entity_id
    INTO v_terminal
  FROM public.pos_terminals t WHERE t.id = p_terminal_id;
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

  -- Terskel fra platform_settings (default 100 kr)
  SELECT COALESCE(NULLIF(value->>'value',''), value#>>'{}')::numeric
    INTO v_threshold
  FROM public.platform_settings
  WHERE key = 'pos.cash_variance_threshold'
  LIMIT 1;
  v_threshold := COALESCE(v_threshold, 100);

  UPDATE public.pos_terminals
     SET next_z_number = next_z_number + 1
   WHERE id = p_terminal_id
  RETURNING next_z_number - 1 INTO v_z_number;

  v_agg := public._pos_period_aggregate(p_terminal_id, p_period_start, p_period_end);
  v_totals := v_agg->'totals';
  v_last_journal_id := COALESCE((v_agg->>'last_journal_id')::bigint, 0);

  -- Aggregér vekslekasse over lukkede sesjoner i perioden
  SELECT
    COALESCE(SUM(opening_float), 0),
    COALESCE(SUM(closing_float), 0),
    COALESCE(SUM(counted_cash), 0),
    COALESCE(SUM(expected_cash), 0),
    COALESCE(SUM(counted_cash - expected_cash), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'session_id', id,
      'session_number', session_number,
      'operator_id', operator_id,
      'opening_float', opening_float,
      'closing_float', closing_float,
      'counted_cash', counted_cash,
      'expected_cash', expected_cash,
      'cash_variance', counted_cash - expected_cash,
      'opened_at', opened_at,
      'closed_at', closed_at
    ) ORDER BY opened_at), '[]'::jsonb)
    INTO v_opening_total, v_closing_total, v_counted_total,
         v_expected_total, v_variance_total, v_session_breakdown
  FROM public.pos_sessions
  WHERE terminal_id = p_terminal_id
    AND status = 'closed'
    AND closed_at >= p_period_start
    AND closed_at <  p_period_end;

  v_flagged := ABS(COALESCE(v_variance_total, 0)) > v_threshold;

  v_input := concat_ws('|',
    p_terminal_id::text, v_z_number::text,
    p_period_start::text, p_period_end::text,
    (v_totals->>'gross'), (v_totals->>'net'), (v_totals->>'mva'),
    (v_totals->>'transaction_count'), (v_totals->>'refund_count'),
    (v_totals->>'refund_total'), v_last_journal_id::text,
    (v_agg->'mva_breakdown')::text, (v_agg->'payment_breakdown')::text,
    v_variance_total::text, v_counted_total::text
  );
  v_hash := encode(extensions.digest(v_input, 'sha256'), 'hex');

  INSERT INTO public.pos_z_reports (
    terminal_id, z_number, period_start, period_end,
    total_sales_incl_mva, total_sales_excl_mva, total_mva,
    mva_breakdown, payment_breakdown,
    transaction_count, refund_count, refund_total,
    last_journal_id, report_hash,
    opening_float_total, closing_float_total, counted_cash_total,
    expected_cash_total, cash_variance_total,
    variance_flagged, variance_threshold, session_breakdown
  ) VALUES (
    p_terminal_id, v_z_number, p_period_start, p_period_end,
    (v_totals->>'gross')::numeric(14,2),
    (v_totals->>'net')::numeric(14,2),
    (v_totals->>'mva')::numeric(14,2),
    v_agg->'mva_breakdown', v_agg->'payment_breakdown',
    (v_totals->>'transaction_count')::int,
    (v_totals->>'refund_count')::int,
    (v_totals->>'refund_total')::numeric(14,2),
    COALESCE(v_last_journal_id, 0), v_hash,
    v_opening_total, v_closing_total, v_counted_total,
    v_expected_total, v_variance_total,
    v_flagged, v_threshold, v_session_breakdown
  ) RETURNING id INTO v_z_id;

  INSERT INTO public.pos_journal_events (terminal_id, event_type, payload)
  VALUES (
    p_terminal_id, 'z_report',
    jsonb_build_object(
      'z_id', v_z_id, 'z_number', v_z_number,
      'period_start', p_period_start, 'period_end', p_period_end,
      'terminal_id', p_terminal_id, 'totals', v_totals,
      'cash_variance_total', v_variance_total,
      'variance_flagged', v_flagged,
      'report_hash', v_hash
    )
  );

  IF v_flagged THEN
    INSERT INTO public.pos_journal_events (terminal_id, event_type, payload)
    VALUES (
      p_terminal_id, 'cash_variance_alert',
      jsonb_build_object(
        'z_id', v_z_id, 'z_number', v_z_number,
        'variance', v_variance_total,
        'threshold', v_threshold,
        'expected_cash', v_expected_total,
        'counted_cash', v_counted_total,
        'period_start', p_period_start, 'period_end', p_period_end
      )
    );
  END IF;

  RETURN v_z_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.pos_generate_z_report(uuid,timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pos_generate_z_report(uuid,timestamptz,timestamptz) TO authenticated, service_role;

-- =========================================================
-- 8) pos_generate_x_report — inkluder vekslekasse for åpen sesjon
-- =========================================================
CREATE OR REPLACE FUNCTION public.pos_generate_x_report(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_session record;
  v_terminal record;
  v_operator record;
  v_agg jsonb;
  v_period_end timestamptz := now();
  v_cash_total numeric := 0;
  v_expected_cash numeric := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  SELECT s.id, s.terminal_id, s.operator_id, s.session_number, s.opened_at, s.status, s.opening_float
    INTO v_session
  FROM public.pos_sessions s WHERE s.id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'X-report requires open session (status=%)', v_session.status USING ERRCODE = 'P0001';
  END IF;

  SELECT t.id, t.terminal_code, t.display_name, t.legal_entity_id
    INTO v_terminal
  FROM public.pos_terminals t WHERE t.id = v_session.terminal_id;
  IF NOT public.has_position_in_entity(v_terminal.legal_entity_id) THEN
    RAISE EXCEPTION 'forbidden: no access to entity' USING ERRCODE = '42501';
  END IF;

  SELECT o.id, o.operator_code, o.display_name INTO v_operator
  FROM public.pos_operators o WHERE o.id = v_session.operator_id;

  v_agg := public._pos_period_aggregate(v_terminal.id, v_session.opened_at, v_period_end);

  -- Kontantbevegelser (samme logikk som pos_close_session)
  SELECT COALESCE(SUM(
    CASE WHEN tx.transaction_type = 'return' THEN -(pmt->>'amount')::numeric
         ELSE (pmt->>'amount')::numeric END), 0)
    INTO v_cash_total
  FROM public.pos_transactions tx
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(tx.payment_summary->'payments', '[]'::jsonb)
  ) pmt
  WHERE tx.session_id = v_session.id
    AND tx.is_training = false
    AND pmt->>'method' = 'cash';

  v_expected_cash := COALESCE(v_session.opening_float, 0) + v_cash_total;

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
    'cash_summary', jsonb_build_object(
      'opening_float', COALESCE(v_session.opening_float, 0),
      'cash_movement', v_cash_total,
      'expected_cash', v_expected_cash
    ),
    'last_journal_id', v_agg->'last_journal_id'
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.pos_generate_x_report(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pos_generate_x_report(uuid) TO authenticated, service_role;

-- =========================================================
-- 9) Default terskel + realtime for pos_terminals
-- =========================================================
INSERT INTO public.platform_settings (key, value, category)
VALUES ('pos.cash_variance_threshold',
        jsonb_build_object('value', 100, 'unit', 'NOK'),
        'pos')
ON CONFLICT (key) DO NOTHING;

ALTER PUBLICATION supabase_realtime ADD TABLE public.pos_terminals;
