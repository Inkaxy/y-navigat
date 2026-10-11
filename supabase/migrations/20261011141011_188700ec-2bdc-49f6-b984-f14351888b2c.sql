ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS line_extraction_token uuid;
ALTER TABLE public.invoice_lines ADD COLUMN IF NOT EXISTS extraction_evidence jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_lines_invoice_line_number_uniq ON public.invoice_lines(invoice_id, line_number);

-- Om fakturaen trygt kan få maskinleste linjer: ingen linjer, rettelser, føringer, godkjenning eller avstemming.
CREATE OR REPLACE FUNCTION public._rm_invoice_extraction_blocker(p_invoice_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select case
    when exists(select 1 from invoice_lines where invoice_id=p_invoice_id) then 'har_linjer'
    when exists(select 1 from invoice_line_corrections where invoice_id=p_invoice_id) then 'har_rettelser'
    when exists(select 1 from invoice_line_cost_postings where invoice_id=p_invoice_id and revoked_at is null) then 'kostpris_fort'
    when exists(select 1 from invoice_internal_approvals where invoice_id=p_invoice_id and revoked_at is null) then 'godkjent'
    when exists(select 1 from invoices where id=p_invoice_id and (status='reconciled' or reconciled_at is not null)) then 'avstemt'
    else null end
$$;
REVOKE ALL ON FUNCTION public._rm_invoice_extraction_blocker(uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.rm_claim_invoice_line_extraction(uuid, integer, uuid, interval, integer);
CREATE FUNCTION public.rm_claim_invoice_line_extraction(p_legal_entity_id uuid, p_limit integer DEFAULT 20, p_invoice_id uuid DEFAULT NULL::uuid, p_lease interval DEFAULT '00:10:00'::interval, p_max_attempts integer DEFAULT 3)
RETURNS TABLE(id uuid, tripletex_supplier_invoice_id text, invoice_number text, total_amount numeric, total_vat numeric, status text, line_extraction_status text, line_extraction_attempts integer, claim_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare v_limit integer := case when p_invoice_id is not null then 1 else greatest(1, least(50, coalesce(p_limit, 20))) end;
begin
  if p_legal_entity_id is null then raise exception 'legal_entity_id mangler' using errcode = '22023'; end if;
  return query
  with cand as (
    select i.id from public.invoices i
     where i.legal_entity_id = p_legal_entity_id
       and i.tripletex_supplier_invoice_id is not null
       and (p_invoice_id is null or i.id = p_invoice_id)
       and (case when p_invoice_id is null then i.line_extraction_status = 'pending' else i.line_extraction_status <> 'done' end)
       and i.line_extraction_attempts < coalesce(p_max_attempts, 3)
       and (i.line_extraction_at is null or i.line_extraction_token is null
            or i.line_extraction_at < now() - coalesce(p_lease, interval '10 minutes'))
       and public._rm_invoice_extraction_blocker(i.id) is null
     order by i.line_extraction_attempts asc, i.invoice_date desc, i.id
     limit v_limit
     for update of i skip locked
  ), upd as (
    update public.invoices u
       set line_extraction_attempts = u.line_extraction_attempts + 1,
           line_extraction_at = now(),
           line_extraction_token = gen_random_uuid()
      from cand where u.id = cand.id
    returning u.id, u.tripletex_supplier_invoice_id, u.invoice_number, u.total_amount, u.total_vat,
              u.status, u.line_extraction_status, u.line_extraction_attempts, u.line_extraction_token
  )
  select * from upd;
end $function$;
REVOKE ALL ON FUNCTION public.rm_claim_invoice_line_extraction(uuid, integer, uuid, interval, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rm_claim_invoice_line_extraction(uuid, integer, uuid, interval, integer) TO service_role;

-- Avgrensede, strukturerte varsler: maks 20, kode+melding+kilde.
CREATE OR REPLACE FUNCTION public._rm_bounded_issues(p jsonb, p_source text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  select coalesce(jsonb_agg(jsonb_build_object('code', left(e->>'code', 60), 'message', left(coalesce(e->>'message',''), 300), 'source', p_source)), '[]'::jsonb)
    from (select e from jsonb_array_elements(case when jsonb_typeof(p)='array' then p else '[]'::jsonb end) e
           where jsonb_typeof(e)='object' and coalesce(e->>'code','') <> '' limit 20) s
$$;

CREATE OR REPLACE FUNCTION public.rm_finalize_invoice_line_extraction(p_invoice_id uuid, p_token uuid, p_rows jsonb, p_invoice jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare v invoices%rowtype; b text; r jsonb; n int := 0; v_db jsonb; v_lr jsonb; v_issues jsonb; v_credit boolean;
  v_inv_issues jsonb; v_status text; v_any_issue boolean := false; v_conf numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Kun tjenesten kan ferdigstille linjeuthenting' using errcode='42501'; end if;
  select * into v from invoices where id = p_invoice_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'finnes_ikke'); end if;
  if v.line_extraction_token is null or v.line_extraction_token is distinct from p_token then
    return jsonb_build_object('ok', false, 'code', 'utdatert_kjoring');
  end if;
  b := public._rm_invoice_extraction_blocker(p_invoice_id);
  if b is not null then
    update invoices set line_extraction_token = null,
      line_extraction_error = 'Maskinlesing ble ikke lagret: fakturaen ble endret manuelt under lesingen ('||b||').'
     where id = p_invoice_id;
    return jsonb_build_object('ok', false, 'code', b);
  end if;
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows,'[]'::jsonb)) > 500 then
    raise exception 'Ugyldige linjer' using errcode='22023';
  end if;
  v_credit := coalesce(v.is_credit_note, false);
  for r in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    n := n + 1;
    if (r->>'line_number')::int is distinct from n then raise exception 'Linjenummer må være 1..N i rekkefølge' using errcode='22023'; end if;
    v_db := public._rm_bounded_issues(public.rm_line_read_issues_v2(
      (r->>'quantity')::numeric, r->>'unit', (r->>'unit_price')::numeric, (r->>'total_amount')::numeric,
      (r->>'package_size')::numeric, r->>'package_unit', (r->>'count_per_package')::numeric, v_credit,
      r->>'unit_price_basis', (r->>'discount_amount')::numeric, r->>'line_kind'), 'db');
    v_lr := public._rm_bounded_issues(r->'read_issues', 'leser');
    -- Leserens varsler (f.eks. tvetydig tall) beholdes; databasens kontroll legges til der koden ikke allerede finnes.
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_issues from (
      select x from jsonb_array_elements(v_lr) x
      union all
      select d from jsonb_array_elements(v_db) d where not exists (select 1 from jsonb_array_elements(v_lr) l where l->>'code' = d->>'code')
      limit 20) s;
    if jsonb_array_length(v_issues) > 0 then v_any_issue := true; end if;
    insert into invoice_lines(invoice_id, line_number, supplier_sku, description, quantity, unit, unit_price, total_amount, vat_rate,
      package_size, package_unit, count_per_package, line_kind, unit_price_basis, discount_amount, ledger_account, extraction_issues, extraction_evidence)
    values (p_invoice_id, n, left(r->>'supplier_sku', 120), left(r->>'description', 1000), (r->>'quantity')::numeric, left(r->>'unit', 20),
      (r->>'unit_price')::numeric, (r->>'total_amount')::numeric, (r->>'vat_rate')::numeric,
      (r->>'package_size')::numeric, left(r->>'package_unit', 20), (r->>'count_per_package')::numeric, r->>'line_kind',
      r->>'unit_price_basis', (r->>'discount_amount')::numeric, left(r->>'ledger_account', 20), v_issues,
      case when jsonb_typeof(r->'evidence') = 'object' then jsonb_build_object(
        'source', 'tripletex_pdf',
        'confidence', r->'evidence'->'confidence',
        'number_evidence', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(
             case when jsonb_typeof(r->'evidence'->'number_evidence')='array' then r->'evidence'->'number_evidence' else '[]'::jsonb end) e limit 10) z))
      else null end);
  end loop;

  v_conf := (p_invoice->>'extraction_confidence')::numeric;
  v_inv_issues := public._rm_bounded_issues(p_invoice->'issues', 'leser');
  v_status := v.status;
  if v_status = 'imported' and (v_any_issue or jsonb_array_length(v_inv_issues) > 0 or coalesce(v_conf, 0) < 0.8) then
    v_status := 'needs_review';
  end if;
  perform set_config('rm.read_issue_write', 'on', true);
  update invoices set
    lines_source = case when n > 0 then 'pdf_extracted' else null end,
    line_extraction_status = 'done', line_extraction_at = now(), line_extraction_token = null,
    line_extraction_error = case when n = 0 then 'PDF-en ga ingen lesbare linjer' else null end,
    extraction_confidence = v_conf,
    lines_sum_excl_vat = (p_invoice->>'lines_sum_excl_vat')::numeric,
    lines_sum_variance_pct = (p_invoice->>'lines_sum_variance_pct')::numeric,
    lines_sum_status = coalesce(p_invoice->>'lines_sum_status', lines_sum_status),
    total_vat = case when total_vat is null and (p_invoice->>'total_vat_from_postings') is not null then (p_invoice->>'total_vat_from_postings')::numeric else total_vat end,
    vat_inferred = case when total_vat is null and (p_invoice->>'total_vat_from_postings') is not null then true else vat_inferred end,
    extraction_issues = v_inv_issues,
    status = v_status
   where id = p_invoice_id;
  return jsonb_build_object('ok', true, 'lines', n, 'status', v_status);
end $function$;
REVOKE ALL ON FUNCTION public.rm_finalize_invoice_line_extraction(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rm_finalize_invoice_line_extraction(uuid, uuid, jsonb, jsonb) TO service_role;

-- Feil/forsøk lagres bare av kjøringen som eier tokenet.
CREATE OR REPLACE FUNCTION public.rm_fail_invoice_line_extraction(p_invoice_id uuid, p_token uuid, p_patch jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Kun tjenesten' using errcode='42501'; end if;
  update invoices set
    line_extraction_status = case when p_patch->>'line_extraction_status' in ('pending','failed') then p_patch->>'line_extraction_status' else line_extraction_status end,
    line_extraction_error = left(p_patch->>'line_extraction_error', 1000),
    line_extraction_at = now(), line_extraction_token = null,
    pdf_status = case when p_patch->>'pdf_status' = 'failed' then 'failed' else pdf_status end,
    status = case when p_patch->>'status' = 'needs_review' and status = 'imported' then 'needs_review' else status end
   where id = p_invoice_id and line_extraction_token = p_token;
  return found;
end $function$;
REVOKE ALL ON FUNCTION public.rm_fail_invoice_line_extraction(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rm_fail_invoice_line_extraction(uuid, uuid, jsonb) TO service_role;