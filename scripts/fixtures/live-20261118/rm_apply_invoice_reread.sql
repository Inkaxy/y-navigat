CREATE OR REPLACE FUNCTION public.rm_apply_invoice_reread(p_run_id uuid, p_operations jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE rr invoice_reread_runs%rowtype; v invoices%rowtype; l invoice_lines%rowtype; uid uuid:=auth.uid();
 op jsonb; cand jsonb; vals jsonb; issues jsonb; oldinvissues jsonb; upstream jsonb; res jsonb; results jsonb:='[]';
 candidate_ids text[]:='{}'; target_ids uuid[]:='{}'; cid text; lid uuid; kind text; b text; n int:=0; nextline int;
 k text; new_id uuid; sumcheck jsonb; rematch jsonb; learn boolean; overridden boolean; was_manual boolean; identity_changed boolean;
 old_issue_mode text:=coalesce(current_setting('rm.read_issue_write',true),'');
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING errcode='28000'; END IF;
 SELECT * INTO rr FROM invoice_reread_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'finnes_ikke'; END IF;
 IF rr.created_by<>uid OR NOT has_ravarer_invoice_access(rr.legal_entity_id,'write') THEN RAISE EXCEPTION 'forbidden' USING errcode='42501'; END IF;
 IF rr.status='applied' THEN
  IF rr.applied_operations IS DISTINCT FROM p_operations OR rr.apply_reason IS DISTINCT FROM btrim(p_reason) THEN RAISE EXCEPTION 'allerede_brukt_med_andre_valg'; END IF;
  RETURN rr.result||jsonb_build_object('replayed',true);
 END IF;
 IF rr.status<>'ready' THEN RAISE EXCEPTION 'reread_ikke_klar'; END IF;
 IF rr.expires_at<now() THEN RAISE EXCEPTION 'reread_utlopt'; END IF;
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'begrunnelse_mangler'; END IF;
 IF jsonb_typeof(p_operations) IS DISTINCT FROM 'array' OR jsonb_array_length(p_operations) NOT BETWEEN 1 AND 500 OR octet_length(p_operations::text)>2000000 THEN RAISE EXCEPTION 'ugyldige_valg'; END IF;
 SELECT * INTO v FROM invoices WHERE id=rr.invoice_id FOR UPDATE;
 IF NOT FOUND OR v.legal_entity_id IS DISTINCT FROM rr.legal_entity_id THEN RAISE EXCEPTION 'forbidden'; END IF;
 PERFORM id FROM invoice_lines WHERE invoice_id=v.id ORDER BY id FOR UPDATE;
 PERFORM o.id FROM storage.objects o WHERE o.bucket_id='invoice-pdfs' AND o.name=rr.document_path FOR SHARE;
 b:=_rm_reread_blocker(v.id); IF b IS NOT NULL THEN RAISE EXCEPTION '%',b; END IF;
 IF _rm_reread_snapshot(v.id) IS DISTINCT FROM rr.snapshot THEN RAISE EXCEPTION 'snapshot_endret'; END IF;
 oldinvissues:=coalesce(v.extraction_issues,'[]'::jsonb);
 SELECT coalesce(max(line_number),0) INTO nextline FROM invoice_lines WHERE invoice_id=v.id;
 FOR op IN SELECT * FROM jsonb_array_elements(p_operations) LOOP
  IF jsonb_typeof(op) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ugyldige_valg'; END IF;
  FOREACH k IN ARRAY ARRAY['edited_by_user','accept_issues','learn','confirmed_mapping','override_manual','confirm_identity_change','confirmed_addition'] LOOP
   IF op ? k AND jsonb_typeof(op->k) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'ugyldig_bekreftelse'; END IF;
  END LOOP;
  IF op ? 'manual_reason' AND (jsonb_typeof(op->'manual_reason') IS DISTINCT FROM 'string' OR length(op->>'manual_reason')>2000) THEN RAISE EXCEPTION 'ugyldig_begrunnelse'; END IF;
  kind:=op->>'kind'; cid:=op->>'candidate_id';
  IF kind IS NULL OR kind NOT IN ('update','add') THEN RAISE EXCEPTION 'operasjon_ikke_stottet'; END IF;
  IF cid IS NULL OR cid=ANY(candidate_ids) THEN RAISE EXCEPTION 'kandidat_brukt_flere_ganger'; END IF;
  SELECT c INTO cand FROM jsonb_array_elements(rr.proposal->'candidates') c WHERE c->>'candidate_id'=cid;
  IF NOT FOUND THEN RAISE EXCEPTION 'kandidat_finnes_ikke'; END IF;
  candidate_ids:=array_append(candidate_ids,cid);
  vals:=_rm_reread_values(op->'changes');
  IF vals='{}'::jsonb THEN RAISE EXCEPTION 'ingen_felt_valgt'; END IF;
  IF coalesce((op->>'edited_by_user')::boolean,false) IS NOT TRUE THEN
   FOR k IN SELECT jsonb_object_keys(vals) LOOP
    IF vals->k IS DISTINCT FROM cand->'values'->k THEN RAISE EXCEPTION 'endret_forslag_krever_brukervalg'; END IF;
   END LOOP;
  END IF;
  IF coalesce((op->>'accept_issues')::boolean,false) THEN RAISE EXCEPTION 'lesevarsler_ma_bekreftes_separat'; END IF;
  upstream:=_rm_bounded_issues(cand->'issues','reread');
  learn:=coalesce((op->>'learn')::boolean,false);
  IF learn AND jsonb_array_length(upstream)>0 THEN RAISE EXCEPTION 'laering_krever_avklart_forslag'; END IF;
  IF kind='update' THEN
   IF coalesce((op->>'confirmed_mapping')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'linjekobling_ma_bekreftes'; END IF;
   lid:=(op->>'line_id')::uuid;
   IF lid IS NULL OR lid=ANY(target_ids) THEN RAISE EXCEPTION 'linje_valgt_flere_ganger'; END IF;
   SELECT * INTO l FROM invoice_lines WHERE id=lid AND invoice_id=v.id;
   IF NOT FOUND THEN RAISE EXCEPTION 'linje_tilhorer_annen_faktura'; END IF;
   IF learn AND jsonb_array_length(coalesce(l.extraction_issues,'[]'::jsonb))>0 THEN RAISE EXCEPTION 'laering_krever_avklart_forslag'; END IF;
   target_ids:=array_append(target_ids,lid);
   overridden:=EXISTS(SELECT 1 FROM invoice_line_corrections WHERE invoice_line_id=lid);
   IF overridden AND (coalesce((op->>'override_manual')::boolean,false) IS NOT TRUE OR length(btrim(coalesce(op->>'manual_reason','')))<3) THEN RAISE EXCEPTION 'tidligere_rettelse_beskyttet'; END IF;
   was_manual:=l.match_confidence::text='manual' AND l.raw_material_id IS NOT NULL;
   identity_changed:=(vals ? 'supplier_sku' AND vals->'supplier_sku' IS DISTINCT FROM to_jsonb(l)->'supplier_sku')
     OR (vals ? 'description' AND vals->'description' IS DISTINCT FROM to_jsonb(l)->'description')
     OR (vals ? 'line_kind' AND vals->'line_kind' IS DISTINCT FROM to_jsonb(l)->'line_kind');
   IF was_manual AND identity_changed AND coalesce((op->>'confirm_identity_change')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'manuell_kobling_ma_avklares'; END IF;
   res:=rm_correct_invoice_line(lid,l.updated_at,vals,btrim(p_reason)||CASE WHEN overridden THEN ' / Tidligere rettelse: '||btrim(op->>'manual_reason') ELSE '' END,learn,false);
   IF res->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'rettelse_feilet'; END IF;
   -- Existing evidence remains intact. New evidence is immutable on this run.
   -- A partial correction cannot acknowledge previous semantic/OCR warnings.
   -- Retain all old warnings conservatively until the explicit confirmation flow.
   SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO upstream FROM
    (SELECT DISTINCT value AS x FROM jsonb_array_elements(coalesce(l.extraction_issues,'[]'::jsonb)||upstream)) keep;
   IF jsonb_array_length(upstream)>0 THEN
    PERFORM set_config('rm.read_issue_write','on',true);
    UPDATE invoice_lines SET extraction_issues=coalesce(extraction_issues,'[]'::jsonb)||upstream,requires_review=true WHERE id=lid;
    PERFORM set_config('rm.read_issue_write',old_issue_mode,true);
   END IF;
   results:=results||jsonb_build_array(jsonb_build_object('kind','update','candidate_id',cid,'line_id',lid,'correction_id',res->'correction_id','example_id',res->'example_id'));
  ELSE
   IF coalesce((op->>'confirmed_addition')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'ny_linje_ma_bekreftes'; END IF;
   IF learn THEN RAISE EXCEPTION 'laering_krever_eksisterende_rettelse'; END IF;
   -- Addition must include the whole reviewed candidate, optionally edited explicitly.
   IF NOT (vals ? 'description' AND vals ? 'quantity' AND vals ? 'unit' AND vals ? 'unit_price' AND vals ? 'total_amount') THEN RAISE EXCEPTION 'ny_linje_mangler_felt'; END IF;
   issues:=rm_line_read_issues_v2((vals->>'quantity')::numeric,vals->>'unit',(vals->>'unit_price')::numeric,(vals->>'total_amount')::numeric,
     (vals->>'package_size')::numeric,vals->>'package_unit',(vals->>'count_per_package')::numeric,coalesce(v.is_credit_note,false),vals->>'unit_price_basis',(vals->>'discount_amount')::numeric,vals->>'line_kind')||upstream;
   nextline:=nextline+1;
   INSERT INTO invoice_lines(invoice_id,line_number,supplier_sku,description,quantity,unit,unit_price,total_amount,package_size,package_unit,count_per_package,line_kind,unit_price_basis,discount_amount,extraction_issues,extraction_evidence,requires_review)
   VALUES(v.id,nextline,vals->>'supplier_sku',vals->>'description',(vals->>'quantity')::numeric,vals->>'unit',(vals->>'unit_price')::numeric,(vals->>'total_amount')::numeric,
    (vals->>'package_size')::numeric,vals->>'package_unit',(vals->>'count_per_package')::numeric,vals->>'line_kind',vals->>'unit_price_basis',(vals->>'discount_amount')::numeric,issues,
    jsonb_build_object('source','invoice_reread','run_id',rr.id,'document_sha256',rr.document_sha256,'candidate_id',cid,'reader',cand->'evidence'),true)
   RETURNING id INTO new_id;
   INSERT INTO audit_log(user_id,action,entity_type,entity_id,entity_display_reference,legal_entity_id,changes,reason,source_app)
   VALUES(uid,'invoice_line.reread_added','invoice_line',new_id,v.invoice_number,v.legal_entity_id,jsonb_build_object('run_id',rr.id,'candidate_id',cid,'after',vals),btrim(p_reason),'ravarer');
   results:=results||jsonb_build_array(jsonb_build_object('kind','add','candidate_id',cid,'line_id',new_id));
  END IF;
  n:=n+1;
 END LOOP;
 SELECT rm_lines_sum_check(sum(total_amount),count(*)::int,v.total_amount,v.total_vat,coalesce(v.is_credit_note,false)) INTO sumcheck FROM invoice_lines WHERE invoice_id=v.id;
 -- Never silently erase existing invoice-level issues or incoming reader warnings.
 issues:=oldinvissues||_rm_bounded_issues(rr.proposal->'invoice_issues','reread');
 IF sumcheck->>'lines_sum_status'='mismatch' THEN issues:=issues||jsonb_build_array(jsonb_build_object('code','reread_sum_mismatch','message','Sumavvik gjenstår etter de valgte rettelsene.','source','db')); END IF;
 PERFORM set_config('rm.read_issue_write','on',true);
 UPDATE invoices SET lines_sum_excl_vat=(sumcheck->>'lines_sum_excl_vat')::numeric,lines_sum_variance_pct=(sumcheck->>'lines_sum_variance_pct')::numeric,
  lines_sum_status=sumcheck->>'lines_sum_status',extraction_issues=issues,status='needs_review',updated_at=now() WHERE id=v.id;
 -- The shared invoice trigger recalculates its VAT-ratio warning when sums change.
 -- Restore the explicit union afterwards so no previous human-review issue disappears.
 UPDATE invoices SET extraction_issues=issues WHERE id=v.id;
 PERFORM set_config('rm.read_issue_write',old_issue_mode,true);
 rematch:=rm_rematch_invoices(v.legal_entity_id,1,ARRAY[v.id],true);
 IF rematch->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'omberegning_kunne_ikke_koes'; END IF;
 res:=jsonb_build_object('ok',true,'run_id',rr.id,'invoice_id',v.id,'applied_count',n,'operations',results,'lines_sum_status',sumcheck->>'lines_sum_status','replayed',false);
 UPDATE invoice_reread_runs SET status='applied',applied_at=now(),applied_by=uid,applied_operations=p_operations,apply_reason=btrim(p_reason),result=res WHERE id=rr.id;
 INSERT INTO audit_log(user_id,action,entity_type,entity_id,entity_display_reference,legal_entity_id,changes,reason,source_app)
 VALUES(uid,'invoice.reread_applied','invoice',v.id,v.invoice_number,v.legal_entity_id,jsonb_build_object('run_id',rr.id,'operations',results,'document_sha256',rr.document_sha256),btrim(p_reason),'ravarer');
 RETURN res;
END $function$
