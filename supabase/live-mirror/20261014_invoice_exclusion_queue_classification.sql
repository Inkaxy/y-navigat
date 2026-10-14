-- Excluded documents/lines must not classify the latest supplier item or remain as flagged tasks.
DO $fix$
DECLARE r record; d text; n integer := 0;
BEGIN
  FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
    WHERE s.nspname='public' AND p.proname IN ('rm_work_items','rm_supplier_items')
  LOOP
    d := pg_get_functiondef(r.oid);
    IF position('where i.legal_entity_id=p_legal_entity_id and' in d)=0
       OR position('where i.legal_entity_id = p_legal_entity_id' in d)=0 THEN
      RAISE EXCEPTION 'Unexpected queue definition %',r.proname;
    END IF;
    d := replace(d,'where i.legal_entity_id=p_legal_entity_id and',
      'where i.excluded_at is null and i.status is distinct from ''excluded'' and i.legal_entity_id=p_legal_entity_id and');
    -- Only the first spaced WHERE belongs to base_lines; later invoice-level WHERE must not reference il.
    d := regexp_replace(d,'where i.legal_entity_id = p_legal_entity_id',
      'where il.excluded_at is null and i.legal_entity_id = p_legal_entity_id');
    EXECUTE d;
    n := n+1;
  END LOOP;
  IF n<>2 THEN RAISE EXCEPTION 'Expected two queue functions'; END IF;
  SELECT pg_get_functiondef(p.oid) INTO STRICT d FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
    WHERE s.nspname='public' AND p.proname='rm_work_summary';
  IF position('not in (''reconciled'',''cancelled'')' in d)=0 THEN RAISE EXCEPTION 'Unexpected summary definition'; END IF;
  d := replace(d,'not in (''reconciled'',''cancelled'')','not in (''reconciled'',''cancelled'',''excluded'')');
  EXECUTE d;
END $fix$;
