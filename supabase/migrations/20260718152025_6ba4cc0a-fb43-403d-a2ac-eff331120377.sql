
-- 1) Deny trigger for uendrbar journal-data
CREATE OR REPLACE FUNCTION public.pos_deny_mod()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_JOURNAL: % on %.% is not permitted (kassasystemforskriften)',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '42501';
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pos_journal_events','pos_transactions','pos_transaction_lines','pos_z_reports']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_'||t||'_deny_mod', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.pos_deny_mod()',
      'trg_'||t||'_deny_mod', t
    );
    -- Sikkerhetsnett: også per-rad UPDATE/DELETE (TRUNCATE finnes bare som STATEMENT-nivå)
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_'||t||'_deny_row', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.pos_deny_mod()',
      'trg_'||t||'_deny_row', t
    );
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated, service_role, PUBLIC', t);
  END LOOP;
END $$;

-- 2) X-rapport skal journalføres
CREATE OR REPLACE FUNCTION public.pos_generate_x_report(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_session record;
  v_terminal record;
  v_operator record;
  v_agg jsonb;
  v_period_end timestamptz := now();
  v_report jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  SELECT s.id, s.terminal_id, s.operator_id, s.session_number, s.opened_at, s.status
  INTO v_session
  FROM public.pos_sessions s WHERE s.id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'X-report requires open session (status=%)', v_session.status USING ERRCODE = 'P0001';
  END IF;

  SELECT t.id, t.terminal_code, t.display_name, t.legal_entity_id
  INTO v_terminal FROM public.pos_terminals t WHERE t.id = v_session.terminal_id;
  IF NOT public.has_position_in_entity(v_terminal.legal_entity_id) THEN
    RAISE EXCEPTION 'forbidden: no access to entity' USING ERRCODE = '42501';
  END IF;

  SELECT o.id, o.operator_code, o.display_name
  INTO v_operator FROM public.pos_operators o WHERE o.id = v_session.operator_id;

  v_agg := public._pos_period_aggregate(v_terminal.id, v_session.opened_at, v_period_end);

  v_report := jsonb_build_object(
    'report_type','x',
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

  INSERT INTO public.pos_journal_events (terminal_id, event_type, operator_id, session_id, payload)
  VALUES (v_terminal.id, 'x_report', v_operator.id, v_session.id, v_report);

  RETURN v_report;
END;
$function$;

-- 3) Klient-hendelser (utlogging, skuffåpning, proforma, rabatt, linjekorreksjon)
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
    'line_correction','error'
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

GRANT EXECUTE ON FUNCTION public.pos_journal_append(uuid, text, uuid, uuid, uuid, jsonb)
  TO authenticated;

-- 4) Admin-variant av kjedeverifisering (uten auth-sjekk — kun for service_role)
CREATE OR REPLACE FUNCTION public.pos_verify_journal_chain_admin(p_terminal_id uuid)
RETURNS TABLE(is_valid boolean, broken_at_id bigint, total_events bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $$
DECLARE
  v_rec RECORD;
  v_expected_prev TEXT := repeat('0', 64);
  v_recomputed TEXT;
  v_input TEXT;
  v_total BIGINT := 0;
BEGIN
  FOR v_rec IN
    SELECT id, terminal_id, event_type, operator_id, session_id, transaction_id,
           payload, event_time, prev_hash, event_hash
    FROM public.pos_journal_events
    WHERE terminal_id = p_terminal_id
    ORDER BY id ASC
  LOOP
    v_total := v_total + 1;
    IF v_rec.prev_hash <> v_expected_prev THEN
      RETURN QUERY SELECT false, v_rec.id, v_total; RETURN;
    END IF;
    v_input := v_rec.prev_hash
      || COALESCE(v_rec.terminal_id::text,'')
      || v_rec.event_type
      || COALESCE(v_rec.operator_id::text,'')
      || COALESCE(v_rec.session_id::text,'')
      || COALESCE(v_rec.transaction_id::text,'')
      || COALESCE(v_rec.payload::text,'{}')
      || v_rec.event_time::text;
    v_recomputed := encode(extensions.digest(v_input,'sha256'),'hex');
    IF v_recomputed <> v_rec.event_hash THEN
      RETURN QUERY SELECT false, v_rec.id, v_total; RETURN;
    END IF;
    v_expected_prev := v_rec.event_hash;
  END LOOP;
  RETURN QUERY SELECT true, NULL::bigint, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_verify_journal_chain_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_verify_journal_chain_admin(uuid) TO service_role;

-- 5) pos_journal_verifications: logg for daglig kontroll
CREATE TABLE IF NOT EXISTS public.pos_journal_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_id uuid NOT NULL REFERENCES public.pos_terminals(id) ON DELETE CASCADE,
  is_valid boolean NOT NULL,
  broken_at_id bigint,
  total_events bigint NOT NULL DEFAULT 0,
  error_message text,
  verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_journal_verif_terminal_time
  ON public.pos_journal_verifications (terminal_id, verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_journal_verif_invalid
  ON public.pos_journal_verifications (verified_at DESC) WHERE is_valid = false;

GRANT SELECT ON public.pos_journal_verifications TO authenticated;
GRANT ALL ON public.pos_journal_verifications TO service_role;

ALTER TABLE public.pos_journal_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY pos_journal_verif_select ON public.pos_journal_verifications
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.pos_terminals t
    WHERE t.id = pos_journal_verifications.terminal_id
      AND (public.has_position_in_entity(t.legal_entity_id) OR public.is_platform_admin())
  )
);

-- Uendrbar også her: kun service_role kan skrive; ingen UPDATE/DELETE
CREATE TRIGGER trg_pos_journal_verif_deny_mod
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.pos_journal_verifications
  FOR EACH STATEMENT EXECUTE FUNCTION public.pos_deny_mod();
CREATE TRIGGER trg_pos_journal_verif_deny_row
  BEFORE UPDATE OR DELETE ON public.pos_journal_verifications
  FOR EACH ROW EXECUTE FUNCTION public.pos_deny_mod();
REVOKE UPDATE, DELETE, TRUNCATE ON public.pos_journal_verifications FROM anon, authenticated, service_role, PUBLIC;
