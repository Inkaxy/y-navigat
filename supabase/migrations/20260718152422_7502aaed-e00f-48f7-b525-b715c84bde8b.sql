
-- Utvid tillatte klient-hendelser
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
    'operator_logout','drawer_open','proforma_view','discount_applied',
    'line_correction','error',
    'receipt_delivered','receipt_printed','receipt_copy'
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
    p_terminal_id, p_event_type, p_operator_id, p_session_id, p_transaction_id, COALESCE(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Atomisk kvittering-utskrift: original eller KOPI (maks 1)
CREATE OR REPLACE FUNCTION public.pos_record_receipt_print(
  p_terminal_id uuid,
  p_transaction_id uuid
)
RETURNS TABLE(kind text, copies_remaining int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_le uuid;
  v_orig int;
  v_copy int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  SELECT legal_entity_id INTO v_le FROM public.pos_terminals WHERE id = p_terminal_id;
  IF v_le IS NULL THEN
    RAISE EXCEPTION 'terminal not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.has_position_in_entity(v_le) OR public.is_kiosk_user()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Lås transaksjonen for å unngå race på KOPI-teller
  PERFORM 1 FROM public.pos_transactions WHERE id = p_transaction_id FOR SHARE;

  SELECT
    count(*) FILTER (WHERE event_type = 'receipt_printed'),
    count(*) FILTER (WHERE event_type = 'receipt_copy')
    INTO v_orig, v_copy
  FROM public.pos_journal_events
  WHERE transaction_id = p_transaction_id
    AND event_type IN ('receipt_printed','receipt_copy');

  IF v_orig = 0 THEN
    INSERT INTO public.pos_journal_events(terminal_id, event_type, transaction_id, payload)
    VALUES (p_terminal_id, 'receipt_printed', p_transaction_id, '{}'::jsonb);
    kind := 'original'; copies_remaining := 1; RETURN NEXT;
  ELSIF v_copy = 0 THEN
    INSERT INTO public.pos_journal_events(terminal_id, event_type, transaction_id, payload)
    VALUES (p_terminal_id, 'receipt_copy', p_transaction_id, '{}'::jsonb);
    kind := 'copy'; copies_remaining := 0; RETURN NEXT;
  ELSE
    RAISE EXCEPTION 'Kvitteringskopi allerede utstedt for denne transaksjonen' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pos_record_receipt_print(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_record_receipt_print(uuid, uuid) TO authenticated, service_role;
