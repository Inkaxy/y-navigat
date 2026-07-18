
-- 1) Grand total-tellere per terminal (aldri nullstilt)
ALTER TABLE public.pos_terminals
  ADD COLUMN IF NOT EXISTS grand_total_gross numeric(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grand_total_net numeric(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grand_total_returns numeric(16,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grand_total_tx_count bigint NOT NULL DEFAULT 0;

-- 2) Sesjonslåsing knyttet til Z-rapport
ALTER TABLE public.pos_sessions
  ADD COLUMN IF NOT EXISTS z_report_id uuid REFERENCES public.pos_z_reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_pos_sessions_z_report ON public.pos_sessions(z_report_id);

-- 3) Utvidede kolonner på Z-rapporter
ALTER TABLE public.pos_z_reports
  ADD COLUMN IF NOT EXISTS sale_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correction_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correction_total numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_total numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receipt_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receipt_copy_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS proforma_view_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drawer_open_outside_sale_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_receipt_number text,
  ADD COLUMN IF NOT EXISTS last_receipt_number text,
  ADD COLUMN IF NOT EXISTS grand_total_gross_after numeric(16,2),
  ADD COLUMN IF NOT EXISTS grand_total_returns_after numeric(16,2),
  ADD COLUMN IF NOT EXISTS grand_total_tx_count_after bigint,
  ADD COLUMN IF NOT EXISTS extras jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 4) Trigger: oppdater grand-total på kasse ved hver bokførte transaksjon
CREATE OR REPLACE FUNCTION public._pos_bump_terminal_grand_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_training THEN
    RETURN NEW;
  END IF;

  UPDATE public.pos_terminals
     SET grand_total_gross = grand_total_gross + COALESCE(NEW.total_incl_mva, 0),
         grand_total_net   = grand_total_net   + COALESCE(NEW.subtotal_excl_mva, 0),
         grand_total_returns = grand_total_returns +
           CASE WHEN NEW.transaction_type = 'return'
                THEN COALESCE(NEW.total_incl_mva, 0) ELSE 0 END,
         grand_total_tx_count = grand_total_tx_count + 1
   WHERE id = NEW.terminal_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pos_bump_grand_total ON public.pos_transactions;
CREATE TRIGGER trg_pos_bump_grand_total
AFTER INSERT ON public.pos_transactions
FOR EACH ROW EXECUTE FUNCTION public._pos_bump_terminal_grand_total();

-- 5) Nekt re-åpning av låst sesjon
CREATE OR REPLACE FUNCTION public._pos_prevent_unlock_session()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.z_report_id IS NOT NULL AND (
       NEW.z_report_id IS NULL
       OR NEW.status = 'open'
       OR NEW.locked_at IS NULL
     ) THEN
    RAISE EXCEPTION 'SESSION_LOCKED_BY_Z: sesjonen er låst av Z-rapport %', OLD.z_report_id
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pos_prevent_unlock_session ON public.pos_sessions;
CREATE TRIGGER trg_pos_prevent_unlock_session
BEFORE UPDATE ON public.pos_sessions
FOR EACH ROW EXECUTE FUNCTION public._pos_prevent_unlock_session();

-- 6) Utvidet aggregatfunksjon
CREATE OR REPLACE FUNCTION public._pos_period_aggregate(
  p_terminal_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_totals jsonb;
  v_mva jsonb;
  v_payments jsonb;
  v_last_journal_id bigint;
  v_tx_count int;
  v_sale_count int;
  v_refund_count int;
  v_correction_count int;
  v_gross numeric(14,2);
  v_net numeric(14,2);
  v_mva_sum numeric(14,2);
  v_refund_total numeric(14,2);
  v_correction_total numeric(14,2);
  v_first_receipt text;
  v_last_receipt text;
  v_receipt_count int;
  v_discount_count int;
  v_discount_total numeric(14,2);
  v_receipt_copy_count int := 0;
  v_proforma_view_count int := 0;
  v_drawer_open_outside_sale_count int := 0;
BEGIN
  SELECT
    COALESCE(SUM(t.total_incl_mva), 0)::numeric(14,2),
    COALESCE(SUM(t.subtotal_excl_mva), 0)::numeric(14,2),
    COALESCE(SUM(t.total_mva), 0)::numeric(14,2),
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE t.transaction_type = 'sale')::int,
    COUNT(*) FILTER (WHERE t.transaction_type = 'return')::int,
    COALESCE(SUM(t.total_incl_mva) FILTER (WHERE t.transaction_type = 'return'), 0)::numeric(14,2),
    COUNT(*) FILTER (WHERE t.transaction_type = 'correction')::int,
    COALESCE(SUM(t.total_incl_mva) FILTER (WHERE t.transaction_type = 'correction'), 0)::numeric(14,2),
    MIN(t.receipt_number),
    MAX(t.receipt_number),
    COUNT(*) FILTER (WHERE t.receipt_number IS NOT NULL)::int
  INTO v_gross, v_net, v_mva_sum, v_tx_count, v_sale_count, v_refund_count,
       v_refund_total, v_correction_count, v_correction_total,
       v_first_receipt, v_last_receipt, v_receipt_count
  FROM public.pos_transactions t
  WHERE t.terminal_id = p_terminal_id
    AND t.created_at >= p_period_start
    AND t.created_at <  p_period_end
    AND t.is_training = false;

  -- Rabatter aggregeres fra linjer
  SELECT
    COUNT(*) FILTER (WHERE COALESCE(l.line_discount,0) > 0)::int,
    COALESCE(SUM(l.line_discount) FILTER (WHERE l.line_discount > 0), 0)::numeric(14,2)
  INTO v_discount_count, v_discount_total
  FROM public.pos_transaction_lines l
  JOIN public.pos_transactions t ON t.id = l.transaction_id
  WHERE t.terminal_id = p_terminal_id
    AND t.created_at >= p_period_start
    AND t.created_at <  p_period_end
    AND t.is_training = false;

  v_totals := jsonb_build_object(
    'gross', v_gross,
    'net', v_net,
    'mva', v_mva_sum,
    'transaction_count', v_tx_count,
    'sale_count', v_sale_count,
    'refund_count', v_refund_count,
    'refund_total', v_refund_total,
    'correction_count', v_correction_count,
    'correction_total', v_correction_total,
    'discount_count', v_discount_count,
    'discount_total', v_discount_total,
    'receipt_count', v_receipt_count,
    'first_receipt_number', v_first_receipt,
    'last_receipt_number', v_last_receipt
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
      SUM(
        CASE WHEN t.transaction_type = 'return' THEN -(p->>'amount')::numeric
             ELSE (p->>'amount')::numeric END
      )::numeric(14,2) AS amt_sum,
      COUNT(DISTINCT t.id)::int AS cnt
    FROM public.pos_transactions t,
         LATERAL jsonb_array_elements(COALESCE(t.payment_summary->'payments', '[]'::jsonb)) AS p
    WHERE t.terminal_id = p_terminal_id
      AND t.created_at >= p_period_start
      AND t.created_at <  p_period_end
      AND t.is_training = false
    GROUP BY (p->>'method')
  ) pg;

  -- Journalbaserte tellere
  SELECT
    COUNT(*) FILTER (WHERE event_type = 'receipt_copy')::int,
    COUNT(*) FILTER (WHERE event_type = 'proforma_view')::int,
    COUNT(*) FILTER (WHERE event_type = 'drawer_open' AND transaction_id IS NULL)::int
  INTO v_receipt_copy_count, v_proforma_view_count, v_drawer_open_outside_sale_count
  FROM public.pos_journal_events
  WHERE terminal_id = p_terminal_id
    AND event_time >= p_period_start
    AND event_time <  p_period_end;

  SELECT MAX(id) INTO v_last_journal_id
  FROM public.pos_journal_events
  WHERE terminal_id = p_terminal_id
    AND event_time >= p_period_start
    AND event_time <  p_period_end;

  RETURN jsonb_build_object(
    'totals', v_totals,
    'mva_breakdown', v_mva,
    'payment_breakdown', v_payments,
    'journal_counts', jsonb_build_object(
      'receipt_copy', v_receipt_copy_count,
      'proforma_view', v_proforma_view_count,
      'drawer_open_outside_sale', v_drawer_open_outside_sale_count
    ),
    'last_journal_id', v_last_journal_id
  );
END;
$$;

-- 7) Utvidet X-rapport
CREATE OR REPLACE FUNCTION public.pos_generate_x_report(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
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

  SELECT t.id, t.terminal_code, t.display_name, t.legal_entity_id,
         t.grand_total_gross, t.grand_total_returns, t.grand_total_tx_count
    INTO v_terminal
  FROM public.pos_terminals t WHERE t.id = v_session.terminal_id;
  IF NOT public.has_position_in_entity(v_terminal.legal_entity_id) THEN
    RAISE EXCEPTION 'forbidden: no access to entity' USING ERRCODE = '42501';
  END IF;

  SELECT o.id, o.operator_code, o.display_name INTO v_operator
  FROM public.pos_operators o WHERE o.id = v_session.operator_id;

  v_agg := public._pos_period_aggregate(v_terminal.id, v_session.opened_at, v_period_end);

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
    'journal_counts', v_agg->'journal_counts',
    'cash_summary', jsonb_build_object(
      'opening_float', COALESCE(v_session.opening_float, 0),
      'cash_movement', v_cash_total,
      'expected_cash', v_expected_cash
    ),
    'grand_total', jsonb_build_object(
      'gross', v_terminal.grand_total_gross,
      'returns', v_terminal.grand_total_returns,
      'tx_count', v_terminal.grand_total_tx_count
    ),
    'last_journal_id', v_agg->'last_journal_id'
  );
END;
$$;

-- 8) Utvidet Z-rapport
CREATE OR REPLACE FUNCTION public.pos_generate_z_report(
  p_terminal_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_terminal record;
  v_z_number bigint;
  v_agg jsonb;
  v_totals jsonb;
  v_journal_counts jsonb;
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
  v_locked_sessions int := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end <= p_period_start THEN
    RAISE EXCEPTION 'invalid period: start=% end=%', p_period_start, p_period_end USING ERRCODE = 'P0001';
  END IF;

  SELECT t.id, t.terminal_code, t.legal_entity_id,
         t.grand_total_gross, t.grand_total_returns, t.grand_total_tx_count
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
  v_journal_counts := v_agg->'journal_counts';
  v_last_journal_id := COALESCE((v_agg->>'last_journal_id')::bigint, 0);

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
    v_variance_total::text, v_counted_total::text,
    v_terminal.grand_total_gross::text, v_terminal.grand_total_tx_count::text
  );
  v_hash := encode(extensions.digest(v_input, 'sha256'), 'hex');

  INSERT INTO public.pos_z_reports (
    terminal_id, z_number, period_start, period_end,
    total_sales_incl_mva, total_sales_excl_mva, total_mva,
    mva_breakdown, payment_breakdown,
    transaction_count, refund_count, refund_total,
    sale_count, correction_count, correction_total,
    discount_count, discount_total,
    receipt_count, receipt_copy_count,
    proforma_view_count, drawer_open_outside_sale_count,
    first_receipt_number, last_receipt_number,
    grand_total_gross_after, grand_total_returns_after, grand_total_tx_count_after,
    last_journal_id, report_hash,
    opening_float_total, closing_float_total, counted_cash_total,
    expected_cash_total, cash_variance_total,
    variance_flagged, variance_threshold, session_breakdown,
    extras
  ) VALUES (
    p_terminal_id, v_z_number, p_period_start, p_period_end,
    (v_totals->>'gross')::numeric(14,2),
    (v_totals->>'net')::numeric(14,2),
    (v_totals->>'mva')::numeric(14,2),
    v_agg->'mva_breakdown', v_agg->'payment_breakdown',
    (v_totals->>'transaction_count')::int,
    (v_totals->>'refund_count')::int,
    (v_totals->>'refund_total')::numeric(14,2),
    (v_totals->>'sale_count')::int,
    (v_totals->>'correction_count')::int,
    (v_totals->>'correction_total')::numeric(14,2),
    (v_totals->>'discount_count')::int,
    (v_totals->>'discount_total')::numeric(14,2),
    (v_totals->>'receipt_count')::int,
    COALESCE((v_journal_counts->>'receipt_copy')::int, 0),
    COALESCE((v_journal_counts->>'proforma_view')::int, 0),
    COALESCE((v_journal_counts->>'drawer_open_outside_sale')::int, 0),
    v_totals->>'first_receipt_number',
    v_totals->>'last_receipt_number',
    v_terminal.grand_total_gross,
    v_terminal.grand_total_returns,
    v_terminal.grand_total_tx_count,
    COALESCE(v_last_journal_id, 0), v_hash,
    v_opening_total, v_closing_total, v_counted_total,
    v_expected_total, v_variance_total,
    v_flagged, v_threshold, v_session_breakdown,
    jsonb_build_object('generated_by', v_user)
  ) RETURNING id INTO v_z_id;

  -- Lås alle lukkede sesjoner i perioden til denne Z-rapporten
  UPDATE public.pos_sessions
     SET z_report_id = v_z_id,
         locked_at = now()
   WHERE terminal_id = p_terminal_id
     AND status = 'closed'
     AND closed_at >= p_period_start
     AND closed_at <  p_period_end
     AND z_report_id IS NULL;
  GET DIAGNOSTICS v_locked_sessions = ROW_COUNT;

  INSERT INTO public.pos_journal_events (terminal_id, event_type, payload)
  VALUES (
    p_terminal_id, 'z_report',
    jsonb_build_object(
      'z_id', v_z_id, 'z_number', v_z_number,
      'period_start', p_period_start, 'period_end', p_period_end,
      'terminal_id', p_terminal_id, 'totals', v_totals,
      'cash_variance_total', v_variance_total,
      'variance_flagged', v_flagged,
      'sessions_locked', v_locked_sessions,
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
$$;

-- 9) Nødvendig: la 'z_report' være tillatt event-type på journal (uendret) — allerede i CHECK i tabellen, ingen aksjon.

-- 10) Bakoverfylle grand_total for eksisterende data
UPDATE public.pos_terminals t
SET grand_total_gross = COALESCE(agg.gross, 0),
    grand_total_net = COALESCE(agg.net, 0),
    grand_total_returns = COALESCE(agg.returns, 0),
    grand_total_tx_count = COALESCE(agg.cnt, 0)
FROM (
  SELECT terminal_id,
         SUM(total_incl_mva) AS gross,
         SUM(subtotal_excl_mva) AS net,
         SUM(total_incl_mva) FILTER (WHERE transaction_type='return') AS returns,
         COUNT(*) AS cnt
  FROM public.pos_transactions
  WHERE is_training = false
  GROUP BY terminal_id
) agg
WHERE t.id = agg.terminal_id;
