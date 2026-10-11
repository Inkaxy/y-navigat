-- LOCAL PROPOSAL, NOT APPLIED. Read-only evidence; no cost/invoice mutation.
CREATE OR REPLACE FUNCTION public.rm_list_price_evidence(p_legal_entity_id uuid,p_raw_material_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ids uuid[]:=coalesce(p_raw_material_ids,'{}'::uuid[]); n int; invoice_access boolean;
 observations jsonb:='{}'; receipts jsonb:='{}'; rows_out jsonb:='[]'; r record; c record; iv record;
 o jsonb; receipt jsonb; proof jsonb; reason text; cost_reason text; invoice_reason text;
 price numeric; deviation numeric; cost_ok boolean; invoice_ok boolean; work_lines int:=0;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
 IF p_legal_entity_id IS NULL OR public.has_ravarer_access(auth.uid(),p_legal_entity_id,'read') IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 n:=cardinality(ids);
 IF n>100 OR array_ndims(ids)>1 OR EXISTS(SELECT 1 FROM unnest(ids) x WHERE x IS NULL)
    OR (SELECT count(DISTINCT x) FROM unnest(ids) x)<>n THEN
   RAISE EXCEPTION 'Expected at most 100 distinct non-null material IDs' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ids) x LEFT JOIN raw_materials m ON m.id=x
   WHERE m.id IS NULL OR m.legal_entity_id IS DISTINCT FROM p_legal_entity_id OR public.rm_can_read(x) IS DISTINCT FROM true) THEN
   RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 invoice_access:=public.has_ravarer_invoice_access(p_legal_entity_id,'read') IS NOT DISTINCT FROM true;
 -- No invoice join or safety invocation before the separate invoice permission check.
 IF invoice_access THEN
   SELECT coalesce(jsonb_object_agg(m.id::text,to_jsonb(latest)) FILTER(WHERE latest.line_id IS NOT NULL),'{}'::jsonb)
   INTO observations FROM raw_materials m
   LEFT JOIN LATERAL (
     SELECT l.id line_id,l.updated_at line_version,l.raw_material_id,l.price_per_base_unit,
       i.id invoice_id,i.legal_entity_id,i.invoice_date,i.invoice_number,i.supplier_id,i.currency,i.status,i.is_credit_note,i.flagged_at
     FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
     WHERE l.raw_material_id=m.id AND i.legal_entity_id=p_legal_entity_id
     -- Select latest observation BEFORE checking credit/cancel/read/hold safety. No older fallback.
     ORDER BY i.invoice_date DESC NULLS LAST,l.updated_at DESC NULLS LAST,i.id DESC,l.id DESC LIMIT 1
   ) latest ON true WHERE m.id=ANY(ids);
   FOR iv IN SELECT (v->>'invoice_id')::uuid id FROM jsonb_each(observations) t(k,v) GROUP BY 1 ORDER BY 1 LOOP
     -- Bounded work: never run an entire enormous invoice through the shared safety motor.
     -- At most 2001 rows visited to detect the per-invoice cap; total budget 10000.
     SELECT count(*) INTO n FROM (SELECT 1 FROM invoice_lines WHERE invoice_id=iv.id LIMIT 2001) bounded;
     IF n>2000 OR work_lines+n>10000 THEN
       receipts:=receipts||jsonb_build_object(iv.id::text,jsonb_build_object('capacity_limited',true));
     ELSE
       work_lines:=work_lines+n;
       receipts:=receipts||jsonb_build_object(iv.id::text,public.rm_invoice_line_price_safety(iv.id));
     END IF;
   END LOOP;
 END IF;
 FOR r IN SELECT * FROM raw_materials WHERE id=ANY(ids) ORDER BY id LOOP
   cost_ok:=false;invoice_ok:=false;price:=NULL;deviation:=NULL;proof:=NULL;receipt:=NULL;o:=NULL;
   cost_reason:=NULL;invoice_reason:=NULL;
   -- Do not expose selected source history/invoice metadata to material-only readers.
   IF NOT invoice_access THEN
     rows_out:=rows_out||jsonb_build_array(jsonb_build_object(
       'raw_material_id',r.id,'material_updated_at',r.updated_at,'status','unknown','reason','invoice_access_missing',
       'current_price',r.current_cost_price,'base_unit',r.base_unit,'cost_basis_status',r.cost_basis_status,
       'cost_evidence_status','unknown','invoice_evidence_status','unknown','deviation_pct',NULL,
       'cost_reason',NULL,'invoice_reason','invoice_access_missing','cost_source_history_id',NULL,
       'selected_cost_history_id',NULL,'cost_effective_date',NULL,'cost_source_kind',NULL,'price_updated_at',r.price_updated_at,
       'invoice_id',NULL,'invoice_line_id',NULL,'invoice_number',NULL,'invoice_date',NULL,'supplier_id',NULL,
       'line_version',NULL,'invoice_price_per_base_unit',NULL,'currency',NULL));
     CONTINUE;
   END IF;
   -- Reuse canonical selector: its holds, unit changes, source identity, trust and currency rules remain authoritative.
   SELECT * INTO c FROM public._rm_cost_candidates(r.id,public.rm_oslo_today())
     ORDER BY effective_date DESC,created_at DESC,history_id DESC LIMIT 1;
   cost_reason:=CASE
     WHEN r.cost_basis_status IS DISTINCT FROM 'verifisert' THEN 'cost_unverified'
     WHEN NOT coalesce(public.rm_is_finite(r.current_cost_price),false) OR r.current_cost_price<=0 THEN 'cost_invalid'
     WHEN r.base_unit IS NULL OR r.base_unit NOT IN ('kg','g','l','ml','stk') THEN 'unit_mismatch'
     WHEN c.history_id IS NULL OR r.cost_source_history_id IS DISTINCT FROM c.history_id THEN 'cost_source_stale'
     WHEN NOT coalesce(public.rm_is_finite(c.price),false) OR round(r.current_cost_price,4) IS DISTINCT FROM round(c.price,4) THEN 'cost_source_stale'
     ELSE NULL END;
   cost_ok:=cost_reason IS NULL;
   o:=observations->r.id::text;
   IF o IS NULL THEN invoice_reason:='no_invoice_observation';
   ELSE
     receipt:=receipts->(o->>'invoice_id');
     IF receipt->>'capacity_limited'='true' THEN invoice_reason:='invoice_capacity_limited';
     ELSIF receipt->>'schema_version' IS DISTINCT FROM '2'
       OR receipt->>'invoice_id' IS DISTINCT FROM o->>'invoice_id'
       OR receipt->>'legal_entity_id' IS DISTINCT FROM p_legal_entity_id::text
       OR jsonb_typeof(receipt->'lines') IS DISTINCT FROM 'array' THEN invoice_reason:='identity_mismatch';
     ELSE
       SELECT count(*) INTO n FROM jsonb_array_elements(receipt->'lines') v WHERE v->>'line_id'=o->>'line_id';
       IF n<>1 THEN invoice_reason:='identity_mismatch';
       ELSE
         SELECT v INTO proof FROM jsonb_array_elements(receipt->'lines') v WHERE v->>'line_id'=o->>'line_id';
         -- Compare JSON-rendered DB timestamps without lossy JS/date conversions.
         invoice_reason:=CASE
           WHEN o->>'line_version' IS NULL OR proof->>'line_version' IS DISTINCT FROM o->>'line_version'
             OR proof->>'raw_material_id' IS DISTINCT FROM r.id::text THEN 'identity_mismatch'
           WHEN o->>'is_credit_note'='true' OR o->>'status'='cancelled' OR o->>'flagged_at' IS NOT NULL THEN 'invoice_unverified'
           WHEN upper(coalesce(o->>'currency',''))<>'NOK' THEN 'currency_mismatch'
           WHEN proof->'can_compare' IS DISTINCT FROM 'true'::jsonb THEN coalesce(proof->>'reason_code','invoice_unverified')
           WHEN proof->>'base_unit' IS DISTINCT FROM r.base_unit OR proof->>'currency' IS DISTINCT FROM 'NOK' THEN 'unit_mismatch'
           WHEN jsonb_typeof(proof->'price_per_base_unit') IS DISTINCT FROM 'number' THEN 'invoice_unverified'
           ELSE NULL END;
         IF invoice_reason IS NULL THEN
           price:=(proof->>'price_per_base_unit')::numeric;
           IF NOT coalesce(public.rm_is_finite(price),false) OR price<=0
             OR price IS DISTINCT FROM (o->>'price_per_base_unit')::numeric THEN invoice_reason:='invoice_unverified';price:=NULL; END IF;
         END IF;
       END IF;
     END IF;
   END IF;
   invoice_ok:=invoice_reason IS NULL;
   reason:=coalesce(cost_reason,invoice_reason);
   IF cost_ok AND invoice_ok THEN deviation:=(price-r.current_cost_price)/abs(r.current_cost_price)*100; END IF;
   rows_out:=rows_out||jsonb_build_array(jsonb_build_object(
     'raw_material_id',r.id,'material_updated_at',r.updated_at,'status',CASE WHEN reason IS NULL THEN 'eligible' ELSE 'unknown' END,
     'reason',reason,'cost_reason',cost_reason,'invoice_reason',invoice_reason,
     'cost_evidence_status',CASE WHEN cost_ok THEN 'eligible' ELSE 'unknown' END,
     'invoice_evidence_status',CASE WHEN invoice_ok THEN 'eligible' ELSE 'unknown' END,
     'current_price',r.current_cost_price,'cost_basis_status',r.cost_basis_status,'cost_source_history_id',r.cost_source_history_id,
     'selected_cost_history_id',c.history_id,'cost_effective_date',c.effective_date,'cost_source_kind',c.source,
     'price_updated_at',r.price_updated_at,'invoice_id',o->'invoice_id','invoice_line_id',o->'line_id',
     'invoice_number',o->'invoice_number','invoice_date',o->'invoice_date','supplier_id',o->'supplier_id',
     'line_version',o->'line_version','invoice_price_per_base_unit',CASE WHEN invoice_ok THEN price ELSE NULL END,
     'base_unit',r.base_unit,'currency',CASE WHEN invoice_ok THEN 'NOK' ELSE NULL END,'deviation_pct',deviation));
 END LOOP;
 RETURN jsonb_build_object('schema_version',1,'legal_entity_id',p_legal_entity_id,'checked_at',statement_timestamp(),
   'requested_count',cardinality(ids),'rows',rows_out);
END $$;
REVOKE ALL ON FUNCTION public.rm_list_price_evidence(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rm_list_price_evidence(uuid,uuid[]) TO authenticated;
