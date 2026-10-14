-- Line-scope exclusion must be blocked on an internally approved invoice, same as document scope.
DO $fix$
DECLARE d text; anchor text;
BEGIN
  d := pg_get_functiondef('public.rm_set_invoice_exclusion(uuid,text,uuid,text,text,text,uuid)'::regprocedure);
  anchor := E'faktura_avstemt''); end if;\n  if public._rm_line_exclusion_blocker(v_line.id) is not null then';
  IF position(anchor in d)=0 THEN RAISE EXCEPTION 'Line-branch anchor not found'; END IF;
  IF position('faktura_godkjent' in d)=0 THEN RAISE EXCEPTION 'Document approval check missing'; END IF;
  d := replace(d, anchor, E'faktura_avstemt''); end if;\n  if exists (select 1 from invoice_internal_approvals a where a.invoice_id = v_inv.id and a.status = ''approved'' and a.revoked_at is null) then\n    return jsonb_build_object(''ok'', false, ''error'', ''faktura_godkjent'');\n  end if;\n  if public._rm_line_exclusion_blocker(v_line.id) is not null then');
  EXECUTE d;
END $fix$;