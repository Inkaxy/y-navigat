-- Verified comparison cases: claims vs inquiries.
ALTER TABLE public.supplier_deviation_case_lines DROP CONSTRAINT IF EXISTS supplier_deviation_case_lines_amount_excl_vat_check;
ALTER TABLE public.supplier_deviation_case_lines ADD CONSTRAINT supplier_deviation_case_lines_amount_excl_vat_check CHECK(amount_excl_vat>0 OR (amount_excl_vat=0 AND coalesce(basis->>'case_kind','')='price_inquiry'));
ALTER TABLE public.supplier_case_email_drafts ADD COLUMN IF NOT EXISTS basis_snapshot jsonb;
CREATE OR REPLACE FUNCTION public._rm_claim_basis(p_line_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $f$
DECLARE l invoice_lines%rowtype; i invoices%rowtype; reason text; amount numeric;
BEGIN
 SELECT * INTO l FROM invoice_lines WHERE id=p_line_id;
 SELECT * INTO i FROM invoices WHERE id=l.invoice_id;
 IF l.id IS NULL OR i.id IS NULL THEN RAISE EXCEPTION 'claim_line_missing'; END IF;
 IF i.status IS NULL OR i.status NOT IN ('imported','needs_review','ready','reconciled') THEN RAISE EXCEPTION 'claim_invoice_status_unverified'; END IF;
 reason:=_rm_queue_line_read_issue(l.id,rm_invoice_has_read_issues(i.id));
 IF reason IS NOT NULL THEN RAISE EXCEPTION 'claim_unverified: %',reason; END IF;
 amount:=_rm_queue_line_effect(l.id,true);
 IF amount IS NULL THEN RAISE EXCEPTION 'claim_reference_stale_or_unverified'; END IF;
 IF NOT rm_is_finite(l.expected_price_per_base_unit) OR l.expected_price_per_base_unit<=0 OR l.price_per_base_unit<=l.expected_price_per_base_unit THEN RAISE EXCEPTION 'ingen_merkostnad'; END IF;
 RETURN invoice_line_price_basis(l)||jsonb_build_object('claim_validation_version',1,'case_kind',CASE WHEN l.price_reference_source='agreement' THEN 'documented_claim' ELSE 'price_inquiry' END,'observed_effect_excl_vat',round((l.price_per_base_unit-l.expected_price_per_base_unit)*l.base_quantity,2),'base_unit',(SELECT base_unit FROM raw_materials WHERE id=l.raw_material_id),
 'invoice_context',jsonb_build_object('legal_entity_id',i.legal_entity_id,'supplier_id',i.supplier_id,'invoice_date',i.invoice_date,'invoice_number',i.invoice_number,'total_amount',i.total_amount,'total_vat',i.total_vat,'currency',i.currency,'is_credit_note',i.is_credit_note,'source_document_url',i.source_document_url),
 'reading_context',jsonb_build_object('supplier_sku',l.supplier_sku,'description',l.description,'unit_price_basis',l.unit_price_basis,'discount_amount',l.discount_amount,'extraction_issues',l.extraction_issues),
 'amount_excl_vat',CASE WHEN l.price_reference_source='agreement' THEN round((l.price_per_base_unit-l.expected_price_per_base_unit)*l.base_quantity,2) ELSE 0 END);
END $f$;

CREATE OR REPLACE FUNCTION public.accept_invoice_line_price_variance(p_line_id uuid, p_observed jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_line public.invoice_lines%ROWTYPE;
  v_inv  public.invoices%ROWTYPE;
  v_uid uuid := auth.uid();
  v_reasons text[];
  v_basis jsonb;
  v_current jsonb;
  v_snapshot jsonb;
  v_allowed constant text[] := ARRAY['price_variance','price_increase','price_drop'];
  v_invoice_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF p_observed IS NULL OR jsonb_typeof(p_observed) <> 'object' THEN
    RAISE EXCEPTION 'stale_line' USING ERRCODE = '40001';
  END IF;

  -- Samme låserekkefølge som rm_reconcile_invoice: faktura først, så linjer.
  SELECT invoice_id INTO v_invoice_id FROM public.invoice_lines WHERE id = p_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'line_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_inv FROM public.invoices WHERE id = v_invoice_id FOR UPDATE;
  IF public.has_ravarer_invoice_access(v_inv.legal_entity_id, 'write') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_line FROM public.invoice_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND OR v_line.invoice_id <> v_inv.id THEN
    RAISE EXCEPTION 'stale_line' USING ERRCODE = '40001';
  END IF;

  IF v_inv.status IS NULL OR v_inv.status NOT IN ('imported','needs_review','ready') OR v_inv.flagged_at IS NOT NULL THEN
    RAISE EXCEPTION 'invoice_locked' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS(SELECT 1 FROM invoice_internal_approvals WHERE invoice_id=v_inv.id AND status='approved' AND revoked_at IS NULL)
     OR EXISTS(SELECT 1 FROM invoice_line_cost_postings WHERE invoice_line_id=v_line.id AND revoked_at IS NULL)
     OR v_inv.reconciled_at IS NOT NULL THEN RAISE EXCEPTION 'invoice_locked'; END IF;
  IF _rm_queue_line_read_issue(v_line.id,rm_invoice_has_read_issues(v_inv.id)) IS NOT NULL
     OR _rm_queue_line_effect(v_line.id,true) IS NULL THEN RAISE EXCEPTION 'claim_reference_stale_or_unverified'; END IF;
  -- Bare en bekreftet eller radpresis kobling — aldri et forslag.
  IF v_line.raw_material_id IS NULL OR coalesce(v_line.match_confidence, '') NOT IN ('manual','auto_high') THEN
    RAISE EXCEPTION 'line_not_linked' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.rm_is_finite(v_line.price_per_base_unit) OR v_line.price_per_base_unit <= 0
     OR NOT public.rm_is_finite(v_line.expected_price_per_base_unit) OR v_line.expected_price_per_base_unit <= 0 THEN
    RAISE EXCEPTION 'price_basis_missing' USING ERRCODE = 'P0001';
  END IF;

  v_reasons := array_remove(string_to_array(coalesce(v_line.review_reason, ''), ','), '');
  IF coalesce(array_length(v_reasons, 1), 0) = 0 OR NOT (v_reasons <@ v_allowed)
     OR NOT coalesce(v_line.requires_review, false) THEN
    RAISE EXCEPTION 'not_only_price_variance' USING ERRCODE = 'P0001';
  END IF;

  v_basis := public.invoice_line_price_basis(v_line);
  v_current := v_basis - 'rms_id' - 'rms_package';
  BEGIN
    IF public._normalize_price_basis(p_observed) IS DISTINCT FROM public._normalize_price_basis(v_current) THEN
      RAISE EXCEPTION 'stale_line' USING ERRCODE = '40001';
    END IF;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'stale_line' USING ERRCODE = '40001';
  END;

  v_snapshot := v_basis || jsonb_build_object(
    'accepted_reasons', to_jsonb(v_reasons),
    'price_variance_pct', v_line.price_variance_pct,
    'accepted_by', v_uid,
    'accepted_at', now());

  UPDATE public.invoice_lines SET
    requires_review = false,
    review_reason = NULL,
    resolution_note = 'Prisavvik godtatt',
    resolved_by = v_uid,
    resolved_at = now(),
    price_acceptance = v_snapshot,
    updated_at = now()
  WHERE id = p_line_id;

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  VALUES (v_uid, 'invoice_line.price_variance_accepted', 'invoice_line', p_line_id, v_inv.legal_entity_id,
          v_snapshot, 'Prisavvik godtatt', 'ravarer');

  RETURN v_snapshot;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_supplier_deviation_case(p_line_ids uuid[], p_title text, p_reason text DEFAULT NULL::text, p_responsible_user_id uuid DEFAULT NULL::uuid, p_follow_up_on date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_entity uuid; v_supplier uuid; v_case uuid; r record; v_amt numeric; n int := 0; v_verified jsonb; v_kind text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF coalesce(array_length(p_line_ids,1),0) = 0 THEN RAISE EXCEPTION 'ingen_linjer'; END IF;
  IF coalesce(trim(p_title),'') = '' THEN RAISE EXCEPTION 'tittel_mangler'; END IF;
  SELECT count(DISTINCT i.legal_entity_id), min(i.legal_entity_id::text)::uuid, count(DISTINCT i.supplier_id), min(i.supplier_id::text)::uuid
    INTO n, v_entity, n, v_supplier FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE il.id = ANY(p_line_ids);
  IF (SELECT count(DISTINCT i.legal_entity_id) FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE il.id = ANY(p_line_ids)) <> 1
     OR (SELECT count(DISTINCT i.supplier_id) FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE il.id = ANY(p_line_ids)) <> 1
     OR (SELECT count(*) FROM invoice_lines WHERE id = ANY(p_line_ids)) <> (SELECT count(DISTINCT x) FROM unnest(p_line_ids) x) THEN
    RAISE EXCEPTION 'linjene_maa_ha_samme_selskap_og_leverandor';
  END IF;
  IF v_supplier IS NULL THEN RAISE EXCEPTION 'leverandor_mangler'; END IF;
  IF has_ravarer_invoice_access(v_entity, 'write') IS DISTINCT FROM true THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM invoices WHERE id IN (SELECT invoice_id FROM invoice_lines WHERE id = ANY(p_line_ids)) ORDER BY id FOR UPDATE;
  INSERT INTO supplier_deviation_cases (legal_entity_id, supplier_id, title, reason, responsible_user_id, follow_up_on, created_by)
  VALUES (v_entity, v_supplier, trim(p_title), nullif(trim(p_reason),''), p_responsible_user_id, p_follow_up_on, v_uid) RETURNING id INTO v_case;
  n := 0;
  FOR r IN SELECT il.* FROM invoice_lines il WHERE il.id = ANY(p_line_ids) ORDER BY il.id FOR UPDATE LOOP
    IF EXISTS (SELECT 1 FROM supplier_deviation_case_lines l JOIN supplier_deviation_cases c ON c.id = l.case_id
               WHERE l.invoice_line_id = r.id AND c.status = 'open' AND c.id <> v_case) THEN
      RAISE EXCEPTION 'linje_allerede_i_aapen_sak';
    END IF;
    IF NOT rm_is_finite(r.price_per_base_unit) OR NOT rm_is_finite(r.expected_price_per_base_unit)
       OR r.base_quantity IS NULL OR NOT rm_is_finite(r.base_quantity) OR r.base_quantity <= 0 THEN
      RAISE EXCEPTION 'prisgrunnlag_mangler';
    END IF;
    v_verified := _rm_claim_basis(r.id);
    IF (v_verified->'invoice_context'->>'legal_entity_id') IS DISTINCT FROM v_entity::text
       OR (v_verified->'invoice_context'->>'supplier_id') IS DISTINCT FROM v_supplier::text THEN RAISE EXCEPTION 'forbidden'; END IF;
    IF v_kind IS NOT NULL AND v_kind IS DISTINCT FROM v_verified->>'case_kind' THEN RAISE EXCEPTION 'claim_mixed_kinds_split_required'; END IF;
    v_kind:=v_verified->>'case_kind';
    v_amt:=(v_verified->>'amount_excl_vat')::numeric;
    INSERT INTO supplier_deviation_case_lines (case_id, invoice_id, invoice_line_id, amount_excl_vat, basis)
    VALUES (v_case, r.invoice_id, r.id, v_amt, v_verified);
    n := n + 1;
  END LOOP;
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  VALUES (v_uid, 'supplier_case.created', 'supplier_deviation_case', v_case, v_entity, jsonb_build_object('lines', n), p_reason, 'ravarer');
  RETURN jsonb_build_object('ok', true, 'case_id', v_case, 'lines', n,'case_kind',v_kind);
END $function$
;

CREATE OR REPLACE FUNCTION public._rm_validate_case_claim(p_case_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $f$
DECLARE c supplier_deviation_cases%rowtype; r record; b jsonb; n int:=0;
BEGIN
 SELECT * INTO c FROM supplier_deviation_cases WHERE id=p_case_id FOR UPDATE;
 IF c.id IS NULL OR c.status<>'open' THEN RAISE EXCEPTION 'claim_case_not_open'; END IF;
 IF auth.uid() IS NULL OR has_ravarer_invoice_access(c.legal_entity_id,'write') IS DISTINCT FROM true THEN RAISE EXCEPTION 'forbidden'; END IF;
 PERFORM id FROM invoices WHERE id IN(SELECT invoice_id FROM supplier_deviation_case_lines WHERE case_id=c.id) ORDER BY id FOR UPDATE;
 FOR r IN SELECT cl.* FROM supplier_deviation_case_lines cl WHERE cl.case_id=c.id ORDER BY cl.invoice_line_id FOR UPDATE LOOP
  PERFORM id FROM invoice_lines WHERE id=r.invoice_line_id FOR UPDATE;
  b:=_rm_claim_basis(r.invoice_line_id);
  IF (b->'invoice_context'->>'legal_entity_id') IS DISTINCT FROM c.legal_entity_id::text OR (b->'invoice_context'->>'supplier_id') IS DISTINCT FROM c.supplier_id::text THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF r.basis IS DISTINCT FROM b OR r.amount_excl_vat IS DISTINCT FROM (b->>'amount_excl_vat')::numeric THEN RAISE EXCEPTION 'claim_basis_changed_or_legacy'; END IF;
  n:=n+1;
 END LOOP;
 IF n=0 THEN RAISE EXCEPTION 'claim_line_missing'; END IF;
END $f$;

CREATE OR REPLACE FUNCTION public.supplier_case_queue_draft_to_henrik(p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); d supplier_case_email_drafts%rowtype; c supplier_deviation_cases%rowtype;
  v_sup text; v_out uuid; v_status text;
  c_recipient constant text := 'Henrik@nottero-bakeri.no';
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into d from supplier_case_email_drafts where id = p_draft_id;
  if not found then raise exception 'finnes_ikke' using errcode = 'P0002'; end if;
  -- Consistent case -> draft -> invoice -> line order. Closing a case locks the same case row.
  select * into c from supplier_deviation_cases where id=d.case_id for update;
  if not found then raise exception 'finnes_ikke' using errcode = 'P0002'; end if;
  select * into d from supplier_case_email_drafts where id=p_draft_id for update;
  if d.case_id is distinct from c.id then raise exception 'claim_draft_changed'; end if;
  if not found then raise exception 'finnes_ikke' using errcode = 'P0002'; end if;
  if has_ravarer_invoice_access(d.legal_entity_id, 'write') IS DISTINCT FROM true then raise exception 'forbidden: Mangler skrivetilgang til fakturaer' using errcode = '42501'; end if;
  select id, status into v_out, v_status from email_outbox where related_entity_type = 'supplier_case_email_draft' and related_entity_id = d.id;
  if v_out is not null then
    return jsonb_build_object('ok', true, 'already', true, 'outbox_id', v_out, 'status', v_status);
  end if;
  perform _rm_validate_case_claim(d.case_id);
  IF d.basis_snapshot IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('id',id,'basis',basis,'amount_excl_vat',amount_excl_vat) ORDER BY id) FROM supplier_deviation_case_lines WHERE case_id=d.case_id) THEN RAISE EXCEPTION 'claim_draft_basis_changed_or_legacy'; END IF;
  select * into c from supplier_deviation_cases where id = d.case_id;
  select name into v_sup from suppliers where id = c.supplier_id;
  insert into email_outbox (template_key, recipient_email, variables, status, related_entity_type, related_entity_id)
  values ('supplier_case_draft_internal', c_recipient,
          jsonb_build_object('subject', d.subject, 'body', d.body, 'case_title', coalesce(c.title,''),
                             'supplier_name', coalesce(v_sup,''), 'version', d.version::text),
          'pending', 'supplier_case_email_draft', d.id)
  returning id into v_out;
  insert into audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'supplier_case.email_draft_queued', 'supplier_deviation_case', c.id, c.title, c.legal_entity_id,
          jsonb_build_object('draft_id', d.id, 'version', d.version, 'outbox_id', v_out, 'internal_only', true),
          'Intern kladd lagt i kø til Henrik. Ikke sendt til leverandøren.', 'ravarer');
  return jsonb_build_object('ok', true, 'already', false, 'outbox_id', v_out, 'status', 'pending');
end $function$
;

CREATE OR REPLACE FUNCTION public.supplier_case_save_email_draft(p_case_id uuid, p_subject text, p_body text, p_missing_basis boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); c supplier_deviation_cases%rowtype; v_ver int; v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into c from supplier_deviation_cases where id = p_case_id for update;
  if not found then raise exception 'finnes_ikke' using errcode = 'P0002'; end if;
  if has_ravarer_invoice_access(c.legal_entity_id, 'write') IS DISTINCT FROM true then raise exception 'forbidden: Mangler skrivetilgang til fakturaer' using errcode = '42501'; end if;
  perform _rm_validate_case_claim(c.id);
  if length(btrim(coalesce(p_subject,''))) = 0 or length(p_subject) > 300 then raise exception 'emne: Emnet må ha 1–300 tegn.' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_body,''))) = 0 or length(p_body) > 20000 then raise exception 'tekst: Teksten må ha 1–20 000 tegn.' using errcode = '22023'; end if;
  select coalesce(max(version), 0) + 1 into v_ver from supplier_case_email_drafts where case_id = c.id;
  insert into supplier_case_email_drafts (case_id, legal_entity_id, version, subject, body, missing_basis, created_by,basis_snapshot)
  values (c.id, c.legal_entity_id, v_ver, btrim(p_subject), p_body, coalesce(p_missing_basis,false) OR EXISTS(SELECT 1 FROM supplier_deviation_case_lines WHERE case_id=c.id AND basis->>'case_kind'='price_inquiry'), v_uid,
    (SELECT jsonb_agg(jsonb_build_object('id',id,'basis',basis,'amount_excl_vat',amount_excl_vat) ORDER BY id) FROM supplier_deviation_case_lines WHERE case_id=c.id))
  returning id into v_id;
  insert into audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, source_app)
  values (v_uid, 'supplier_case.email_draft_saved', 'supplier_deviation_case', c.id, c.title, c.legal_entity_id,
          jsonb_build_object('draft_id', v_id, 'version', v_ver), 'ravarer');
  return jsonb_build_object('ok', true, 'draft_id', v_id, 'version', v_ver);
end $function$
;

REVOKE ALL ON FUNCTION public._rm_claim_basis(uuid),public._rm_validate_case_claim(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Authoritative read-only eligibility, no monetary fallback from unverified lines.
CREATE OR REPLACE FUNCTION public.rm_supplier_claim_preview(p_line_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $f$
DECLARE lid uuid; ent uuid; b jsonb; outj jsonb:='[]'; why text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 IF coalesce(array_length(p_line_ids,1),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'ingen_linjer'; END IF;
 FOREACH lid IN ARRAY p_line_ids LOOP
  SELECT i.legal_entity_id INTO ent FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE l.id=lid;
  IF ent IS NULL OR has_ravarer_invoice_access(ent,'write') IS DISTINCT FROM true THEN RAISE EXCEPTION 'forbidden'; END IF;
  BEGIN
   b:=_rm_claim_basis(lid);
   outj:=outj||jsonb_build_array(jsonb_build_object('line_id',lid,'eligible',true,'basis',b));
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS why=MESSAGE_TEXT;
   outj:=outj||jsonb_build_array(jsonb_build_object('line_id',lid,'eligible',false,'reason',why));
  END;
 END LOOP;
 RETURN jsonb_build_object('lines',outj);
END $f$;
REVOKE ALL ON FUNCTION public.rm_supplier_claim_preview(uuid[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rm_supplier_claim_preview(uuid[]) TO authenticated;
CREATE OR REPLACE FUNCTION public.rm_supplier_item_claim_credit(p_legal_entity_id uuid, p_supplier_id uuid, p_item_key text, p_lines jsonb, p_title text, p_reason text DEFAULT NULL::text, p_responsible_user_id uuid DEFAULT NULL::uuid, p_follow_up_on date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ids uuid[]; v_case jsonb; v_acc jsonb; v_lines jsonb; v_selected jsonb; v_current jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if public.has_ravarer_invoice_access(p_legal_entity_id, 'write') IS DISTINCT FROM true then
    raise exception 'Mangler skrivetilgang til fakturaer' using errcode = '42501';
  end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'Saken må ha en tittel' using errcode = '22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Velg linjene kravet gjelder' using errcode = '22023';
  end if;

  -- Kandidater: linjer på varekortet, uendret pris siden visning, fakturert pris HØYERE enn forventet og mengde kjent.
  IF jsonb_array_length(p_lines)>500 THEN RAISE EXCEPTION 'claim_too_many_lines'; END IF;
  PERFORM i.id FROM invoices i WHERE i.legal_entity_id=p_legal_entity_id AND i.id IN
    (SELECT l.invoice_id FROM invoice_lines l JOIN jsonb_array_elements(p_lines) e ON l.id=(e->>'id')::uuid) ORDER BY i.id FOR UPDATE;
  PERFORM l.id FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
    WHERE i.legal_entity_id=p_legal_entity_id AND l.id IN(SELECT (e->>'id')::uuid FROM jsonb_array_elements(p_lines)e) ORDER BY l.id FOR UPDATE OF l;
  FOR v_selected IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF NOT EXISTS(SELECT 1 FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE l.id=(v_selected->>'id')::uuid AND i.legal_entity_id=p_legal_entity_id AND i.supplier_id=p_supplier_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
    v_current:=_rm_claim_basis((v_selected->>'id')::uuid);
    IF v_selected->'basis' IS DISTINCT FROM v_current THEN RAISE EXCEPTION 'claim_preview_required_or_changed'; END IF;
    IF NOT EXISTS(SELECT 1 FROM invoice_lines l WHERE l.id=(v_selected->>'id')::uuid AND
      (CASE WHEN rm_sku_norm(l.supplier_sku)<>'' THEN 'sku:'||rm_sku_norm(l.supplier_sku) ELSE 'name:'||rm_match_key(l.description) END)=p_item_key
      AND l.price_per_base_unit IS NOT DISTINCT FROM (v_selected->>'price_per_base_unit')::numeric) THEN RAISE EXCEPTION 'claim_preview_required_or_changed'; END IF;
  END LOOP;
  select jsonb_agg(jsonb_build_object('id', il.id, 'price_per_base_unit', il.price_per_base_unit))
    into v_lines
    from jsonb_array_elements(p_lines) e
    join invoice_lines il on il.id = (e->>'id')::uuid
    join invoices i on i.id = il.invoice_id
   where i.legal_entity_id = p_legal_entity_id and i.supplier_id = p_supplier_id
     and (case when public.rm_sku_norm(il.supplier_sku) <> '' then 'sku:' || public.rm_sku_norm(il.supplier_sku)
               else 'name:' || public.rm_match_key(il.description) end) = p_item_key
     and il.price_per_base_unit is not distinct from nullif(e->>'price_per_base_unit','')::numeric
     and il.price_per_base_unit > il.expected_price_per_base_unit
     and il.expected_price_per_base_unit > 0 and il.base_quantity > 0
     and public.rm_is_finite(il.price_per_base_unit) and public.rm_is_finite(il.base_quantity);
  if v_lines is null then
    return jsonb_build_object('ok', false, 'reason', 'ingen_merkostnad');
  end if;

  -- 1) Godta prisen (fakturaen er det leverandøren faktisk krevde) så fakturaen kan avstemmes.
  --    Grunnlaget for saken lagres på linjen før den løses, så kravet blir riktig.
  -- create_supplier_deviation_case leser pris/forventet/mengde fra linjen; de endres ikke av godkjenningen.
  v_acc := public.rm_supplier_item_accept_price(p_legal_entity_id, p_supplier_id, p_item_key, v_lines,
             coalesce(nullif(btrim(p_reason), ''), 'Kreditt kreves i leverandørsak'));
  select array_agg((x->>'id')::uuid order by (x->>'id')) into v_ids from jsonb_array_elements(v_acc->'accepted_lines') x;
  IF coalesce(array_length(v_ids,1),0) <> (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(p_lines)e) THEN RAISE EXCEPTION 'claim_some_lines_rejected'; END IF;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'ingen_godtatt', 'skipped_lines', v_acc->'skipped_lines');
  end if;

  -- 2) Opprett saken for de godtatte linjene.
  v_case := public.create_supplier_deviation_case(v_ids, p_title, p_reason, p_responsible_user_id, p_follow_up_on);
  update invoice_lines set resolution_note = CASE WHEN v_case->>'case_kind'='price_inquiry' THEN 'Prisforespørsel i leverandørsak: ' ELSE 'Kreditt kreves i leverandørsak: ' END || btrim(p_title) where id = any(v_ids);

  return jsonb_build_object('ok', true, 'case_id', v_case->'case_id', 'case_lines', v_case->'lines', 'case_kind',v_case->>'case_kind',
                            'accepted', v_acc->'accepted', 'skipped_lines', v_acc->'skipped_lines', 'rematch', v_acc->'rematch');
end;
$function$
;