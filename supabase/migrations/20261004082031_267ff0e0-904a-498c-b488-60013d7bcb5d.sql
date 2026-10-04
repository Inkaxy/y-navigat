CREATE OR REPLACE FUNCTION public.allocate_supplier_deviation_credit(p_case_id uuid, p_credit_invoice_id uuid, p_invoice_id uuid, p_amount_excl_vat numeric, p_client_ref uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); c supplier_deviation_cases%rowtype; cr invoices%rowtype; tgt invoices%rowtype;
  ex supplier_deviation_credits%rowtype; v_credit_total numeric; v_used numeric; v_rem numeric; v_amt numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF p_client_ref IS NULL THEN RAISE EXCEPTION 'client_ref_mangler'; END IF;
  SELECT * INTO c FROM supplier_deviation_cases WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sak_finnes_ikke' USING ERRCODE = 'P0002'; END IF;
  IF NOT has_ravarer_invoice_access(c.legal_entity_id, 'write') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_amount_excl_vat IS NULL OR NOT rm_is_finite(p_amount_excl_vat) OR p_amount_excl_vat <= 0 THEN RAISE EXCEPTION 'ugyldig_belop'; END IF;
  v_amt := round(p_amount_excl_vat, 2);
  PERFORM 1 FROM invoices WHERE id IN (p_credit_invoice_id, p_invoice_id) ORDER BY id FOR UPDATE;
  SELECT * INTO ex FROM supplier_deviation_credits WHERE client_ref = p_client_ref;
  IF FOUND THEN
    IF ex.case_id = c.id AND ex.credit_invoice_id = p_credit_invoice_id AND ex.invoice_id = p_invoice_id AND ex.amount_excl_vat = v_amt THEN
      RETURN jsonb_build_object('ok', true, 'already_saved', true, 'remaining_excl_vat', supplier_case_invoice_remaining(c.id, p_invoice_id));
    END IF;
    RAISE EXCEPTION 'client_ref_gjenbrukt';
  END IF;
  IF c.status <> 'open' THEN RAISE EXCEPTION 'sak_ikke_aapen'; END IF;
  SELECT * INTO cr FROM invoices WHERE id = p_credit_invoice_id;
  IF NOT FOUND OR NOT coalesce(cr.is_credit_note,false) THEN RAISE EXCEPTION 'ikke_kreditnota'; END IF;
  IF cr.legal_entity_id <> c.legal_entity_id OR cr.supplier_id IS DISTINCT FROM c.supplier_id THEN RAISE EXCEPTION 'kreditnota_annen_leverandor'; END IF;
  IF coalesce(cr.status,'') = 'cancelled' THEN RAISE EXCEPTION 'kreditnota_kansellert'; END IF;
  IF cr.flagged_at IS NOT NULL THEN RAISE EXCEPTION 'kreditnota_flagget'; END IF;
  -- Bare en kontrollert linjesum gir kapasitet; ukjent/ukontrollert er ikke «ok».
  IF cr.lines_sum_status IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'kreditnota_sumavvik'; END IF;
  IF cr.extraction_confidence IS NOT NULL AND cr.extraction_confidence < 0.6 THEN RAISE EXCEPTION 'kreditnota_lavt_uttrekk'; END IF;
  IF EXISTS (SELECT 1 FROM invoices o WHERE o.id <> cr.id AND o.legal_entity_id = cr.legal_entity_id AND o.supplier_id = cr.supplier_id
             AND o.invoice_number = cr.invoice_number AND coalesce(o.is_credit_note,false) AND coalesce(o.status,'') <> 'cancelled') THEN
    RAISE EXCEPTION 'kreditnota_duplikat';
  END IF;
  SELECT * INTO tgt FROM invoices WHERE id = p_invoice_id;
  IF NOT EXISTS (SELECT 1 FROM supplier_deviation_case_lines WHERE case_id = c.id AND invoice_id = p_invoice_id) THEN RAISE EXCEPTION 'faktura_ikke_i_saken'; END IF;
  IF upper(coalesce(cr.currency,'')) = '' OR upper(coalesce(cr.currency,'')) <> upper(coalesce(tgt.currency,'')) THEN RAISE EXCEPTION 'valuta_ulik'; END IF;
  v_credit_total := invoice_net_excl_vat(cr.total_amount, cr.total_vat);
  IF v_credit_total IS NULL THEN RAISE EXCEPTION 'kreditnota_mva_ukjent'; END IF;
  SELECT coalesce(sum(amount_excl_vat),0) INTO v_used FROM supplier_deviation_credits WHERE credit_invoice_id = cr.id;
  IF v_amt > v_credit_total - v_used + 0.005 THEN RAISE EXCEPTION 'kreditnota_overfordelt'; END IF;
  v_rem := supplier_case_invoice_remaining(c.id, p_invoice_id);
  IF v_amt > v_rem + 0.005 THEN RAISE EXCEPTION 'mer_enn_restavvik'; END IF;
  INSERT INTO supplier_deviation_credits (case_id, credit_invoice_id, invoice_id, amount_excl_vat, client_ref, note, created_by)
  VALUES (c.id, cr.id, p_invoice_id, v_amt, p_client_ref, nullif(trim(p_note),''), v_uid);
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  VALUES (v_uid, 'supplier_case.credit_allocated', 'supplier_deviation_case', c.id, c.legal_entity_id,
          jsonb_build_object('credit_invoice_id', cr.id, 'invoice_id', p_invoice_id, 'amount_excl_vat', v_amt, 'client_ref', p_client_ref), p_note, 'ravarer');
  RETURN jsonb_build_object('ok', true, 'already_saved', false, 'remaining_excl_vat', v_rem - v_amt);
END $function$;

DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.rm_post_safe_line_costs(uuid,uuid[])'::regprocedure);
  IF position($q$upper(coalesce(v.currency,'NOK')) <> 'NOK'$q$ in d) = 0 THEN RAISE EXCEPTION 'uventet definisjon'; END IF;
  d := replace(d, $q$upper(coalesce(v.currency,'NOK')) <> 'NOK'$q$, $q$v.currency IS NULL OR upper(v.currency) <> 'NOK'$q$);
  EXECUTE d;
END $m$;