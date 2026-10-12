-- FORSLAG — IKKE KJØRT. Varetelling trinn 3: listebundet opplasting/lesing (bare forslag), rapport-e-post,
-- tildeling («Mine lister»). Krever at 20261012_varetelling_foundation.PENDING.sql (revisjon 2) er kjørt først.
-- Ingen endring av eksisterende funksjoner/kontrakter. Lagringsbøtte og -regler ligger i egen fil
-- (20261012_varetelling_stage3_storage.PENDING.sql) fordi de ikke kan testes i PGlite.
-- Låsrekkefølge (som grunnlaget): telling → liste → linje → (jobb/forslag/e-postoperasjon).

CREATE OR REPLACE FUNCTION public.vt_stage3_version() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT jsonb_build_object('stage3', 1) $$;

-- ---------- Opplasting/lesing ----------
CREATE TABLE public.vt_ocr_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL,
  count_id uuid NOT NULL,
  count_list_id uuid NOT NULL,
  template_revision integer NOT NULL,
  line_revisions jsonb NOT NULL,              -- {line_id: revisjon} ved opplasting (uforanderlig)
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  original_path text NOT NULL,
  pdf_path text NOT NULL,
  mime text NOT NULL CHECK (mime IN ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  status text NOT NULL DEFAULT 'opprettet' CHECK (status IN ('opprettet','behandler','ukjent_ai_utfall','klar','feilet')),
  document_ok boolean,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  failure_reason text,
  claimed_at timestamptz,
  finished_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_list_id, file_sha256),
  UNIQUE (id, legal_entity_id),
  FOREIGN KEY (count_list_id, legal_entity_id) REFERENCES public.vt_count_lists (id, legal_entity_id),
  FOREIGN KEY (count_id, legal_entity_id) REFERENCES public.vt_counts (id, legal_entity_id)
);

CREATE TABLE public.vt_ocr_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  line_id uuid NOT NULL REFERENCES public.vt_count_lines (id),
  line_revision_at_job integer NOT NULL,
  page integer NOT NULL CHECK (page BETWEEN 1 AND 200),
  row_code text NOT NULL,
  entries jsonb NOT NULL,                    -- [{unit_id,label,value|null,reason|null,raw}] — FORSLAG, aldri tellede verdier
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  crop jsonb,                                -- {x,y,w,h} på siden, ellers null (vis hel side, tydelig merket)
  status text NOT NULL DEFAULT 'foreslatt' CHECK (status IN ('foreslatt','godkjent','avvist')),
  decided_by uuid, decided_at timestamptz,
  accepted_entry jsonb, accepted_state text, corrected boolean, decision_note text,
  UNIQUE (job_id, line_id),
  FOREIGN KEY (job_id, legal_entity_id) REFERENCES public.vt_ocr_jobs (id, legal_entity_id)
);

-- ---------- Rapport-e-post ----------
CREATE TABLE public.vt_report_mail_ops (
  op_id uuid PRIMARY KEY,
  legal_entity_id uuid NOT NULL,
  count_id uuid NOT NULL,
  count_revision integer NOT NULL,
  report_hash text NOT NULL CHECK (report_hash ~ '^[0-9a-f]{64}$'),
  recipient text NOT NULL CHECK (length(recipient) <= 254 AND recipient ~* '^[^[:space:]@<>(),;:"]+@[^[:space:]@<>(),;:"]+\.[a-z]{2,}$'),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 200),
  message text NOT NULL CHECK (length(message) <= 4000),
  state text NOT NULL DEFAULT 'reservert' CHECK (state IN ('reservert','sender','akseptert_av_tjenesten','avvist','ukjent')),
  detail text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (count_id, legal_entity_id) REFERENCES public.vt_counts (id, legal_entity_id)
);

-- ---------- Tildeling ----------
CREATE TABLE public.vt_list_assignments (
  count_list_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'teller' CHECK (role IN ('teller','kontrollor')),
  assigned_by uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (count_list_id, user_id, role),
  FOREIGN KEY (count_list_id, legal_entity_id) REFERENCES public.vt_count_lists (id, legal_entity_id)
);

-- Ingen direkte klientskriving; lesing via RLS.
REVOKE ALL ON public.vt_ocr_jobs, public.vt_ocr_proposals, public.vt_report_mail_ops, public.vt_list_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vt_ocr_jobs, public.vt_ocr_proposals, public.vt_report_mail_ops, public.vt_list_assignments TO authenticated;
ALTER TABLE public.vt_ocr_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_ocr_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_report_mail_ops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_list_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY vt_ocr_jobs_read ON public.vt_ocr_jobs FOR SELECT TO authenticated USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY vt_ocr_proposals_read ON public.vt_ocr_proposals FOR SELECT TO authenticated USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY vt_report_mail_ops_read ON public.vt_report_mail_ops FOR SELECT TO authenticated USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY vt_list_assignments_read ON public.vt_list_assignments FOR SELECT TO authenticated USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));

-- ---------- RPC: opprett opplastingsjobb ----------
-- Binder jobben til nøyaktig liste, malversjon og linjerevisjoner nå. Samme fil (SHA-256) på samme liste gir
-- eksisterende jobb (duplikat), aldri ny betalt lesing. Stier bestemmes av serveren.
CREATE OR REPLACE FUNCTION public.vt_ocr_create_job(p_op_id uuid, p_list_id uuid, p_sha256 text, p_mime text, p_size integer, p_has_pdf_derivative boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_prev jsonb; v_list vt_count_lists; v_count vt_counts; v_job vt_ocr_jobs; v_ext text; v_res jsonb; v_req jsonb;
BEGIN
  SELECT * INTO v_list FROM vt_count_lists WHERE id = p_list_id;
  v_uid := _vt_require(v_list.legal_entity_id, 'write');
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_mime IS NULL OR p_size IS NULL OR p_has_pdf_derivative IS NULL THEN
    RAISE EXCEPTION 'Ugyldig fil' USING ERRCODE = '22023'; END IF;
  IF p_mime <> 'application/pdf' AND NOT p_has_pdf_derivative THEN RAISE EXCEPTION 'Bilder må følges av PDF-kopi' USING ERRCODE = '22023'; END IF;
  v_req := jsonb_build_object('list_id', p_list_id, 'sha', p_sha256, 'mime', p_mime, 'size', p_size, 'pdf', p_has_pdf_derivative);
  v_prev := _vt_op_begin(p_op_id, 'ocr_create_job', v_list.legal_entity_id, v_uid, v_req);
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  SELECT * INTO v_count FROM vt_counts WHERE id = v_list.count_id FOR SHARE;          -- telling → liste
  SELECT * INTO v_list FROM vt_count_lists WHERE id = p_list_id FOR SHARE;
  IF v_count.status NOT IN ('pagar','til_kontroll') OR v_list.status = 'godkjent' THEN
    RAISE EXCEPTION 'Listen er ikke åpen for registrering' USING ERRCODE = '55000'; END IF;
  SELECT * INTO v_job FROM vt_ocr_jobs WHERE count_list_id = p_list_id AND file_sha256 = p_sha256;
  IF FOUND THEN
    RETURN _vt_op_finish(p_op_id, jsonb_build_object('ok', true, 'kind', 'ocr_create_job', 'duplicate', true, 'job_id', v_job.id,
      'status', v_job.status, 'original_path', v_job.original_path, 'pdf_path', v_job.pdf_path));
  END IF;
  v_ext := CASE p_mime WHEN 'application/pdf' THEN 'pdf' WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' ELSE 'webp' END;
  INSERT INTO vt_ocr_jobs (legal_entity_id, count_id, count_list_id, template_revision, line_revisions, file_sha256,
                           original_path, pdf_path, mime, size_bytes, created_by)
  SELECT v_list.legal_entity_id, v_list.count_id, v_list.id, v_list.source_template_revision,
         coalesce((SELECT jsonb_object_agg(id, revision) FROM vt_count_lines WHERE count_list_id = v_list.id), '{}'::jsonb),
         p_sha256, '', '', p_mime, p_size, v_uid
  RETURNING * INTO v_job;
  UPDATE vt_ocr_jobs SET
    original_path = v_job.legal_entity_id || '/' || v_job.count_id || '/' || v_job.count_list_id || '/' || v_job.id || '/original.' || v_ext,
    pdf_path = v_job.legal_entity_id || '/' || v_job.count_id || '/' || v_job.count_list_id || '/' || v_job.id ||
               CASE WHEN p_mime = 'application/pdf' THEN '/original.pdf' ELSE '/side.pdf' END
  WHERE id = v_job.id RETURNING * INTO v_job;
  v_res := jsonb_build_object('ok', true, 'kind', 'ocr_create_job', 'duplicate', false, 'job_id', v_job.id, 'status', v_job.status,
    'original_path', v_job.original_path, 'pdf_path', v_job.pdf_path);
  RETURN _vt_op_finish(p_op_id, v_res);
END $$;

-- ---------- RPC: reserver lesing (kalles av Edge med brukerens JWT) ----------
-- Bare «opprettet» kan tas. «behandler»/«ukjent_ai_utfall» gir 55000: ingen ny betalt kjøring.
CREATE OR REPLACE FUNCTION public.vt_ocr_claim(p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job vt_ocr_jobs; v_lines jsonb;
BEGIN
  SELECT * INTO v_job FROM vt_ocr_jobs WHERE id = p_job_id;
  PERFORM _vt_require(v_job.legal_entity_id, 'write');
  SELECT * INTO v_job FROM vt_ocr_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.status <> 'opprettet' THEN RAISE EXCEPTION 'Jobben er allerede tatt' USING ERRCODE = '55000'; END IF;
  UPDATE vt_ocr_jobs SET status = 'behandler', claimed_at = now() WHERE id = p_job_id;
  -- Manifest fra uforanderlige linjer i listens rekkefølge; revisjoner fra opplastingstidspunktet.
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'revision', (v_job.line_revisions->>(l.id::text))::int,
           'snap_base_unit', l.snap_base_unit, 'snap_units', l.snap_units) ORDER BY l.sort_order, l.id), '[]'::jsonb)
    INTO v_lines FROM vt_count_lines l WHERE l.count_list_id = v_job.count_list_id;
  RETURN jsonb_build_object('count_id', v_job.count_id, 'list_id', v_job.count_list_id, 'template_revision', v_job.template_revision,
    'pdf_path', v_job.pdf_path, 'lines', v_lines);
END $$;

-- ---------- Service-only resultatregistrering ----------
CREATE OR REPLACE FUNCTION public.vt_ocr_record_unknown(p_job_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE vt_ocr_jobs SET status = 'ukjent_ai_utfall', finished_at = now() WHERE id = p_job_id AND status = 'behandler' $$;
CREATE OR REPLACE FUNCTION public.vt_ocr_record_failure(p_job_id uuid, p_reason text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE vt_ocr_jobs SET status = 'feilet', failure_reason = left(p_reason, 300), finished_at = now() WHERE id = p_job_id AND status = 'behandler' $$;

/** Lagrer forslag. Linje må tilhøre jobbens liste og revisjonen må være jobbens; ellers avvises raden. */
CREATE OR REPLACE FUNCTION public.vt_ocr_record_result(p_job_id uuid, p_document_ok boolean, p_issues jsonb, p_proposals jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job vt_ocr_jobs; p jsonb; v_rev int; v_n int := 0; v_issues jsonb := coalesce(p_issues, '[]'::jsonb);
BEGIN
  SELECT * INTO v_job FROM vt_ocr_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.status IS DISTINCT FROM 'behandler' THEN RAISE EXCEPTION 'Jobben behandles ikke' USING ERRCODE = '55000'; END IF;
  IF jsonb_typeof(p_proposals) <> 'array' OR jsonb_array_length(p_proposals) > 2000 OR jsonb_typeof(v_issues) <> 'array' THEN
    RAISE EXCEPTION 'Ugyldig resultat' USING ERRCODE = '22023'; END IF;
  FOR p IN SELECT * FROM jsonb_array_elements(p_proposals) LOOP
    v_rev := (v_job.line_revisions->>(p->>'line_id'))::int;
    IF v_rev IS NULL OR NOT EXISTS (SELECT 1 FROM vt_count_lines WHERE id = (p->>'line_id')::uuid AND count_list_id = v_job.count_list_id)
       OR (p->>'line_revision_at_job')::int IS DISTINCT FROM v_rev OR jsonb_typeof(p->'entries') <> 'array' THEN
      v_issues := v_issues || to_jsonb('Forslag for ukjent/fremmed linje avvist'::text); CONTINUE;
    END IF;
    INSERT INTO vt_ocr_proposals (job_id, legal_entity_id, line_id, line_revision_at_job, page, row_code, entries, reasons, crop)
    VALUES (v_job.id, v_job.legal_entity_id, (p->>'line_id')::uuid, v_rev, (p->>'page')::int, left(p->>'row_code', 16),
            p->'entries', coalesce(p->'reasons', '[]'::jsonb), p->'crop')
    ON CONFLICT (job_id, line_id) DO NOTHING;
    v_n := v_n + 1;
  END LOOP;
  UPDATE vt_ocr_jobs SET status = 'klar', document_ok = coalesce(p_document_ok, false), issues = v_issues, finished_at = now() WHERE id = p_job_id;
  RETURN jsonb_build_object('proposals', v_n);
END $$;

/** Bruker bekrefter at en ny BETALT lesing skal kjøres etter ukjent utfall (etter kontroll i AI-loggen). */
CREATE OR REPLACE FUNCTION public.vt_ocr_reset_unknown(p_op_id uuid, p_job_id uuid, p_confirm_paid_rerun boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job vt_ocr_jobs; v_uid uuid; v_prev jsonb;
BEGIN
  SELECT * INTO v_job FROM vt_ocr_jobs WHERE id = p_job_id;
  v_uid := _vt_require(v_job.legal_entity_id, 'approve');
  IF p_confirm_paid_rerun IS NOT TRUE THEN RAISE EXCEPTION 'Ny kjøring må bekreftes' USING ERRCODE = '22023'; END IF;
  v_prev := _vt_op_begin(p_op_id, 'ocr_reset', v_job.legal_entity_id, v_uid, jsonb_build_object('job_id', p_job_id));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  UPDATE vt_ocr_jobs SET status = 'opprettet', claimed_at = NULL, finished_at = NULL WHERE id = p_job_id AND status = 'ukjent_ai_utfall';
  IF NOT FOUND THEN RAISE EXCEPTION 'Jobben har ikke ukjent utfall' USING ERRCODE = '55000'; END IF;
  RETURN _vt_op_finish(p_op_id, jsonb_build_object('ok', true, 'kind', 'ocr_reset', 'job_id', p_job_id));
END $$;

-- ---------- RPC: godkjenn ett forslag (brukerens bekreftede verdier) ----------
-- Lagring går gjennom vt_save_line (samme validering, låsing telling→liste→linje og op-kvittering).
-- Avvises hvis dokumentet ikke er identitetsbekreftet, forslaget er avgjort, linjen ikke er jobbens,
-- eller linjen er endret etter opplasting (manuell registrering overskrives aldri stille).
CREATE OR REPLACE FUNCTION public.vt_ocr_accept(p_op_id uuid, p_proposal_id uuid, p_expected_revision integer, p_state text,
  p_counted_base numeric, p_entry jsonb, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p vt_ocr_proposals; v_job vt_ocr_jobs; v_line vt_count_lines; v_res jsonb; v_corrected boolean;
BEGIN
  SELECT * INTO v_p FROM vt_ocr_proposals WHERE id = p_proposal_id;
  PERFORM _vt_require(v_p.legal_entity_id, 'write');
  SELECT * INTO v_job FROM vt_ocr_jobs WHERE id = v_p.job_id;
  SELECT * INTO v_line FROM vt_count_lines WHERE id = v_p.line_id;
  -- Gjentatt kall med samme op-id: vt_save_line returnerer lagret kvittering før kontrollene under.
  IF EXISTS (SELECT 1 FROM vt_ops WHERE op_id = p_op_id) THEN
    RETURN vt_save_line(p_op_id, v_p.line_id, p_expected_revision, p_state, p_counted_base, p_entry, p_note);
  END IF;
  IF v_job.status <> 'klar' OR v_job.document_ok IS NOT TRUE THEN RAISE EXCEPTION 'Dokumentets identitet er ikke bekreftet' USING ERRCODE = '55000'; END IF;
  IF v_p.status <> 'foreslatt' THEN RAISE EXCEPTION 'Forslaget er allerede avgjort' USING ERRCODE = '55000'; END IF;
  IF v_line.count_list_id <> v_job.count_list_id THEN RAISE EXCEPTION 'Linjen hører ikke til listen' USING ERRCODE = '42501'; END IF;
  IF p_expected_revision IS DISTINCT FROM v_p.line_revision_at_job OR v_line.revision <> v_p.line_revision_at_job THEN
    RAISE EXCEPTION 'Linjen er endret etter opplasting — kontroller manuelt' USING ERRCODE = '40001'; END IF;
  -- Kappløp etter lesingen over fanges av CAS i vt_save_line (konflikt, ingenting skrevet).
  v_res := vt_save_line(p_op_id, v_p.line_id, p_expected_revision, p_state, p_counted_base, p_entry, p_note);
  IF (v_res->>'ok')::boolean IS TRUE THEN
    v_corrected := NOT (
      (SELECT coalesce(jsonb_agg(jsonb_build_object('u', e->>'unit_id', 'a', (e->>'amount')::numeric) ORDER BY e->>'unit_id'), '[]') FROM jsonb_array_elements(p_entry) e)
      = (SELECT coalesce(jsonb_agg(jsonb_build_object('u', e->>'unit_id', 'a', (e->>'value')::numeric) ORDER BY e->>'unit_id'), '[]') FROM jsonb_array_elements(v_p.entries) e WHERE e->>'value' IS NOT NULL));
    UPDATE vt_ocr_proposals SET status = 'godkjent', decided_by = auth.uid(), decided_at = now(), accepted_entry = p_entry,
           accepted_state = p_state, corrected = v_corrected
     WHERE id = p_proposal_id AND status = 'foreslatt';
  END IF;
  RETURN v_res || jsonb_build_object('proposal_id', p_proposal_id);
END $$;

CREATE OR REPLACE FUNCTION public.vt_ocr_reject(p_op_id uuid, p_proposal_id uuid, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p vt_ocr_proposals; v_uid uuid; v_prev jsonb;
BEGIN
  SELECT * INTO v_p FROM vt_ocr_proposals WHERE id = p_proposal_id;
  v_uid := _vt_require(v_p.legal_entity_id, 'write');
  v_prev := _vt_op_begin(p_op_id, 'ocr_reject', v_p.legal_entity_id, v_uid, jsonb_build_object('proposal_id', p_proposal_id, 'note', p_note));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  UPDATE vt_ocr_proposals SET status = 'avvist', decided_by = v_uid, decided_at = now(), decision_note = left(p_note, 500)
   WHERE id = p_proposal_id AND status = 'foreslatt';
  IF NOT FOUND THEN RAISE EXCEPTION 'Forslaget er allerede avgjort' USING ERRCODE = '55000'; END IF;
  RETURN _vt_op_finish(p_op_id, jsonb_build_object('ok', true, 'kind', 'ocr_reject', 'proposal_id', p_proposal_id));
END $$;

-- ---------- RPC: rapport-e-post ----------
CREATE OR REPLACE FUNCTION public.vt_report_mail_reserve(p_op_id uuid, p_count_id uuid, p_count_revision integer, p_report_hash text,
  p_recipient text, p_subject text, p_message text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c vt_counts; v_uid uuid; v_op vt_report_mail_ops;
BEGIN
  SELECT * INTO v_c FROM vt_counts WHERE id = p_count_id;
  v_uid := _vt_require(v_c.legal_entity_id, 'write');
  IF p_op_id IS NULL THEN RAISE EXCEPTION 'Operasjons-ID mangler' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_op FROM vt_report_mail_ops WHERE op_id = p_op_id;
  IF FOUND THEN
    IF v_op.count_id <> p_count_id OR v_op.created_by <> v_uid OR v_op.report_hash <> p_report_hash OR v_op.recipient <> p_recipient
       OR v_op.subject <> p_subject OR v_op.message <> p_message OR v_op.count_revision <> p_count_revision THEN
      RAISE EXCEPTION 'Operasjons-ID er brukt med annet innhold' USING ERRCODE = '23505'; END IF;
    RETURN jsonb_build_object('op_id', p_op_id, 'state', v_op.state, 'replayed', true);
  END IF;
  SELECT * INTO v_c FROM vt_counts WHERE id = p_count_id FOR SHARE;
  IF v_c.status = 'planlagt' OR v_c.revision <> p_count_revision THEN RAISE EXCEPTION 'Rapporten er endret' USING ERRCODE = '40001'; END IF;
  INSERT INTO vt_report_mail_ops (op_id, legal_entity_id, count_id, count_revision, report_hash, recipient, subject, message, created_by)
  VALUES (p_op_id, v_c.legal_entity_id, p_count_id, p_count_revision, p_report_hash, btrim(p_recipient), btrim(p_subject), p_message, v_uid);
  RETURN jsonb_build_object('op_id', p_op_id, 'state', 'reservert', 'replayed', false);
END $$;

/** Service: bare «reservert» → «sender». Alt annet returneres uendret (aldri ny sending). */
CREATE OR REPLACE FUNCTION public.vt_report_mail_claim(p_op_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_state text;
BEGIN
  UPDATE vt_report_mail_ops SET state = 'sender', updated_at = now() WHERE op_id = p_op_id AND state = 'reservert' RETURNING state INTO v_state;
  IF FOUND THEN RETURN jsonb_build_object('claimed', true, 'state', v_state); END IF;
  SELECT state INTO v_state FROM vt_report_mail_ops WHERE op_id = p_op_id;
  RETURN jsonb_build_object('claimed', false, 'state', coalesce(v_state, 'ukjent'));
END $$;
CREATE OR REPLACE FUNCTION public.vt_report_mail_finish(p_op_id uuid, p_state text, p_detail text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_state NOT IN ('akseptert_av_tjenesten','avvist','ukjent') THEN RAISE EXCEPTION 'Ugyldig utfall' USING ERRCODE = '22023'; END IF;
  UPDATE vt_report_mail_ops SET state = p_state, detail = left(p_detail, 300), updated_at = now() WHERE op_id = p_op_id AND state = 'sender';
END $$;

-- ---------- RPC: tildeling ----------
-- Skrivebrukere kan ta/forlate en liste selv; godkjennere kan fjerne andre. Rolle «kontrollor» krever approve.
CREATE OR REPLACE FUNCTION public.vt_assign_list(p_op_id uuid, p_list_id uuid, p_user_id uuid, p_role text, p_remove boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_l vt_count_lists; v_uid uuid; v_prev jsonb;
BEGIN
  SELECT * INTO v_l FROM vt_count_lists WHERE id = p_list_id;
  v_uid := _vt_require(v_l.legal_entity_id, 'write');
  IF p_user_id IS NULL OR p_remove IS NULL OR p_role NOT IN ('teller','kontrollor') THEN RAISE EXCEPTION 'Ugyldig tildeling' USING ERRCODE = '22023'; END IF;
  IF (p_user_id <> v_uid OR p_role = 'kontrollor') AND NOT has_ravarer_access(v_uid, v_l.legal_entity_id, 'approve') THEN
    RAISE EXCEPTION 'Mangler tilgang' USING ERRCODE = '42501'; END IF;
  IF NOT p_remove AND NOT has_ravarer_access(p_user_id, v_l.legal_entity_id, 'write') THEN
    RAISE EXCEPTION 'Brukeren har ikke skrivetilgang i firmaet' USING ERRCODE = '22023'; END IF;
  v_prev := _vt_op_begin(p_op_id, 'assign_list', v_l.legal_entity_id, v_uid, jsonb_build_object('list', p_list_id, 'user', p_user_id, 'role', p_role, 'remove', p_remove));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  PERFORM 1 FROM vt_counts WHERE id = v_l.count_id FOR SHARE;
  PERFORM 1 FROM vt_count_lists WHERE id = p_list_id FOR UPDATE;
  IF p_remove THEN DELETE FROM vt_list_assignments WHERE count_list_id = p_list_id AND user_id = p_user_id AND role = p_role;
  ELSE INSERT INTO vt_list_assignments (count_list_id, legal_entity_id, user_id, role, assigned_by)
       VALUES (p_list_id, v_l.legal_entity_id, p_user_id, p_role, v_uid) ON CONFLICT DO NOTHING; END IF;
  RETURN _vt_op_finish(p_op_id, jsonb_build_object('ok', true, 'kind', 'assign_list', 'list_id', p_list_id, 'user_id', p_user_id, 'role', p_role, 'removed', p_remove));
END $$;

-- ---------- Rettigheter: eksakt minimum ----------
REVOKE ALL ON FUNCTION public.vt_stage3_version(), public.vt_ocr_create_job(uuid,uuid,text,text,integer,boolean), public.vt_ocr_claim(uuid),
  public.vt_ocr_record_unknown(uuid), public.vt_ocr_record_failure(uuid,text), public.vt_ocr_record_result(uuid,boolean,jsonb,jsonb),
  public.vt_ocr_reset_unknown(uuid,uuid,boolean), public.vt_ocr_accept(uuid,uuid,integer,text,numeric,jsonb,text), public.vt_ocr_reject(uuid,uuid,text),
  public.vt_report_mail_reserve(uuid,uuid,integer,text,text,text,text), public.vt_report_mail_claim(uuid), public.vt_report_mail_finish(uuid,text,text),
  public.vt_assign_list(uuid,uuid,uuid,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vt_stage3_version(), public.vt_ocr_create_job(uuid,uuid,text,text,integer,boolean), public.vt_ocr_claim(uuid),
  public.vt_ocr_reset_unknown(uuid,uuid,boolean), public.vt_ocr_accept(uuid,uuid,integer,text,numeric,jsonb,text), public.vt_ocr_reject(uuid,uuid,text),
  public.vt_report_mail_reserve(uuid,uuid,integer,text,text,text,text), public.vt_assign_list(uuid,uuid,uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vt_ocr_record_unknown(uuid), public.vt_ocr_record_failure(uuid,text), public.vt_ocr_record_result(uuid,boolean,jsonb,jsonb),
  public.vt_report_mail_claim(uuid), public.vt_report_mail_finish(uuid,text,text) TO service_role;
