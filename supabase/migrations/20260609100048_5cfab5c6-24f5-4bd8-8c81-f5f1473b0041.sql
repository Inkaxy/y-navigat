
-- A) Strict immutable guard on append-only tables (reuse existing fn)
DROP TRIGGER IF EXISTS trg_pos_transactions_immutable ON public.pos_transactions;
CREATE TRIGGER trg_pos_transactions_immutable
  BEFORE UPDATE OR DELETE ON public.pos_transactions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_pos_immutable_modification();

DROP TRIGGER IF EXISTS trg_pos_transaction_lines_immutable ON public.pos_transaction_lines;
CREATE TRIGGER trg_pos_transaction_lines_immutable
  BEFORE UPDATE OR DELETE ON public.pos_transaction_lines
  FOR EACH ROW EXECUTE FUNCTION public.prevent_pos_immutable_modification();

DROP TRIGGER IF EXISTS trg_pos_journal_events_immutable ON public.pos_journal_events;
CREATE TRIGGER trg_pos_journal_events_immutable
  BEFORE UPDATE OR DELETE ON public.pos_journal_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_pos_immutable_modification();

DROP TRIGGER IF EXISTS trg_pos_z_reports_immutable ON public.pos_z_reports;
CREATE TRIGGER trg_pos_z_reports_immutable
  BEFORE UPDATE OR DELETE ON public.pos_z_reports
  FOR EACH ROW EXECUTE FUNCTION public.prevent_pos_immutable_modification();

-- B) Session guard — controlled close-only mutation
CREATE OR REPLACE FUNCTION public.prevent_pos_session_modification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'pos_sessions is append-only; DELETE blocked (id=%)', OLD.id;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF current_setting('pos.allow_close_session', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'pos_sessions UPDATE requires pos.allow_close_session flag (id=%)', OLD.id;
    END IF;

    IF OLD.status = 'closed' THEN
      RAISE EXCEPTION 'Session already closed (id=%)', OLD.id;
    END IF;

    -- Protected fields: must not change
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'pos_sessions.id is immutable (id=%)', OLD.id;
    END IF;
    IF NEW.terminal_id IS DISTINCT FROM OLD.terminal_id THEN
      RAISE EXCEPTION 'pos_sessions.terminal_id is immutable (id=%)', OLD.id;
    END IF;
    IF NEW.operator_id IS DISTINCT FROM OLD.operator_id THEN
      RAISE EXCEPTION 'pos_sessions.operator_id is immutable (id=%)', OLD.id;
    END IF;
    IF NEW.session_number IS DISTINCT FROM OLD.session_number THEN
      RAISE EXCEPTION 'pos_sessions.session_number is immutable (id=%)', OLD.id;
    END IF;
    IF NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
      RAISE EXCEPTION 'pos_sessions.opened_at is immutable (id=%)', OLD.id;
    END IF;
    IF NEW.opening_float IS DISTINCT FROM OLD.opening_float THEN
      RAISE EXCEPTION 'pos_sessions.opening_float is immutable (id=%)', OLD.id;
    END IF;

    -- Whitelist (allowed to change): status, closed_at, closing_float, counted_cash, expected_cash
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pos_sessions_guard ON public.pos_sessions;
CREATE TRIGGER trg_pos_sessions_guard
  BEFORE UPDATE OR DELETE ON public.pos_sessions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_pos_session_modification();
