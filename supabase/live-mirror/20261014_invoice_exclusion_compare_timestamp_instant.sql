-- Compare the instant, preserving microseconds, rather than Postgres text versus API ISO text.
DO $fix$
DECLARE r record; d text; changed integer := 0;
BEGIN
  FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('rm_set_invoice_exclusion','rm_reopen_invoice_exclusion')
  LOOP
    d := pg_get_functiondef(r.oid);
    IF position('updated_at::text is distinct from p_expected_updated_at' in d)=0 THEN
      RAISE EXCEPTION 'Expected version checks not found in %',r.proname;
    END IF;
    d := replace(d,'v_inv.updated_at::text is distinct from p_expected_updated_at','v_inv.updated_at is distinct from nullif(p_expected_updated_at, '''')::timestamptz');
    d := replace(d,'v_line.updated_at::text is distinct from p_expected_updated_at','v_line.updated_at is distinct from nullif(p_expected_updated_at, '''')::timestamptz');
    EXECUTE d;
    changed := changed+1;
  END LOOP;
  IF changed<>2 THEN RAISE EXCEPTION 'Expected two exclusion functions, found %',changed; END IF;
END $fix$;
