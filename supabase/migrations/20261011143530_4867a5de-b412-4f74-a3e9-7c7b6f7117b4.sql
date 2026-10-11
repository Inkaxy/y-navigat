CREATE OR REPLACE FUNCTION public.rm_save_manual_pdf_invoice(p_legal_entity_id uuid, p_supplier jsonb, p_invoice jsonb, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  v_uid uuid := auth.uid(); v_sup uuid; v_sup_created boolean := false; v_name text; v_no text; v_path text;
  v_existing record; v_inv uuid; r jsonb; n int := 0; v_credit boolean := false;
  v_db jsonb; v_lr jsonb; v_issues jsonb; v_any boolean := false; v_inv_issues jsonb; v_conf numeric; v_status text;
  v_conf_raw jsonb; v_sum_status text;
begin
  if v_uid is null then raise exception 'Krever pålogging' using errcode='28000'; end if;
  if not public.has_ravarer_invoice_access(p_legal_entity_id, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer' using errcode='42501';
  end if;
  v_no := nullif(btrim(p_invoice->>'invoice_number'), '');
  v_path := nullif(btrim(p_invoice->>'source_document_url'), '');
  if v_no is null or nullif(p_invoice->>'invoice_date','') is null then return jsonb_build_object('ok',false,'code','mangler_fakturanr_eller_dato'); end if;
  if v_path is null or split_part(v_path,'/',1) <> p_legal_entity_id::text then return jsonb_build_object('ok',false,'code','ugyldig_dokument'); end if;
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows,'[]'::jsonb)) > 500 then
    return jsonb_build_object('ok',false,'code','ugyldige_linjer');
  end if;

  -- Leverandør: valgt (må tilhøre selskapet) eller ny (gjenbruk eksakt samme navn i selskapet).
  if nullif(p_supplier->>'id','') is not null then
    select id into v_sup from suppliers where id=(p_supplier->>'id')::uuid and legal_entity_id=p_legal_entity_id;
    if v_sup is null then return jsonb_build_object('ok',false,'code','leverandor_finnes_ikke'); end if;
  else
    v_name := nullif(btrim(p_supplier->>'name'),'');
    if v_name is null then return jsonb_build_object('ok',false,'code','mangler_leverandor'); end if;
    perform pg_advisory_xact_lock(hashtextextended('rm_sup:'||p_legal_entity_id::text||':'||lower(v_name),0));
    select id into v_sup from suppliers where legal_entity_id=p_legal_entity_id and name=v_name;
    if v_sup is null then
      insert into suppliers(legal_entity_id,name,org_number,is_active,notes)
        values (p_legal_entity_id, left(v_name,200), nullif(btrim(p_supplier->>'org_number'),''), true, 'Opprettet fra PDF-import')
        returning id into v_sup;
      v_sup_created := true;
    end if;
  end if;

  -- Duplikat/nytt forsøk: serialiser på selskap+leverandør+fakturanr.
  perform pg_advisory_xact_lock(hashtextextended('rm_inv:'||p_legal_entity_id::text||':'||v_sup::text||':'||v_no,0));
  select id, source, source_document_url into v_existing from invoices
    where legal_entity_id=p_legal_entity_id and supplier_id=v_sup and invoice_number=v_no;
  if found then
    if v_existing.source='pdf_upload' and v_existing.source_document_url=v_path then
      return jsonb_build_object('ok',true,'invoice_id',v_existing.id,'supplier_id',v_sup,'replayed',true,
        'lines',(select count(*) from invoice_lines where invoice_id=v_existing.id),
        'status',(select status from invoices where id=v_existing.id));
    end if;
    return jsonb_build_object('ok',false,'code','duplikat','invoice_id',v_existing.id);
  end if;

  v_conf_raw := p_invoice->'extraction_confidence';
  v_conf := case when jsonb_typeof(v_conf_raw)='number' and (v_conf_raw)::numeric between 0 and 1 then (v_conf_raw)::numeric else null end;
  v_sum_status := coalesce(p_invoice->>'lines_sum_status','not_checked');
  if v_sum_status not in ('not_checked','ok','mismatch','no_lines','no_total') then v_sum_status := 'not_checked'; end if;
  v_inv_issues := public._rm_bounded_issues(p_invoice->'issues','leser');

  insert into invoices(legal_entity_id,supplier_id,invoice_number,invoice_date,due_date,total_amount,total_vat,currency,source,
      lines_source,source_document_url,pdf_status,status,extraction_confidence,lines_sum_excl_vat,lines_sum_variance_pct,lines_sum_status,notes,extraction_issues)
    values (p_legal_entity_id, v_sup, left(v_no,100), (p_invoice->>'invoice_date')::date, nullif(p_invoice->>'due_date','')::date,
      (p_invoice->>'total_amount')::numeric, (p_invoice->>'total_vat')::numeric, coalesce(nullif(p_invoice->>'currency',''),'NOK'), 'pdf_upload',
      case when jsonb_array_length(coalesce(p_rows,'[]'::jsonb))>0 then 'pdf_extracted' else 'pending_manual' end,
      v_path, 'stored', 'imported', v_conf, (p_invoice->>'lines_sum_excl_vat')::numeric, (p_invoice->>'lines_sum_variance_pct')::numeric,
      v_sum_status, left(nullif(p_invoice->>'notes',''),1000), v_inv_issues)
    returning id, is_credit_note into v_inv, v_credit;

  for r in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    n := n + 1;
    v_db := public._rm_bounded_issues(public.rm_line_read_issues_v2(
      (r->>'quantity')::numeric, r->>'unit', (r->>'unit_price')::numeric, (r->>'total_amount')::numeric,
      (r->>'package_size')::numeric, r->>'package_unit', (r->>'count_per_package')::numeric, coalesce(v_credit,false),
      r->>'unit_price_basis', (r->>'discount_amount')::numeric, r->>'line_kind'), 'db');
    v_lr := public._rm_bounded_issues(r->'read_issues','leser');
    select coalesce(jsonb_agg(x),'[]'::jsonb) into v_issues from (
      select x from jsonb_array_elements(v_lr) x
      union all
      select d from jsonb_array_elements(v_db) d where not exists (select 1 from jsonb_array_elements(v_lr) l where l->>'code'=d->>'code')
      limit 20) s;
    if jsonb_array_length(v_issues) > 0 then v_any := true; end if;
    insert into invoice_lines(invoice_id,line_number,supplier_sku,description,quantity,unit,unit_price,total_amount,vat_rate,
      package_size,package_unit,count_per_package,line_kind,unit_price_basis,discount_amount,extraction_issues,extraction_evidence)
    values (v_inv, n, left(r->>'supplier_sku',120), left(coalesce(nullif(r->>'description',''),'Linje '||n),1000), (r->>'quantity')::numeric,
      left(r->>'unit',20), (r->>'unit_price')::numeric, (r->>'total_amount')::numeric, (r->>'vat_rate')::numeric,
      (r->>'package_size')::numeric, left(r->>'package_unit',20), (r->>'count_per_package')::numeric, r->>'line_kind',
      r->>'unit_price_basis', (r->>'discount_amount')::numeric, v_issues,
      case when jsonb_typeof(r->'evidence')='object' then jsonb_build_object(
        'source','manual_pdf',
        'confidence', case when jsonb_typeof(r->'evidence'->'confidence')='number' then r->'evidence'->'confidence' else 'null'::jsonb end,
        'edited_by_user', coalesce((r->'evidence'->>'edited_by_user')::boolean,false),
        'number_evidence',(select coalesce(jsonb_agg(e),'[]'::jsonb) from (select e from jsonb_array_elements(
          case when jsonb_typeof(r->'evidence'->'number_evidence')='array' then r->'evidence'->'number_evidence' else '[]'::jsonb end) e limit 10) z))
      else null end);
  end loop;

  -- Ukjent/ugyldig sikkerhet, lav sikkerhet eller varsler: aldri bekreftet.
  v_status := case when v_any or jsonb_array_length(v_inv_issues)>0 or v_conf is null or v_conf < 0.8 then 'needs_review' else 'imported' end;
  if v_status <> 'imported' then update invoices set status=v_status where id=v_inv; end if;
  return jsonb_build_object('ok',true,'invoice_id',v_inv,'supplier_id',v_sup,'supplier_created',v_sup_created,'replayed',false,'lines',n,'status',v_status);
end $function$;
REVOKE ALL ON FUNCTION public.rm_save_manual_pdf_invoice(uuid,jsonb,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rm_save_manual_pdf_invoice(uuid,jsonb,jsonb,jsonb) TO authenticated, service_role;