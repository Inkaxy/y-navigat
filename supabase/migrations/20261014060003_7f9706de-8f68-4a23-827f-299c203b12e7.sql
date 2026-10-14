do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.rm_set_invoice_exclusion(uuid,text,uuid,text,text,text,uuid)'::regprocedure);
  d := replace(d, 'p_line_id uuid, p_category text, p_reason text, p_expected_updated_at text, p_op_id uuid)',
    'p_line_id uuid DEFAULT NULL::uuid, p_category text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_expected_updated_at text DEFAULT NULL::text, p_op_id uuid DEFAULT NULL::uuid)');
  if position('p_line_id uuid DEFAULT' in d) = 0 then raise exception 'header ikke funnet (set)'; end if;
  execute d;
  d := pg_get_functiondef('public.rm_reopen_invoice_exclusion(uuid,text,uuid,text,text)'::regprocedure);
  d := replace(d, 'p_line_id uuid, p_expected_updated_at text, p_reason text)',
    'p_line_id uuid DEFAULT NULL::uuid, p_expected_updated_at text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)');
  if position('p_line_id uuid DEFAULT' in d) = 0 then raise exception 'header ikke funnet (reopen)'; end if;
  execute d;
end $mig$;