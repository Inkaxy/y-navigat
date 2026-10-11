# Speil: lesing på nytt av eksisterende faktura (live, ikke kjør på nytt)

Kilde: live-database xpgoztaraqdvliitkkfv, lest 2026-10-11 med `pg_get_functiondef`, `pg_policy`,
`pg_class.relacl`, `pg_constraint`, `pg_indexes`, `pg_trigger`. Migrasjonene
`20261011160349_reviewed_invoice_reread_runs` og `20261011160536_invoice_read_confirmation_lifecycle_guards`
er registrert i `supabase_migrations.schema_migrations` og er brukt av root. Denne filen er dokumentasjon —
den ligger med vilje utenfor `supabase/migrations` slik at verktøyet ikke kjører SQL-en en gang til.

## Tabell `public.invoice_reread_runs`

| kolonne | type | null | standard |
|---|---|---|---|
| id | uuid | nei | gen_random_uuid() |
| legal_entity_id | uuid | nei | |
| invoice_id | uuid | nei | |
| created_by | uuid | nei | |
| created_at | timestamptz | nei | now() |
| expires_at | timestamptz | nei | (now() + '24:00:00'::interval) |
| status | text | nei | 'reading'::text |
| document_path | text | nei | |
| snapshot | jsonb | nei | |
| document_sha256 | text | ja | |
| proposal | jsonb | ja | |
| extractor | jsonb | ja | |
| error_code | text | ja | |
| applied_at | timestamptz | ja | |
| applied_by | uuid | ja | |
| applied_operations | jsonb | ja | |
| apply_reason | text | ja | |
| result | jsonb | ja | |

Begrensninger: `PRIMARY KEY (id)` · `FOREIGN KEY (invoice_id) REFERENCES invoices(id)` ·
`FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id)` ·
`CHECK ((status = ANY (ARRAY['reading'::text, 'ready'::text, 'applied'::text, 'cancelled'::text, 'failed'::text])))`

Indekser: `CREATE UNIQUE INDEX invoice_reread_runs_pkey ON public.invoice_reread_runs USING btree (id)` ·
`CREATE INDEX invoice_reread_runs_invoice_idx ON public.invoice_reread_runs USING btree (invoice_id, created_at DESC)`

Trigger: `CREATE TRIGGER invoice_reread_immutable BEFORE UPDATE ON public.invoice_reread_runs FOR EACH ROW EXECUTE FUNCTION _rm_reread_immutable()`

ACL: `{postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=r/postgres}` · RLS på.

Policy: `invoice_reread_runs_read` FOR SELECT TO authenticated USING `has_ravarer_invoice_access(legal_entity_id, 'read'::text)`.
Ingen skrivepolicy — alle endringer går gjennom funksjonene under.

## Funksjoner (md5 av `pg_get_functiondef` og ACL)

| funksjon | md5 | ACL |
|---|---|---|
| _rm_reread_blocker(p_invoice_id uuid) | e4ff62616b5e26ec77109731653384bc | {postgres=X/postgres} |
| _rm_reread_immutable() | 15482fbc7d29f2bba4f7eeba2119147a | {postgres=X/postgres} |
| _rm_reread_snapshot(p_invoice_id uuid) | 7a3ad60848323fdd903b27d5eb2ad73e | {postgres=X/postgres} |
| _rm_reread_values(p jsonb) | a520e0cb02d64acf61eab174c8c4b149 | {postgres=X/postgres} |
| rm_apply_invoice_reread(p_run_id uuid, p_operations jsonb, p_reason text) | dc58b00ca0774c576f7fa8c8c044df4d | {postgres=X/postgres,authenticated=X/postgres} |
| rm_begin_invoice_reread(p_invoice_id uuid) | 72a836843dba8ae541dfe1472121be0f | {postgres=X/postgres,authenticated=X/postgres} |
| rm_cancel_invoice_reread(p_run_id uuid) | d40d20df8ee850cda5d9bb66fe419c89 | {postgres=X/postgres,authenticated=X/postgres} |
| rm_confirm_invoice_read_issues(p_invoice_id uuid, p_reason text) | 6021a8e0cee3673bf0648f8cbd6584d1 | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} |
| rm_fail_invoice_reread(p_run_id uuid, p_code text) | a2c0acf240607e7926932dc9da695440 | {postgres=X/postgres,service_role=X/postgres} |
| rm_register_invoice_reread(p_run_id uuid, p_document_sha256 text, p_proposal jsonb, p_extractor jsonb) | e12efb0ac36ad1b947d9dba1b12074f4 | {postgres=X/postgres,service_role=X/postgres} |

Full live-tekst (eksakt `pg_get_functiondef`):

```sql
CREATE OR REPLACE FUNCTION public._rm_reread_blocker(p_invoice_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT CASE
 WHEN i.status IS NULL OR i.status NOT IN ('imported','needs_review','ready') OR i.reconciled_at IS NOT NULL THEN 'faktura_last'
 WHEN i.flagged_at IS NOT NULL THEN 'faktura_flagget'
 WHEN EXISTS(SELECT 1 FROM invoice_internal_approvals a WHERE a.invoice_id=i.id AND a.status='approved' AND a.revoked_at IS NULL) THEN 'faktura_godkjent'
 WHEN EXISTS(SELECT 1 FROM invoice_line_cost_postings p WHERE p.invoice_id=i.id AND p.revoked_at IS NULL) THEN 'kostpris_fort'
 ELSE NULL END FROM invoices i WHERE i.id=p_invoice_id
$function$
;

CREATE OR REPLACE FUNCTION public._rm_reread_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
 IF ROW(NEW.id,NEW.legal_entity_id,NEW.invoice_id,NEW.created_by,NEW.created_at,NEW.expires_at,NEW.document_path,NEW.snapshot)
  IS DISTINCT FROM ROW(OLD.id,OLD.legal_entity_id,OLD.invoice_id,OLD.created_by,OLD.created_at,OLD.expires_at,OLD.document_path,OLD.snapshot) THEN RAISE EXCEPTION 'immutable_reread_snapshot'; END IF;
 IF OLD.status<>'reading' AND ROW(NEW.proposal,NEW.document_sha256,NEW.extractor) IS DISTINCT FROM ROW(OLD.proposal,OLD.document_sha256,OLD.extractor) THEN RAISE EXCEPTION 'immutable_reread_proposal'; END IF;
 IF OLD.status IN ('applied','cancelled','failed') THEN RAISE EXCEPTION 'reread_terminal'; END IF;
 IF NOT ((OLD.status='reading' AND NEW.status IN ('ready','failed','cancelled')) OR (OLD.status='ready' AND NEW.status IN ('applied','cancelled'))) THEN RAISE EXCEPTION 'reread_transition'; END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public._rm_reread_snapshot(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT jsonb_build_object(
  'invoice',to_jsonb(i),
  'lines',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]'::jsonb) FROM invoice_lines l WHERE l.invoice_id=i.id),
  'corrections',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) FROM invoice_line_corrections c WHERE c.invoice_id=i.id),
  'approvals',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM invoice_internal_approvals a WHERE a.invoice_id=i.id),
  'postings',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.invoice_line_id),'[]'::jsonb) FROM invoice_line_cost_postings p WHERE p.invoice_id=i.id),
  'document',(SELECT jsonb_build_object('id',o.id,'name',o.name,'updated_at',o.updated_at,'version',o.version,'metadata',o.metadata)
    FROM storage.objects o WHERE o.bucket_id='invoice-pdfs' AND o.name=i.source_document_url))
 FROM invoices i WHERE i.id=p_invoice_id
$function$
;

CREATE OR REPLACE FUNCTION public._rm_reread_values(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE k text; n numeric; outj jsonb:='{}';
 allowed constant text[]:=ARRAY['supplier_sku','description','quantity','unit','package_size','package_unit','count_per_package','unit_price','total_amount','line_kind','unit_price_basis','discount_amount'];
 numeric_fields constant text[]:=ARRAY['quantity','package_size','count_per_package','unit_price','total_amount','discount_amount'];
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ugyldige_felt'; END IF;
 FOR k IN SELECT jsonb_object_keys(p) LOOP
  IF NOT k=ANY(allowed) THEN RAISE EXCEPTION 'ukjent_felt: %',k; END IF;
  IF p->k <> 'null'::jsonb THEN
   IF k=ANY(numeric_fields) THEN
    IF jsonb_typeof(p->k)<>'number' THEN RAISE EXCEPTION 'ugyldig_tall: %',k; END IF;
    n:=(p->>k)::numeric;
    IF NOT rm_is_finite(n) OR (k IN ('package_size','count_per_package') AND n<=0) OR (k='discount_amount' AND n<0) THEN RAISE EXCEPTION 'ugyldig_tall: %',k; END IF;
   ELSE
    IF jsonb_typeof(p->k)<>'string' OR length(p->>k)>2000 THEN RAISE EXCEPTION 'ugyldig_tekst: %',k; END IF;
    IF k='line_kind' AND NOT (p->>k)=ANY(ARRAY['vare','pant','frakt','gebyr','rabatt','avrunding','mva','annet']) THEN RAISE EXCEPTION 'ugyldig_linjetype'; END IF;
    IF k='unit_price_basis' AND NOT (p->>k)=ANY(ARRAY['mengdeenhet','pakning','stk','kg','g','l','ml']) THEN RAISE EXCEPTION 'ugyldig_prisgrunnlag'; END IF;
   END IF;
  END IF;
  outj:=outj||jsonb_build_object(k,p->k);
 END LOOP;
 RETURN outj;
END $function$
;

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
 SELECT rm_lines_sum_check(sum(total_amount),count(*)::int,v.total_amount,v.total_vat) INTO sumcheck FROM invoice_lines WHERE invoice_id=v.id;
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
;

CREATE OR REPLACE FUNCTION public.rm_begin_invoice_reread(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v invoices%rowtype; uid uuid:=auth.uid(); snap jsonb; runid uuid; b text;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING errcode='28000'; END IF;
 SELECT * INTO v FROM invoices WHERE id=p_invoice_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'finnes_ikke'; END IF;
 IF NOT has_ravarer_invoice_access(v.legal_entity_id,'write') THEN RAISE EXCEPTION 'forbidden' USING errcode='42501'; END IF;
 b:=_rm_reread_blocker(v.id); IF b IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',b); END IF;
 PERFORM id FROM invoice_lines WHERE invoice_id=v.id ORDER BY id FOR UPDATE;
 PERFORM o.id FROM storage.objects o WHERE o.bucket_id='invoice-pdfs' AND o.name=v.source_document_url FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','dokument_mangler'); END IF;
 snap:=_rm_reread_snapshot(v.id);
 INSERT INTO invoice_reread_runs(legal_entity_id,invoice_id,created_by,document_path,snapshot)
 VALUES(v.legal_entity_id,v.id,uid,v.source_document_url,snap) RETURNING id INTO runid;
 RETURN jsonb_build_object('ok',true,'run_id',runid,'invoice_id',v.id,'legal_entity_id',v.legal_entity_id,'supplier_id',v.supplier_id,
  'document_path',v.source_document_url,'snapshot',snap,'expires_at',now()+interval '24 hours');
END $function$
;

CREATE OR REPLACE FUNCTION public.rm_cancel_invoice_reread(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE rr invoice_reread_runs%rowtype;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 SELECT * INTO rr FROM invoice_reread_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'finnes_ikke'; END IF;
 IF rr.created_by<>auth.uid() OR NOT has_ravarer_invoice_access(rr.legal_entity_id,'write') THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF rr.status IN ('reading','ready') THEN UPDATE invoice_reread_runs SET status='cancelled' WHERE id=rr.id; END IF;
 RETURN jsonb_build_object('ok',true,'run_id',rr.id);
END $function$
;

CREATE OR REPLACE FUNCTION public.rm_confirm_invoice_read_issues(p_invoice_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v invoices%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v from invoices where id = p_invoice_id for update;
  if not found then raise exception 'finnes_ikke' using errcode = 'P0002'; end if;
  if not has_ravarer_invoice_access(v.legal_entity_id, 'write') then raise exception 'forbidden: Mangler skrivetilgang til fakturaer' using errcode = '42501'; end if;
  if v.status is null or v.status not in ('imported','needs_review','ready') or v.reconciled_at is not null then
    raise exception 'faktura_last: Fakturaen er avstemt eller lukket.' using errcode = '55000'; end if;
  if v.flagged_at is not null then raise exception 'faktura_flagget' using errcode = '55000'; end if;
  if exists(select 1 from invoice_internal_approvals a where a.invoice_id=v.id and a.status='approved' and a.revoked_at is null) then
    raise exception 'faktura_godkjent' using errcode = '55000'; end if;
  if exists(select 1 from invoice_line_cost_postings p where p.invoice_id=v.id and p.revoked_at is null) then
    raise exception 'kostpris_fort' using errcode = '55000'; end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'begrunnelse: Skriv en begrunnelse.' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(v.extraction_issues,'[]'::jsonb)) = 0 then return jsonb_build_object('ok', true, 'already', true); end if;
  perform set_config('rm.read_issue_write', 'on', true);
  update invoices set extraction_issues = '[]'::jsonb, updated_at = now() where id = v.id;
  perform set_config('rm.read_issue_write', '', true);
  insert into audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'invoice.read_issues_confirmed', 'invoice', v.id, v.invoice_number, v.legal_entity_id,
          jsonb_build_object('issues', v.extraction_issues), btrim(p_reason), 'ravarer');
  return jsonb_build_object('ok', true, 'already', false);
end $function$
;

CREATE OR REPLACE FUNCTION public.rm_fail_invoice_reread(p_run_id uuid, p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 UPDATE invoice_reread_runs SET status='failed',error_code=left(coalesce(p_code,'lesing_feilet'),100) WHERE id=p_run_id AND status='reading';
END $function$
;

CREATE OR REPLACE FUNCTION public.rm_register_invoice_reread(p_run_id uuid, p_document_sha256 text, p_proposal jsonb, p_extractor jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE rr invoice_reread_runs%rowtype; c jsonb; ids text[]:='{}'; cid text;
BEGIN
 SELECT * INTO rr FROM invoice_reread_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'finnes_ikke'; END IF;
 IF rr.status='ready' AND rr.document_sha256=p_document_sha256 AND rr.proposal=p_proposal AND rr.extractor=p_extractor THEN RETURN jsonb_build_object('ok',true,'run_id',rr.id,'replayed',true); END IF;
 IF rr.status<>'reading' THEN RAISE EXCEPTION 'reread_ikke_under_lesing'; END IF;
 IF rr.expires_at<now() THEN RAISE EXCEPTION 'reread_utlopt'; END IF;
 IF p_document_sha256 IS NULL OR p_document_sha256 !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'ugyldig_document_hash'; END IF;
 IF jsonb_typeof(p_proposal) IS DISTINCT FROM 'object' OR jsonb_typeof(p_proposal->'candidates') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_proposal->'candidates')>500 OR octet_length(p_proposal::text)>2000000 THEN RAISE EXCEPTION 'ugyldig_forslag'; END IF;
 IF jsonb_typeof(p_extractor) IS DISTINCT FROM 'object' OR octet_length(p_extractor::text)>20000 THEN RAISE EXCEPTION 'ugyldig_lesermetadata'; END IF;
 IF p_proposal ? 'header' AND jsonb_typeof(p_proposal->'header') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ugyldig_forslag_header'; END IF;
 IF p_proposal ? 'invoice_issues' AND jsonb_typeof(p_proposal->'invoice_issues') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'ugyldige_fakturavarsler'; END IF;
 FOR c IN SELECT * FROM jsonb_array_elements(p_proposal->'candidates') LOOP
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR jsonb_typeof(c->'candidate_id') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'ugyldig_kandidat_id'; END IF;
  IF c ? 'issues' AND jsonb_typeof(c->'issues') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'ugyldige_linjevarsler'; END IF;
  IF c ? 'evidence' AND jsonb_typeof(c->'evidence') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ugyldig_linjebevis'; END IF;
  cid:=c->>'candidate_id';
  IF cid IS NULL OR length(cid) NOT BETWEEN 1 AND 80 OR cid=ANY(ids) THEN RAISE EXCEPTION 'ugyldig_kandidat_id'; END IF;
  ids:=array_append(ids,cid); PERFORM _rm_reread_values(c->'values');
 END LOOP;
 PERFORM id FROM invoices WHERE id=rr.invoice_id FOR UPDATE;
 PERFORM id FROM invoice_lines WHERE invoice_id=rr.invoice_id ORDER BY id FOR UPDATE;
 PERFORM o.id FROM storage.objects o WHERE o.bucket_id='invoice-pdfs' AND o.name=rr.document_path FOR SHARE;
 IF _rm_reread_snapshot(rr.invoice_id) IS DISTINCT FROM rr.snapshot THEN
  UPDATE invoice_reread_runs SET status='failed',error_code='snapshot_endret' WHERE id=rr.id;
  RETURN jsonb_build_object('ok',false,'code','snapshot_endret','run_id',rr.id);
 END IF;
 UPDATE invoice_reread_runs SET status='ready',proposal=p_proposal,document_sha256=p_document_sha256,extractor=p_extractor WHERE id=rr.id;
 RETURN jsonb_build_object('ok',true,'run_id',rr.id,'replayed',false);
END $function$
;
```
