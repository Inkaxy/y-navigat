
CREATE OR REPLACE FUNCTION public.has_ravarer_invoice_approve(_legal_entity_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select exists (select 1 from user_positions up
    join position_app_access paa on paa.position_id = up.position_id
    join apps a on a.id = paa.app_id
   where up.user_id = auth.uid() and a.code = 'ravarer' and paa.invoice_access = true
     and up.legal_entity_id = _legal_entity_id and up.valid_from <= current_date
     and (up.valid_to is null or up.valid_to >= current_date)
     and paa.level::text in ('approve','admin'))
$$;

-- Avvikslinje fullt dekket av kreditfordeling i sin sak (åpen eller løst).
CREATE OR REPLACE FUNCTION public.invoice_line_credit_covered(p_line_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select exists (select 1 from supplier_deviation_case_lines l join supplier_deviation_cases c on c.id = l.case_id
   where l.invoice_line_id = p_line_id and c.status in ('open','resolved')
     and public.supplier_case_invoice_remaining(c.id, l.invoice_id) <= 0.005)
$$;

CREATE OR REPLACE FUNCTION public.invoice_approval_blockers(p_invoice_id uuid) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v invoices%rowtype; b text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN ARRAY['finnes_ikke']::text[]; END IF;
  IF v.flagged_at IS NOT NULL THEN b := array_append(b, 'flagget'); END IF;
  IF v.status = 'cancelled' THEN b := array_append(b, 'kansellert'); END IF;
  IF v.supplier_id IS NULL THEN b := array_append(b, 'leverandor_mangler'); END IF;
  IF NOT rm_is_finite(v.total_amount) THEN b := array_append(b, 'belop_mangler'); END IF;
  IF NOT rm_is_finite(v.total_vat) THEN b := array_append(b, 'mva_ukjent'); END IF;
  IF coalesce(trim(v.currency),'') = '' THEN b := array_append(b, 'valuta_mangler'); END IF;
  IF NOT EXISTS (SELECT 1 FROM invoice_lines WHERE invoice_id = v.id) THEN
    b := array_append(b, 'mangler_linjer');
  ELSIF v.lines_sum_status = 'mismatch' THEN
    b := array_append(b, 'sumavvik');
  ELSIF coalesce(v.lines_sum_status,'') <> 'ok' THEN
    b := array_append(b, 'sum_ukontrollert');
  END IF;
  IF v.extraction_confidence IS NOT NULL AND v.extraction_confidence < 0.6 THEN b := array_append(b, 'lavt_uttrekk'); END IF;
  IF EXISTS (SELECT 1 FROM invoices o WHERE o.id <> v.id AND o.legal_entity_id = v.legal_entity_id
             AND o.supplier_id IS NOT DISTINCT FROM v.supplier_id AND o.invoice_number = v.invoice_number
             AND coalesce(o.is_credit_note,false) = coalesce(v.is_credit_note,false) AND coalesce(o.status,'') <> 'cancelled') THEN
    b := array_append(b, 'duplikat');
  END IF;
  IF EXISTS (SELECT 1 FROM invoice_lines il WHERE il.invoice_id = v.id
             AND coalesce(il.match_confidence::text,'') <> 'not_applicable'
             AND (il.review_reason ~ '(extraction_issue|extraction_unresolved|zero_quantity)'
               OR (rm_is_finite(il.quantity) AND rm_is_finite(il.unit_price) AND rm_is_finite(il.total_amount)
                   AND il.quantity > 0 AND il.total_amount <> 0
                   AND abs(il.quantity * il.unit_price - il.total_amount) > 0.015 * abs(il.total_amount)
                   AND NOT (rm_is_finite(il.base_quantity) AND il.base_quantity > 0
                            AND abs(il.base_quantity * il.unit_price - il.total_amount) <= 0.015 * abs(il.total_amount))))) THEN
    b := array_append(b, 'mengde');
  END IF;
  IF EXISTS (SELECT 1 FROM invoice_lines il WHERE il.invoice_id = v.id AND coalesce(il.requires_review,false)
             AND il.review_reason ~ '(price_variance|price_increase|price_drop|agreement_conflict)'
             AND NOT public.invoice_line_credit_covered(il.id)) THEN
    b := array_append(b, 'prisavvik');
  END IF;
  IF EXISTS (SELECT 1 FROM supplier_deviation_case_lines l JOIN supplier_deviation_cases c ON c.id = l.case_id
             WHERE l.invoice_id = v.id AND c.status = 'open'
             AND public.supplier_case_invoice_remaining(c.id, v.id) > 0.005) THEN
    b := array_append(b, 'leverandorsak');
  END IF;
  RETURN b;
END $$;

CREATE OR REPLACE FUNCTION public.approve_invoice_internal(p_invoice_id uuid, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v invoices%rowtype; v_uid uuid := auth.uid(); b text[]; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'finnes_ikke' USING ERRCODE = 'P0002'; END IF;
  IF NOT has_ravarer_invoice_approve(v.legal_entity_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_id FROM invoice_internal_approvals WHERE invoice_id = v.id AND status = 'approved';
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'already_approved', true, 'id', v_id); END IF;
  b := invoice_approval_blockers(v.id);
  IF coalesce(array_length(b,1),0) > 0 THEN RETURN jsonb_build_object('ok', false, 'blockers', to_jsonb(b)); END IF;
  INSERT INTO invoice_internal_approvals (invoice_id, legal_entity_id, note, approved_by, basis)
  VALUES (v.id, v.legal_entity_id, nullif(trim(p_note),''), v_uid,
          jsonb_build_object('total_amount', v.total_amount, 'total_vat', v.total_vat, 'currency', v.currency,
            'lines_sum_status', v.lines_sum_status, 'lines_sum_excl_vat', v.lines_sum_excl_vat, 'status', v.status))
  RETURNING id INTO v_id;
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  VALUES (v_uid, 'invoice.internal_approved', 'invoice', v.id, v.legal_entity_id, jsonb_build_object('approval_id', v_id), p_note, 'ravarer');
  RETURN jsonb_build_object('ok', true, 'already_approved', false, 'id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.revoke_invoice_internal_approval(p_invoice_id uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v invoices%rowtype; v_uid uuid := auth.uid(); n int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF coalesce(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'begrunnelse_mangler'; END IF;
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'finnes_ikke' USING ERRCODE = 'P0002'; END IF;
  IF NOT has_ravarer_invoice_approve(v.legal_entity_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE invoice_internal_approvals SET status = 'revoked', revoked_by = v_uid, revoked_at = now(), revoke_reason = trim(p_reason)
   WHERE invoice_id = v.id AND status = 'approved';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
    VALUES (v_uid, 'invoice.internal_approval_revoked', 'invoice', v.id, v.legal_entity_id, '{}'::jsonb, p_reason, 'ravarer');
  END IF;
  RETURN jsonb_build_object('ok', true, 'revoked', n > 0);
END $$;

-- Nettobeløp på kreditnota: ukjent mva gir ukjent netto.
CREATE OR REPLACE FUNCTION public.invoice_net_excl_vat(p_total numeric, p_vat numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  select case when rm_is_finite(p_total) and rm_is_finite(p_vat) then round(abs(p_total) - abs(p_vat), 2) end
$$;

CREATE OR REPLACE FUNCTION public.allocate_supplier_deviation_credit(p_case_id uuid, p_credit_invoice_id uuid, p_invoice_id uuid,
  p_amount_excl_vat numeric, p_client_ref uuid, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  -- Lås fakturaene i fast rekkefølge før replay-kontroll.
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
  IF cr.lines_sum_status = 'mismatch' THEN RAISE EXCEPTION 'kreditnota_sumavvik'; END IF;
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
END $$;

-- Bekreftede pakningsvarianter per leverandørkobling. Bevares når koblingen får ny pakning.
CREATE TABLE public.raw_material_supplier_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_supplier_id uuid NOT NULL REFERENCES public.raw_material_suppliers(id) ON DELETE CASCADE,
  supplier_sku_norm text NOT NULL DEFAULT '',
  package_size numeric,
  package_unit text,
  base_units_per_package numeric NOT NULL CHECK (base_units_per_package > 0),
  confirmed_at timestamptz NOT NULL,
  confirmed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rmsp_variant ON public.raw_material_supplier_packages
  (raw_material_supplier_id, supplier_sku_norm, coalesce(package_size, -1), coalesce(lower(package_unit), ''), base_units_per_package);
GRANT SELECT ON public.raw_material_supplier_packages TO authenticated;
GRANT ALL ON public.raw_material_supplier_packages TO service_role;
ALTER TABLE public.raw_material_supplier_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Les bekreftede pakningsvarianter" ON public.raw_material_supplier_packages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.raw_material_suppliers s JOIN public.raw_materials r ON r.id = s.raw_material_id
                 WHERE s.id = raw_material_supplier_id AND public.has_ravarer_invoice_access(r.legal_entity_id, 'read')));
CREATE TRIGGER trg_rmsp_touch BEFORE UPDATE ON public.raw_material_supplier_packages FOR EACH ROW EXECUTE FUNCTION public._nb_touch_updated_at();

CREATE OR REPLACE FUNCTION public.rm_sku_norm(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  select regexp_replace(lower(coalesce(p,'')), '[^a-z0-9]', '', 'g')
$$;

CREATE OR REPLACE FUNCTION public._rms_record_package_variant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.package_confirmed_at IS NOT NULL AND OLD.base_units_per_package IS NOT NULL THEN
    INSERT INTO raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_size, package_unit, base_units_per_package, confirmed_at, confirmed_by)
    VALUES (OLD.id, rm_sku_norm(OLD.supplier_sku), OLD.package_size, OLD.package_unit, OLD.base_units_per_package, OLD.package_confirmed_at, OLD.package_confirmed_by)
    ON CONFLICT DO NOTHING;
  END IF;
  IF NEW.package_confirmed_at IS NOT NULL AND NEW.base_units_per_package IS NOT NULL THEN
    INSERT INTO raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_size, package_unit, base_units_per_package, confirmed_at, confirmed_by)
    VALUES (NEW.id, rm_sku_norm(NEW.supplier_sku), NEW.package_size, NEW.package_unit, NEW.base_units_per_package, NEW.package_confirmed_at, NEW.package_confirmed_by)
    ON CONFLICT (raw_material_supplier_id, supplier_sku_norm, coalesce(package_size, -1), coalesce(lower(package_unit), ''), base_units_per_package)
    DO UPDATE SET confirmed_at = EXCLUDED.confirmed_at, confirmed_by = EXCLUDED.confirmed_by;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_rms_package_variant AFTER INSERT OR UPDATE OF package_size, package_unit, base_units_per_package, package_confirmed_at, supplier_sku
  ON public.raw_material_suppliers FOR EACH ROW EXECUTE FUNCTION public._rms_record_package_variant();

INSERT INTO public.raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_size, package_unit, base_units_per_package, confirmed_at, confirmed_by)
SELECT id, public.rm_sku_norm(supplier_sku), package_size, package_unit, base_units_per_package, package_confirmed_at, package_confirmed_by
  FROM public.raw_material_suppliers WHERE package_confirmed_at IS NOT NULL AND base_units_per_package IS NOT NULL
ON CONFLICT DO NOTHING;

-- Trygge kostpriser: bekreftet råvare, dokumentert pakning og stemmende regnestykke.
CREATE OR REPLACE FUNCTION public.rm_post_safe_line_costs(p_invoice_id uuid, p_line_ids uuid[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v invoices%rowtype; v_uid uuid := auth.uid(); r record; v_reasons text[]; v_first boolean; v_posted int := 0;
  v_skipped jsonb := '[]'::jsonb; b text[]; v_pkg_ok boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'finnes_ikke' USING ERRCODE = 'P0002'; END IF;
  IF NOT has_ravarer_invoice_access(v.legal_entity_id, 'write') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM invoice_lines WHERE invoice_id = v.id ORDER BY id FOR UPDATE;
  IF coalesce(v.is_credit_note,false) THEN RAISE EXCEPTION 'kreditnota'; END IF;
  IF v.status NOT IN ('imported','needs_review','ready') THEN RAISE EXCEPTION 'faktura_status'; END IF;
  IF upper(coalesce(v.currency,'NOK')) <> 'NOK' THEN RAISE EXCEPTION 'valuta'; END IF;
  b := invoice_approval_blockers(v.id);
  IF b && ARRAY['flagget','sumavvik','duplikat','mangler_linjer','sum_ukontrollert','lavt_uttrekk','leverandor_mangler','belop_mangler']::text[] THEN
    RETURN jsonb_build_object('ok', false, 'blockers', to_jsonb(b));
  END IF;
  PERFORM set_config('rm.defer_stats', 'on', true);
  FOR r IN SELECT il.*, rm.legal_entity_id AS rm_entity, rm.base_unit AS rm_base_unit
             FROM invoice_lines il LEFT JOIN raw_materials rm ON rm.id = il.raw_material_id
            WHERE il.invoice_id = v.id AND (p_line_ids IS NULL OR il.id = ANY(p_line_ids))
              AND coalesce(il.match_confidence::text,'') <> 'not_applicable'
              AND NOT EXISTS (SELECT 1 FROM invoice_line_cost_postings p WHERE p.invoice_line_id = il.id AND p.revoked_at IS NULL)
            ORDER BY il.id LOOP
    v_reasons := array_remove(string_to_array(coalesce(r.review_reason,''), ','), '');
    v_first := false;
    IF r.raw_material_id IS NULL OR coalesce(r.match_confidence::text,'') NOT IN ('manual','auto_high') OR r.rm_entity IS DISTINCT FROM v.legal_entity_id THEN
      v_skipped := v_skipped || jsonb_build_object('line_id', r.id, 'reason', 'raavare_ikke_bekreftet'); CONTINUE;
    END IF;
    IF NOT rm_is_finite(r.price_per_base_unit) OR r.price_per_base_unit <= 0 OR NOT rm_is_finite(r.base_quantity) OR r.base_quantity <= 0
       OR NOT rm_is_finite(r.total_amount) OR r.total_amount <= 0 THEN
      v_skipped := v_skipped || jsonb_build_object('line_id', r.id, 'reason', 'pris_eller_mengde_mangler'); CONTINUE;
    END IF;
    -- Grunnmengden må komme fra mengde uten pakning eller fra en bekreftet pakning hos samme leverandør.
    SELECT EXISTS (
      SELECT 1 FROM (
        SELECT NULL::numeric AS bupp
        UNION ALL SELECT s.base_units_per_package FROM raw_material_suppliers s
          WHERE s.raw_material_id = r.raw_material_id AND s.supplier_id = v.supplier_id AND s.package_confirmed_at IS NOT NULL
        UNION ALL SELECT p.base_units_per_package FROM raw_material_supplier_packages p JOIN raw_material_suppliers s ON s.id = p.raw_material_supplier_id
          WHERE s.raw_material_id = r.raw_material_id AND s.supplier_id = v.supplier_id
            AND (p.supplier_sku_norm = '' OR p.supplier_sku_norm = rm_sku_norm(r.supplier_sku))
      ) x
      WHERE (rm_expected_base_quantity(r.quantity, r.unit, r.rm_base_unit, x.bupp)->>'status') = 'ok'
        AND abs((rm_expected_base_quantity(r.quantity, r.unit, r.rm_base_unit, x.bupp)->>'expected')::numeric - r.base_quantity) <= 0.0005 * greatest(1, r.base_quantity)
    ) INTO v_pkg_ok;
    IF NOT v_pkg_ok THEN
      v_skipped := v_skipped || jsonb_build_object('line_id', r.id, 'reason', 'pakning_ikke_bekreftet'); CONTINUE;
    END IF;
    IF abs(r.price_per_base_unit * r.base_quantity - r.total_amount) > 0.01 * r.total_amount
       OR (rm_is_finite(r.quantity) AND rm_is_finite(r.unit_price) AND r.quantity > 0
           AND abs(r.quantity * r.unit_price - r.total_amount) > 0.015 * r.total_amount
           AND abs(r.base_quantity * r.unit_price - r.total_amount) > 0.015 * r.total_amount) THEN
      v_skipped := v_skipped || jsonb_build_object('line_id', r.id, 'reason', 'regnestykket_stemmer_ikke'); CONTINUE;
    END IF;
    IF coalesce(r.requires_review,false) OR coalesce(array_length(v_reasons,1),0) > 0 THEN
      IF coalesce(array_length(v_reasons,1),0) > 0 AND v_reasons <@ ARRAY['no_automatic_basis','no_baseline']::text[] THEN
        v_first := true;
      ELSE
        v_skipped := v_skipped || jsonb_build_object('line_id', r.id, 'reason', 'til_gjennomgang'); CONTINUE;
      END IF;
    END IF;
    IF v_first THEN
      UPDATE invoice_lines SET requires_review = false, review_reason = NULL, resolution_note = 'Første dokumenterte kostpris',
        resolved_by = v_uid, resolved_at = now(), updated_at = now() WHERE id = r.id;
    END IF;
    INSERT INTO invoice_line_cost_postings (invoice_line_id, invoice_id, legal_entity_id, first_cost, posted_by)
    VALUES (r.id, v.id, v.legal_entity_id, v_first, v_uid)
    ON CONFLICT (invoice_line_id) DO UPDATE SET revoked_at = NULL, posted_by = EXCLUDED.posted_by, posted_at = now(), first_cost = EXCLUDED.first_cost;
    IF fn_rm_price_history_upsert_line(r.id) THEN
      PERFORM rm_apply_derived_cost_price(r.raw_material_id);
      v_posted := v_posted + 1;
    ELSE
      RAISE EXCEPTION 'prishistorikk_feilet';
    END IF;
  END LOOP;
  PERFORM set_config('rm.defer_stats', '', true);
  IF v_posted > 0 THEN PERFORM refresh_purchase_stats(); END IF;
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  VALUES (v_uid, 'invoice.safe_costs_posted', 'invoice', v.id, v.legal_entity_id, jsonb_build_object('posted', v_posted, 'skipped', v_skipped), 'Trygge kostprislinjer ført', 'ravarer');
  RETURN jsonb_build_object('ok', true, 'posted', v_posted, 'skipped', v_skipped);
END $$;

-- Endre lagret kobling (varenummer → råvare). Virker også uten åpne linjer.
-- Linjer med ført kostpris, prishistorikk eller på avstemte/kansellerte fakturaer endres aldri.
CREATE OR REPLACE FUNCTION public.rm_change_supplier_link(p_rms_id uuid, p_new_raw_material_id uuid, p_reason text, p_line_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); s raw_material_suppliers%rowtype; old_rm raw_materials%rowtype; new_rm raw_materials%rowtype;
  v_changed uuid[] := ARRAY[]::uuid[]; v_locked int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF coalesce(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'begrunnelse_mangler'; END IF;
  SELECT * INTO s FROM raw_material_suppliers WHERE id = p_rms_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'kobling_finnes_ikke' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO old_rm FROM raw_materials WHERE id = s.raw_material_id;
  IF NOT has_ravarer_invoice_access(old_rm.legal_entity_id, 'write') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO new_rm FROM raw_materials WHERE id = p_new_raw_material_id;
  IF NOT FOUND OR new_rm.legal_entity_id IS DISTINCT FROM old_rm.legal_entity_id OR NOT coalesce(new_rm.is_active, true) THEN RAISE EXCEPTION 'ugyldig_raavare'; END IF;
  IF new_rm.id = old_rm.id THEN RAISE EXCEPTION 'samme_raavare'; END IF;
  IF EXISTS (SELECT 1 FROM raw_material_suppliers WHERE raw_material_id = new_rm.id AND supplier_id = s.supplier_id) THEN RAISE EXCEPTION 'kobling_finnes'; END IF;
  UPDATE raw_material_suppliers SET raw_material_id = new_rm.id, is_primary = false, updated_at = now() WHERE id = s.id;
  IF p_line_ids IS NOT NULL AND s.supplier_sku IS NOT NULL THEN
    PERFORM 1 FROM invoices WHERE id IN (SELECT invoice_id FROM invoice_lines WHERE id = ANY(p_line_ids)) ORDER BY id FOR UPDATE;
    SELECT count(*) INTO v_locked FROM invoice_lines il WHERE il.id = ANY(p_line_ids)
      AND (EXISTS (SELECT 1 FROM invoice_line_cost_postings p WHERE p.invoice_line_id = il.id AND p.revoked_at IS NULL)
        OR EXISTS (SELECT 1 FROM raw_material_price_history h WHERE h.invoice_line_id = il.id));
    WITH upd AS (
      UPDATE invoice_lines il SET raw_material_id = new_rm.id, match_confidence = 'manual', requires_review = true,
             review_reason = 'recalculation_pending', base_quantity = NULL, price_per_base_unit = NULL,
             resolved_by = v_uid, resolved_at = now(), updated_at = now()
        FROM invoices i
       WHERE il.id = ANY(p_line_ids) AND i.id = il.invoice_id AND i.supplier_id = s.supplier_id
         AND i.legal_entity_id = old_rm.legal_entity_id AND coalesce(i.status,'') NOT IN ('reconciled','cancelled')
         AND rm_sku_norm(il.supplier_sku) = rm_sku_norm(s.supplier_sku) AND il.raw_material_id IS NOT DISTINCT FROM old_rm.id
         AND NOT EXISTS (SELECT 1 FROM invoice_line_cost_postings p WHERE p.invoice_line_id = il.id AND p.revoked_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM raw_material_price_history h WHERE h.invoice_line_id = il.id)
      RETURNING il.id)
    SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_changed FROM upd;
  END IF;
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
  VALUES (v_uid, 'supplier_link.changed', 'raw_material_supplier', s.id, coalesce(s.supplier_sku,'') || ' / ' || new_rm.name, old_rm.legal_entity_id,
    jsonb_build_object('from_raw_material_id', old_rm.id, 'from_name', old_rm.name, 'to_raw_material_id', new_rm.id, 'to_name', new_rm.name,
      'changed_line_ids', to_jsonb(v_changed), 'locked_lines', v_locked, 'raw_material_supplier_id', s.id), trim(p_reason), 'ravarer');
  RETURN jsonb_build_object('ok', true, 'changed_line_ids', to_jsonb(v_changed), 'locked_lines', v_locked);
END $$;

REVOKE ALL ON FUNCTION public.rm_change_supplier_link(uuid, uuid, text, uuid[]), public.has_ravarer_invoice_approve(uuid),
  public.invoice_line_credit_covered(uuid), public.invoice_approval_blockers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rm_change_supplier_link(uuid, uuid, text, uuid[]), public.has_ravarer_invoice_approve(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.invoice_line_credit_covered(uuid), public.invoice_approval_blockers(uuid) FROM authenticated;
