DO $$
DECLARE
  v_def text;
  v_new_def text;
BEGIN
  SELECT pg_get_functiondef('public.materialize_recurring_orders(uuid,date,uuid[],uuid)'::regprocedure)
    INTO v_def;

  v_new_def := replace(
    v_def,
    '''recurring'', v_sched.id::text, v_sched.id,',
    '''subscription'', v_sched.id::text, v_sched.id,'
  );

  IF v_new_def <> v_def THEN
    EXECUTE v_new_def;
  END IF;
END $$;