
-- ============================================================
-- F2-DB.3 — Kiosk-tilgangsmodell + pos_open_session/pos_close_session
-- ============================================================

-- Step 1: DROP eksisterende 2-args stub
DROP FUNCTION IF EXISTS public.pos_close_session(uuid, numeric);

-- Step 2: pos_kiosk_users markør-tabell
CREATE TABLE IF NOT EXISTS public.pos_kiosk_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pos_kiosk_users TO authenticated;
GRANT ALL ON public.pos_kiosk_users TO service_role;

ALTER TABLE public.pos_kiosk_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_kiosk_users_self_select ON public.pos_kiosk_users;
CREATE POLICY pos_kiosk_users_self_select ON public.pos_kiosk_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS pos_kiosk_users_admin_all ON public.pos_kiosk_users;
CREATE POLICY pos_kiosk_users_admin_all ON public.pos_kiosk_users
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Step 3: is_kiosk_user() helper
CREATE OR REPLACE FUNCTION public.is_kiosk_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pos_kiosk_users WHERE user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_kiosk_user() TO authenticated;

-- Step 4: Utvid 11 SELECT-policies med OR public.is_kiosk_user()

-- 4.1 pos_terminals
DROP POLICY IF EXISTS pos_terminals_select ON public.pos_terminals;
CREATE POLICY pos_terminals_select ON public.pos_terminals
  FOR SELECT TO authenticated
  USING (has_position_in_entity(legal_entity_id) OR is_platform_admin() OR public.is_kiosk_user());

-- 4.2 pos_sessions
DROP POLICY IF EXISTS pos_sessions_select ON public.pos_sessions;
CREATE POLICY pos_sessions_select ON public.pos_sessions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM pos_terminals t
    WHERE t.id = pos_sessions.terminal_id
      AND (has_position_in_entity(t.legal_entity_id) OR is_platform_admin() OR public.is_kiosk_user())
  ));

-- 4.3 pos_transactions
DROP POLICY IF EXISTS pos_transactions_select ON public.pos_transactions;
CREATE POLICY pos_transactions_select ON public.pos_transactions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM pos_terminals t
    WHERE t.id = pos_transactions.terminal_id
      AND (has_position_in_entity(t.legal_entity_id) OR is_platform_admin() OR public.is_kiosk_user())
  ));

-- 4.4 pos_transaction_lines
DROP POLICY IF EXISTS pos_tx_lines_select ON public.pos_transaction_lines;
CREATE POLICY pos_tx_lines_select ON public.pos_transaction_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM pos_transactions tx
      JOIN pos_terminals t ON t.id = tx.terminal_id
    WHERE tx.id = pos_transaction_lines.transaction_id
      AND (has_position_in_entity(t.legal_entity_id) OR is_platform_admin() OR public.is_kiosk_user())
  ));

-- 4.5 pos_journal_events
DROP POLICY IF EXISTS pos_journal_select ON public.pos_journal_events;
CREATE POLICY pos_journal_select ON public.pos_journal_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM pos_terminals t
    WHERE t.id = pos_journal_events.terminal_id
      AND (has_position_in_entity(t.legal_entity_id) OR is_platform_admin() OR public.is_kiosk_user())
  ));

-- 4.6 pos_keypad_layouts
DROP POLICY IF EXISTS pos_keypad_layouts_select ON public.pos_keypad_layouts;
CREATE POLICY pos_keypad_layouts_select ON public.pos_keypad_layouts
  FOR SELECT TO authenticated
  USING (has_position_in_entity(legal_entity_id) OR is_platform_admin() OR public.is_kiosk_user());

-- 4.7 pos_keypad_pages
DROP POLICY IF EXISTS pos_keypad_pages_select ON public.pos_keypad_pages;
CREATE POLICY pos_keypad_pages_select ON public.pos_keypad_pages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM pos_keypad_layouts l
    WHERE l.id = pos_keypad_pages.layout_id
      AND (has_position_in_entity(l.legal_entity_id) OR is_platform_admin() OR public.is_kiosk_user())
  ));

-- 4.8 pos_keypad_buttons
DROP POLICY IF EXISTS pos_keypad_buttons_select ON public.pos_keypad_buttons;
CREATE POLICY pos_keypad_buttons_select ON public.pos_keypad_buttons
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM pos_keypad_pages pg
      JOIN pos_keypad_layouts l ON l.id = pg.layout_id
    WHERE pg.id = pos_keypad_buttons.page_id
      AND (has_position_in_entity(l.legal_entity_id) OR is_platform_admin() OR public.is_kiosk_user())
  ));

-- 4.9 pos_product_images
DROP POLICY IF EXISTS pos_product_images_select ON public.pos_product_images;
CREATE POLICY pos_product_images_select ON public.pos_product_images
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM products p
    WHERE p.id = pos_product_images.product_id
      AND (has_position_in_entity(p.legal_entity_id) OR public.is_kiosk_user())
  ));

-- 4.10 pos_operators
DROP POLICY IF EXISTS pos_operators_select ON public.pos_operators;
CREATE POLICY pos_operators_select ON public.pos_operators
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR (has_position_in_entity(legal_entity_id) AND app_access_level('pos_styring'::text) <> 'none'::access_level)
    OR public.is_kiosk_user()
  );

-- 4.11 pos_operator_terminals
DROP POLICY IF EXISTS pos_op_term_select ON public.pos_operator_terminals;
CREATE POLICY pos_op_term_select ON public.pos_operator_terminals
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM pos_operators o
    WHERE o.id = pos_operator_terminals.operator_id
      AND (has_position_in_entity(o.legal_entity_id) OR is_platform_admin() OR public.is_kiosk_user())
  ));

-- ============================================================
-- Step 5: pos_open_session
-- ============================================================
CREATE OR REPLACE FUNCTION public.pos_open_session(
  p_terminal_id uuid,
  p_operator_id uuid,
  p_opening_float numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session_id uuid;
  v_session_number bigint;
  v_terminal_status text;
  v_operator_le uuid;
  v_terminal_le uuid;
  v_can_use boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: må være innlogget' USING ERRCODE = '42501';
  END IF;

  IF p_opening_float IS NULL OR p_opening_float < 0 THEN
    RAISE EXCEPTION 'INVALID_OPENING_FLOAT: opening_float må være >= 0' USING ERRCODE = '22023';
  END IF;

  -- Lås terminal-rad
  SELECT status, legal_entity_id, next_session_number
    INTO v_terminal_status, v_terminal_le, v_session_number
  FROM public.pos_terminals
  WHERE id = p_terminal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TERMINAL_NOT_FOUND: %', p_terminal_id USING ERRCODE = 'P0002';
  END IF;

  IF v_terminal_status <> 'active' THEN
    RAISE EXCEPTION 'TERMINAL_INACTIVE: status=%', v_terminal_status USING ERRCODE = '22023';
  END IF;

  -- Sjekk at det ikke er noen åpen sesjon på denne terminalen
  IF EXISTS (
    SELECT 1 FROM public.pos_sessions
    WHERE terminal_id = p_terminal_id AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'SESSION_ALREADY_OPEN: terminalen har allerede en åpen sesjon' USING ERRCODE = '23505';
  END IF;

  -- Sjekk operator + terminal-tilknytning
  SELECT o.legal_entity_id INTO v_operator_le
  FROM public.pos_operators o
  WHERE o.id = p_operator_id AND o.status = 'active';

  IF v_operator_le IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_NOT_FOUND_OR_INACTIVE: %', p_operator_id USING ERRCODE = 'P0002';
  END IF;

  IF v_operator_le <> v_terminal_le THEN
    RAISE EXCEPTION 'OPERATOR_WRONG_ENTITY: operator tilhører ikke samme virksomhet som terminal' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.pos_operator_terminals
    WHERE operator_id = p_operator_id AND terminal_id = p_terminal_id
  ) INTO v_can_use;

  IF NOT v_can_use THEN
    RAISE EXCEPTION 'OPERATOR_NOT_LINKED_TO_TERMINAL' USING ERRCODE = '42501';
  END IF;

  -- Inkrementer next_session_number
  UPDATE public.pos_terminals
  SET next_session_number = next_session_number + 1,
      updated_at = now()
  WHERE id = p_terminal_id;

  -- Opprett sesjon
  INSERT INTO public.pos_sessions (
    terminal_id, operator_id, session_number, opening_float, status
  ) VALUES (
    p_terminal_id, p_operator_id, v_session_number, p_opening_float, 'open'
  )
  RETURNING id INTO v_session_id;

  -- Journal-event
  INSERT INTO public.pos_journal_events (
    terminal_id, event_type, operator_id, session_id, payload
  ) VALUES (
    p_terminal_id,
    'session_open',
    p_operator_id,
    v_session_id,
    jsonb_build_object(
      'session_number', v_session_number,
      'opening_float', p_opening_float
    )
  );

  RETURN v_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_open_session(uuid, uuid, numeric) TO authenticated;

-- ============================================================
-- Step 6: pos_close_session (3 args) — fixet cash-aritmetikk
-- ============================================================
CREATE OR REPLACE FUNCTION public.pos_close_session(
  p_session_id uuid,
  p_closing_float numeric,
  p_counted_cash numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_terminal_id uuid;
  v_operator_id uuid;
  v_opening_float numeric;
  v_status text;
  v_cash_total numeric := 0;
  v_cash_sales numeric := 0;
  v_cash_refunds numeric := 0;
  v_expected_cash numeric;
  v_session_number bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: må være innlogget' USING ERRCODE = '42501';
  END IF;

  IF p_closing_float IS NULL OR p_closing_float < 0 THEN
    RAISE EXCEPTION 'INVALID_CLOSING_FLOAT: closing_float må være >= 0' USING ERRCODE = '22023';
  END IF;

  IF p_counted_cash IS NULL OR p_counted_cash < 0 THEN
    RAISE EXCEPTION 'INVALID_COUNTED_CASH: counted_cash må være >= 0' USING ERRCODE = '22023';
  END IF;

  -- Lås sesjonsraden
  SELECT terminal_id, operator_id, opening_float, status, session_number
    INTO v_terminal_id, v_operator_id, v_opening_float, v_status, v_session_number
  FROM public.pos_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND: %', p_session_id USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'SESSION_NOT_OPEN: status=%', v_status USING ERRCODE = '22023';
  END IF;

  -- Beregn kontant-summer. Speil-fortegn er allerede materialisert i
  -- payment_summary (retur/korreksjon-amounts er negative), så vi summerer
  -- direkte uten å snu fortegn.
  SELECT
    COALESCE(SUM((pmt->>'amount')::numeric), 0),
    COALESCE(SUM(CASE WHEN tx.transaction_type = 'sale'
                      THEN (pmt->>'amount')::numeric ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN tx.transaction_type = 'return'
                      THEN -(pmt->>'amount')::numeric ELSE 0 END), 0)
    INTO v_cash_total, v_cash_sales, v_cash_refunds
  FROM public.pos_transactions tx
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(tx.payment_summary->'payments', '[]'::jsonb)
  ) pmt
  WHERE tx.session_id = p_session_id
    AND tx.is_training = false
    AND pmt->>'method' = 'cash';

  v_expected_cash := v_opening_float + v_cash_total;

  -- Tillat lukking via guard-trigger
  PERFORM set_config('pos.allow_close_session', 'true', true);

  UPDATE public.pos_sessions
  SET status = 'closed',
      closing_float = p_closing_float,
      counted_cash = p_counted_cash,
      expected_cash = v_expected_cash,
      closed_at = now()
  WHERE id = p_session_id;

  -- Journal-event
  INSERT INTO public.pos_journal_events (
    terminal_id, event_type, operator_id, session_id, payload
  ) VALUES (
    v_terminal_id,
    'session_close',
    v_operator_id,
    p_session_id,
    jsonb_build_object(
      'session_number', v_session_number,
      'opening_float', v_opening_float,
      'closing_float', p_closing_float,
      'counted_cash', p_counted_cash,
      'expected_cash', v_expected_cash,
      'cash_variance', p_counted_cash - v_expected_cash,
      'cash_sales', v_cash_sales,
      'cash_refunds', v_cash_refunds,
      'cash_total', v_cash_total
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_close_session(uuid, numeric, numeric) TO authenticated;
