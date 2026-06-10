CREATE OR REPLACE FUNCTION public.pos_operator_authenticate(p_terminal_id uuid, p_operator_code text, p_pin text)
 RETURNS TABLE(operator_id uuid, display_name text, legal_entity_id uuid, can_use_terminal boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_terminal_entity UUID;
  v_op_id UUID;
  v_op_name TEXT;
  v_op_entity UUID;
  v_pin_hash TEXT;
BEGIN
  SELECT t.legal_entity_id INTO v_terminal_entity
  FROM public.pos_terminals t WHERE t.id = p_terminal_id;
  IF v_terminal_entity IS NULL THEN
    RAISE EXCEPTION 'Terminal not found';
  END IF;

  SELECT o.id, o.display_name, o.legal_entity_id, o.pin_hash
  INTO v_op_id, v_op_name, v_op_entity, v_pin_hash
  FROM public.pos_operators o
  WHERE o.legal_entity_id = v_terminal_entity
    AND o.operator_code = p_operator_code
    AND o.status = 'active';

  IF v_op_id IS NULL OR v_pin_hash IS NULL OR
     crypt(p_pin, v_pin_hash) <> v_pin_hash THEN
    INSERT INTO public.pos_journal_events (terminal_id, event_type, payload)
    VALUES (p_terminal_id, 'error',
      jsonb_build_object('reason', 'bad_pin', 'operator_code', p_operator_code));
    RAISE EXCEPTION 'Invalid credentials';
  END IF;

  UPDATE public.pos_operators SET last_login_at = now() WHERE id = v_op_id;

  INSERT INTO public.pos_journal_events (terminal_id, event_type, operator_id)
  VALUES (p_terminal_id, 'operator_login', v_op_id);

  RETURN QUERY SELECT
    v_op_id, v_op_name, v_op_entity,
    EXISTS(SELECT 1 FROM public.pos_operator_terminals pot
           WHERE pot.operator_id = v_op_id AND pot.terminal_id = p_terminal_id);
END;
$function$;