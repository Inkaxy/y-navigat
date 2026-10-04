
CREATE OR REPLACE FUNCTION public._nb_touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- 1) Intern godkjenning
CREATE TABLE public.invoice_internal_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','revoked')),
  note text,
  basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invoice_internal_approvals_one_active ON public.invoice_internal_approvals(invoice_id) WHERE status = 'approved';
GRANT SELECT ON public.invoice_internal_approvals TO authenticated;
GRANT ALL ON public.invoice_internal_approvals TO service_role;
ALTER TABLE public.invoice_internal_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Les interne godkjenninger" ON public.invoice_internal_approvals FOR SELECT TO authenticated
  USING (public.has_ravarer_invoice_access(legal_entity_id, 'read'));
CREATE TRIGGER trg_iia_touch BEFORE UPDATE ON public.invoice_internal_approvals FOR EACH ROW EXECUTE FUNCTION public._nb_touch_updated_at();

-- 2) Leverandøravvik
CREATE TABLE public.supplier_deviation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  kind text NOT NULL DEFAULT 'price' CHECK (kind IN ('price')),
  title text NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','cancelled')),
  responsible_user_id uuid,
  follow_up_on date,
  resolution_note text,
  created_by uuid NOT NULL,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.supplier_deviation_case_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.supplier_deviation_cases(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  invoice_line_id uuid NOT NULL REFERENCES public.invoice_lines(id),
  amount_excl_vat numeric NOT NULL CHECK (amount_excl_vat > 0),
  basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, invoice_line_id)
);
CREATE INDEX sdcl_line ON public.supplier_deviation_case_lines(invoice_line_id);
CREATE INDEX sdcl_invoice ON public.supplier_deviation_case_lines(invoice_id);
CREATE TABLE public.supplier_deviation_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.supplier_deviation_cases(id) ON DELETE CASCADE,
  credit_invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  amount_excl_vat numeric NOT NULL CHECK (amount_excl_vat > 0),
  client_ref uuid NOT NULL UNIQUE,
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sdc_credit ON public.supplier_deviation_credits(credit_invoice_id);

GRANT SELECT ON public.supplier_deviation_cases, public.supplier_deviation_case_lines, public.supplier_deviation_credits TO authenticated;
GRANT ALL ON public.supplier_deviation_cases, public.supplier_deviation_case_lines, public.supplier_deviation_credits TO service_role;
ALTER TABLE public.supplier_deviation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_deviation_case_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_deviation_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Les leverandørsaker" ON public.supplier_deviation_cases FOR SELECT TO authenticated
  USING (public.has_ravarer_invoice_access(legal_entity_id, 'read'));
CREATE POLICY "Les leverandørsakslinjer" ON public.supplier_deviation_case_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.supplier_deviation_cases c WHERE c.id = case_id AND public.has_ravarer_invoice_access(c.legal_entity_id, 'read')));
CREATE POLICY "Les kreditfordeling" ON public.supplier_deviation_credits FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.supplier_deviation_cases c WHERE c.id = case_id AND public.has_ravarer_invoice_access(c.legal_entity_id, 'read')));
CREATE TRIGGER trg_sdc_touch BEFORE UPDATE ON public.supplier_deviation_cases FOR EACH ROW EXECUTE FUNCTION public._nb_touch_updated_at();

-- 3) Førte kostprislinjer
CREATE TABLE public.invoice_line_cost_postings (
  invoice_line_id uuid PRIMARY KEY REFERENCES public.invoice_lines(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id),
  first_cost boolean NOT NULL DEFAULT false,
  posted_by uuid NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX ilcp_invoice ON public.invoice_line_cost_postings(invoice_id);
GRANT SELECT ON public.invoice_line_cost_postings TO authenticated;
GRANT ALL ON public.invoice_line_cost_postings TO service_role;
ALTER TABLE public.invoice_line_cost_postings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Les førte kostprislinjer" ON public.invoice_line_cost_postings FOR SELECT TO authenticated
  USING (public.has_ravarer_invoice_access(legal_entity_id, 'read'));

-- Prishistorikk: tillat eksplisitt førte linjer på ikke-ferdige fakturaer. Kun denne betingelsen endres.
DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.fn_rm_price_history_upsert_line'::regproc);
  n := replace(d, $x$elsif v_inv.status not in ('ready', 'reconciled') then$x$,
    $x$elsif v_inv.status not in ('ready', 'reconciled') and not exists (select 1 from public.invoice_line_cost_postings pp where pp.invoice_line_id = v_l.id and pp.revoked_at is null) then$x$);
  IF n = d THEN RAISE EXCEPTION 'fn_rm_price_history_upsert_line: forventet betingelse ikke funnet'; END IF;
  EXECUTE n;
END $do$;

-- Felles: åpent restavvik per faktura i en sak
CREATE OR REPLACE FUNCTION public.supplier_case_invoice_remaining(p_case_id uuid, p_invoice_id uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT sum(amount_excl_vat) FROM supplier_deviation_case_lines WHERE case_id = p_case_id AND invoice_id = p_invoice_id), 0)
       - coalesce((SELECT sum(amount_excl_vat) FROM supplier_deviation_credits WHERE case_id = p_case_id AND invoice_id = p_invoice_id), 0);
$$;

-- Felles sperreregel for intern godkjenning. Råvarevalg og pakning sperrer IKKE.
CREATE OR REPLACE FUNCTION public.invoice_approval_blockers(p_invoice_id uuid) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v invoices%rowtype; b text[] := '{}';
BEGIN
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN ARRAY['finnes_ikke']; END IF;
  IF v.flagged_at IS NOT NULL THEN b := b || 'flagget'; END IF;
  IF v.status = 'cancelled' THEN b := b || 'kansellert'; END IF;
  IF v.lines_sum_status = 'mismatch' THEN b := b || 'sumavvik'; END IF;
  IF NOT EXISTS (SELECT 1 FROM invoice_lines WHERE invoice_id = v.id) THEN b := b || 'mangler_linjer'; END IF;
  IF EXISTS (SELECT 1 FROM invoices o WHERE o.id <> v.id AND o.legal_entity_id = v.legal_entity_id
             AND o.supplier_id IS NOT DISTINCT FROM v.supplier_id AND o.invoice_number = v.invoice_number
             AND coalesce(o.is_credit_note,false) = coalesce(v.is_credit_note,false) AND coalesce(o.status,'') <> 'cancelled') THEN
    b := b || 'duplikat';
  END IF;
  IF EXISTS (SELECT 1 FROM invoice_lines il WHERE il.invoice_id = v.id
             AND coalesce(il.match_confidence::text,'') <> 'not_applicable'
             AND il.review_reason ~ '(extraction_issue|extraction_unresolved|zero_quantity)') THEN
    b := b || 'mengde';
  END IF;
  IF EXISTS (SELECT 1 FROM invoice_lines il WHERE il.invoice_id = v.id AND coalesce(il.requires_review,false)
             AND il.review_reason ~ '(price_variance|price_increase|price_drop|agreement_conflict)') THEN
    b := b || 'prisavvik';
  END IF;
  IF EXISTS (SELECT 1 FROM supplier_deviation_case_lines l JOIN supplier_deviation_cases c ON c.id = l.case_id
             WHERE l.invoice_id = v.id AND c.status = 'open'
             AND public.supplier_case_invoice_remaining(c.id, v.id) > 0) THEN
    b := b || 'leverandorsak';
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
  IF NOT has_ravarer_invoice_access(v.legal_entity_id, 'write') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_id FROM invoice_internal_approvals WHERE invoice_id = v.id AND status = 'approved';
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'already_approved', true, 'id', v_id); END IF;
  b := invoice_approval_blockers(v.id);
  IF coalesce(array_length(b,1),0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'blockers', to_jsonb(b));
  END IF;
  INSERT INTO invoice_internal_approvals (invoice_id, legal_entity_id, note, approved_by, basis)
  VALUES (v.id, v.legal_entity_id, nullif(trim(p_note),''), v_uid,
          jsonb_build_object('total_amount', v.total_amount, 'total_vat', v.total_vat, 'lines_sum_status', v.lines_sum_status, 'status', v.status))
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
  IF NOT has_ravarer_invoice_access(v.legal_entity_id, 'write') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE invoice_internal_approvals SET status = 'revoked', revoked_by = v_uid, revoked_at = now(), revoke_reason = p_reason
   WHERE invoice_id = v.id AND status = 'approved';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
    VALUES (v_uid, 'invoice.internal_approval_revoked', 'invoice', v.id, v.legal_entity_id, '{}'::jsonb, p_reason, 'ravarer');
  END IF;
  RETURN jsonb_build_object('ok', true, 'revoked', n > 0);
END $$;

-- Oversikt for fakturalisten: hele utvalget, aggregert på serveren.
CREATE OR REPLACE FUNCTION public.invoice_approval_overview(p_legal_entity_id uuid)
RETURNS TABLE (invoice_id uuid, invoice_number text, invoice_date date, supplier_id uuid, supplier_name text,
  total_amount numeric, total_vat numeric, currency text, status text, is_credit_note boolean,
  approved_at timestamptz, approved_by uuid, blockers text[], open_material_lines int, cost_posted_lines int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT has_ravarer_invoice_access(p_legal_entity_id, 'read') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT i.id, i.invoice_number::text, i.invoice_date::date, i.supplier_id, s.name::text, i.total_amount, i.total_vat, i.currency::text,
         i.status::text, coalesce(i.is_credit_note,false), a.approved_at, a.approved_by,
         invoice_approval_blockers(i.id),
         (SELECT count(*)::int FROM invoice_lines il WHERE il.invoice_id = i.id AND coalesce(il.match_confidence::text,'') <> 'not_applicable'
            AND (il.raw_material_id IS NULL OR coalesce(il.match_confidence::text,'') NOT IN ('manual','auto_high'))),
         (SELECT count(*)::int FROM invoice_line_cost_postings p WHERE p.invoice_id = i.id AND p.revoked_at IS NULL)
    FROM invoices i
    LEFT JOIN suppliers s ON s.id = i.supplier_id
    LEFT JOIN invoice_internal_approvals a ON a.invoice_id = i.id AND a.status = 'approved'
   WHERE i.legal_entity_id = p_legal_entity_id AND coalesce(i.status,'') <> 'cancelled'
   ORDER BY i.invoice_date DESC NULLS LAST, i.id;
END $$;

-- Opprett leverandørsak fra prisavvikslinjer. Beløp beregnes på serveren fra dokumentert grunnmengde.
CREATE OR REPLACE FUNCTION public.create_supplier_deviation_case(p_line_ids uuid[], p_title text, p_reason text DEFAULT NULL,
  p_responsible_user_id uuid DEFAULT NULL, p_follow_up_on date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_entity uuid; v_supplier uuid; v_case uuid; r record; v_amt numeric; n int := 0;
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
  IF NOT has_ravarer_invoice_access(v_entity, 'write') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
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
    v_amt := round((r.price_per_base_unit - r.expected_price_per_base_unit) * r.base_quantity, 2);
    IF v_amt <= 0 THEN RAISE EXCEPTION 'ingen_merkostnad'; END IF;
    INSERT INTO supplier_deviation_case_lines (case_id, invoice_id, invoice_line_id, amount_excl_vat, basis)
    VALUES (v_case, r.invoice_id, r.id, v_amt, jsonb_build_object('price_per_base_unit', r.price_per_base_unit,
      'expected_price_per_base_unit', r.expected_price_per_base_unit, 'base_quantity', r.base_quantity,
      'price_reference_source', r.price_reference_source, 'price_reference_date', r.price_reference_date));
    n := n + 1;
  END LOOP;
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  VALUES (v_uid, 'supplier_case.created', 'supplier_deviation_case', v_case, v_entity, jsonb_build_object('lines', n), p_reason, 'ravarer');
  RETURN jsonb_build_object('ok', true, 'case_id', v_case, 'lines', n);
END $$;

-- Fordel kredit fra en faktisk kreditnota til én faktura i saken.
CREATE OR REPLACE FUNCTION public.allocate_supplier_deviation_credit(p_case_id uuid, p_credit_invoice_id uuid, p_invoice_id uuid,
  p_amount_excl_vat numeric, p_client_ref uuid, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); c supplier_deviation_cases%rowtype; cr invoices%rowtype; v_credit_total numeric; v_used numeric; v_rem numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF EXISTS (SELECT 1 FROM supplier_deviation_credits WHERE client_ref = p_client_ref) THEN
    RETURN jsonb_build_object('ok', true, 'already_saved', true);
  END IF;
  SELECT * INTO c FROM supplier_deviation_cases WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sak_finnes_ikke' USING ERRCODE = 'P0002'; END IF;
  IF NOT has_ravarer_invoice_access(c.legal_entity_id, 'write') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF c.status <> 'open' THEN RAISE EXCEPTION 'sak_ikke_aapen'; END IF;
  SELECT * INTO cr FROM invoices WHERE id = p_credit_invoice_id FOR UPDATE;
  IF NOT FOUND OR NOT coalesce(cr.is_credit_note,false) THEN RAISE EXCEPTION 'ikke_kreditnota'; END IF;
  IF cr.legal_entity_id <> c.legal_entity_id OR cr.supplier_id IS DISTINCT FROM c.supplier_id THEN RAISE EXCEPTION 'kreditnota_annen_leverandor'; END IF;
  IF NOT EXISTS (SELECT 1 FROM supplier_deviation_case_lines WHERE case_id = c.id AND invoice_id = p_invoice_id) THEN RAISE EXCEPTION 'faktura_ikke_i_saken'; END IF;
  IF p_amount_excl_vat IS NULL OR NOT rm_is_finite(p_amount_excl_vat) OR p_amount_excl_vat <= 0 THEN RAISE EXCEPTION 'ugyldig_belop'; END IF;
  v_credit_total := abs(coalesce(cr.total_amount,0)) - abs(coalesce(cr.total_vat,0));
  SELECT coalesce(sum(amount_excl_vat),0) INTO v_used FROM supplier_deviation_credits WHERE credit_invoice_id = cr.id;
  IF p_amount_excl_vat > v_credit_total - v_used + 0.005 THEN RAISE EXCEPTION 'kreditnota_overfordelt'; END IF;
  v_rem := supplier_case_invoice_remaining(c.id, p_invoice_id);
  IF p_amount_excl_vat > v_rem + 0.005 THEN RAISE EXCEPTION 'mer_enn_restavvik'; END IF;
  INSERT INTO supplier_deviation_credits (case_id, credit_invoice_id, invoice_id, amount_excl_vat, client_ref, note, created_by)
  VALUES (c.id, cr.id, p_invoice_id, round(p_amount_excl_vat,2), p_client_ref, nullif(trim(p_note),''), v_uid);
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  VALUES (v_uid, 'supplier_case.credit_allocated', 'supplier_deviation_case', c.id, c.legal_entity_id,
          jsonb_build_object('credit_invoice_id', cr.id, 'invoice_id', p_invoice_id, 'amount_excl_vat', p_amount_excl_vat), p_note, 'ravarer');
  RETURN jsonb_build_object('ok', true, 'already_saved', false, 'remaining_excl_vat', v_rem - round(p_amount_excl_vat,2));
END $$;

CREATE OR REPLACE FUNCTION public.set_supplier_deviation_case_status(p_case_id uuid, p_status text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); c supplier_deviation_cases%rowtype;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF p_status NOT IN ('open','resolved','cancelled') THEN RAISE EXCEPTION 'ugyldig_status'; END IF;
  SELECT * INTO c FROM supplier_deviation_cases WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sak_finnes_ikke' USING ERRCODE = 'P0002'; END IF;
  IF NOT has_ravarer_invoice_access(c.legal_entity_id, 'write') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_status <> 'open' AND coalesce(trim(p_note),'') = '' THEN RAISE EXCEPTION 'begrunnelse_mangler'; END IF;
  UPDATE supplier_deviation_cases SET status = p_status, resolution_note = nullif(trim(p_note),''),
    resolved_by = CASE WHEN p_status = 'open' THEN NULL ELSE v_uid END,
    resolved_at = CASE WHEN p_status = 'open' THEN NULL ELSE now() END
   WHERE id = c.id;
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  VALUES (v_uid, 'supplier_case.status', 'supplier_deviation_case', c.id, c.legal_entity_id, jsonb_build_object('from', c.status, 'to', p_status), p_note, 'ravarer');
  RETURN jsonb_build_object('ok', true);
END $$;

-- Før kostpris for trygge linjer uten å vente på resten av fakturaen.
CREATE OR REPLACE FUNCTION public.rm_post_safe_line_costs(p_invoice_id uuid, p_line_ids uuid[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v invoices%rowtype; v_uid uuid := auth.uid(); r record; v_reasons text[]; v_first boolean; v_posted int := 0;
  v_skipped jsonb := '[]'::jsonb; b text[];
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
  IF b && ARRAY['flagget','sumavvik','duplikat','mangler_linjer'] THEN
    RETURN jsonb_build_object('ok', false, 'blockers', to_jsonb(b));
  END IF;
  PERFORM set_config('rm.defer_stats', 'on', true);
  FOR r IN SELECT il.*, rm.legal_entity_id AS rm_entity FROM invoice_lines il LEFT JOIN raw_materials rm ON rm.id = il.raw_material_id
            WHERE il.invoice_id = v.id AND (p_line_ids IS NULL OR il.id = ANY(p_line_ids))
              AND coalesce(il.match_confidence::text,'') <> 'not_applicable'
              AND NOT EXISTS (SELECT 1 FROM invoice_line_cost_postings p WHERE p.invoice_line_id = il.id AND p.revoked_at IS NULL)
            ORDER BY il.id LOOP
    v_reasons := array_remove(string_to_array(coalesce(r.review_reason,''), ','), '');
    v_first := false;
    IF r.raw_material_id IS NULL OR coalesce(r.match_confidence::text,'') NOT IN ('manual','auto_high') OR r.rm_entity IS DISTINCT FROM v.legal_entity_id THEN
      v_skipped := v_skipped || jsonb_build_object('line_id', r.id, 'reason', 'raavare_ikke_bekreftet'); CONTINUE;
    END IF;
    IF NOT rm_is_finite(r.price_per_base_unit) OR r.price_per_base_unit <= 0 OR r.base_quantity IS NULL
       OR NOT rm_is_finite(r.base_quantity) OR r.base_quantity <= 0 THEN
      v_skipped := v_skipped || jsonb_build_object('line_id', r.id, 'reason', 'pris_eller_mengde_mangler'); CONTINUE;
    END IF;
    IF coalesce(r.requires_review,false) OR coalesce(array_length(v_reasons,1),0) > 0 THEN
      IF coalesce(array_length(v_reasons,1),0) > 0 AND v_reasons <@ ARRAY['no_automatic_basis','no_baseline'] THEN
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

REVOKE ALL ON FUNCTION public.approve_invoice_internal(uuid, text), public.revoke_invoice_internal_approval(uuid, text),
  public.invoice_approval_overview(uuid), public.create_supplier_deviation_case(uuid[], text, text, uuid, date),
  public.allocate_supplier_deviation_credit(uuid, uuid, uuid, numeric, uuid, text), public.set_supplier_deviation_case_status(uuid, text, text),
  public.rm_post_safe_line_costs(uuid, uuid[]), public.invoice_approval_blockers(uuid), public.supplier_case_invoice_remaining(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_invoice_internal(uuid, text), public.revoke_invoice_internal_approval(uuid, text),
  public.invoice_approval_overview(uuid), public.create_supplier_deviation_case(uuid[], text, text, uuid, date),
  public.allocate_supplier_deviation_credit(uuid, uuid, uuid, numeric, uuid, text), public.set_supplier_deviation_case_status(uuid, text, text),
  public.rm_post_safe_line_costs(uuid, uuid[]), public.invoice_approval_blockers(uuid), public.supplier_case_invoice_remaining(uuid, uuid) TO authenticated;
