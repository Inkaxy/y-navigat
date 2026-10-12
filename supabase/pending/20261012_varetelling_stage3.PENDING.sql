-- FORSLAG — IKKE KJØRT. Varetelling trinn 3 (revisjon 2): listebundet opplasting med lese-FORSLAG, rapport-e-post,
-- tildeling. Krever 20261012_varetelling_foundation.PENDING.sql (revisjon 2). Endrer ingen eksisterende funksjoner.
-- Lagringsbøtte/-regler: 20261012_varetelling_stage3_storage.PENDING.sql (ikke testbar i PGlite).
-- Låsrekkefølge (som grunnlaget): telling → liste → linje → forslag/jobb. E-postoperasjoner låses alene.

CREATE OR REPLACE FUNCTION public.vt_stage3_version() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT jsonb_build_object('stage3', 2) $$;

-- ---------- Opplasting/lesing ----------
CREATE TABLE public.vt_ocr_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL,
  count_id uuid NOT NULL,
  count_list_id uuid NOT NULL,
  template_revision integer NOT NULL,
  line_revisions jsonb NOT NULL,                  -- {line_id: revisjon} ved opplasting (uforanderlig)
  files_key text NOT NULL,                        -- «sha:størrelse|…» i rekkefølge; duplikatnøkkel per liste
  originals jsonb NOT NULL,                       -- [{path, sha256, size, mime}] i siderekkefølge; serveren verifiserer filene
  status text NOT NULL DEFAULT 'opprettet' CHECK (status IN ('opprettet','behandler','ukjent_ai_utfall','klar','feilet')),
  attempt_id uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  page_count integer CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 20),
  document_ok boolean,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  detail text,
  finished_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_list_id, files_key),
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
  entries jsonb NOT NULL,                        -- [{unit_id, unit_known, label, value|null, reason|null, raw}] — FORSLAG
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  crop jsonb,                                    -- fylles ikke av lesetjenesten ennå; UI viser hel side
  status text NOT NULL DEFAULT 'foreslatt' CHECK (status IN ('foreslatt','godkjent','avvist')),
  decided_by uuid, decided_at timestamptz,
  accepted_entry jsonb, accepted_state text, accepted_exclusions jsonb, decision_note text, save_op_id uuid,
  UNIQUE (job_id, line_id),
  FOREIGN KEY (job_id, legal_entity_id) REFERENCES public.vt_ocr_jobs (id, legal_entity_id)
);

-- ---------- Rapport-e-post (lagrer nøyaktig øyeblikksbilde og vedlegg) ----------
CREATE TABLE public.vt_report_mail_ops (
  op_id uuid PRIMARY KEY,
  legal_entity_id uuid NOT NULL,
  count_id uuid NOT NULL,
  count_revision integer NOT NULL,
  report_hash text NOT NULL CHECK (report_hash ~ '^[0-9a-f]{64}$'),
  recipient text NOT NULL CHECK (length(recipient) <= 254 AND recipient ~* '^[^[:space:]@<>(),;:"]+@[^[:space:]@<>(),;:"]+\.[a-z]{2,}$'),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 200),
  message text NOT NULL CHECK (length(message) <= 4000),
  snapshot jsonb NOT NULL,
  csv text NOT NULL,
  pdf_b64 text NOT NULL,
  attachment_base text NOT NULL,
  final boolean NOT NULL,
  sender text NOT NULL,
  state text NOT NULL DEFAULT 'reservert' CHECK (state IN ('reservert','sender','akseptert_av_tjenesten','avvist','ukjent')),
  detail text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (count_id, legal_entity_id) REFERENCES public.vt_counts (id, legal_entity_id)
);

-- ---------- Tildeling ----------
CREATE TABLE public.vt_list_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_list_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'teller' CHECK (role IN ('teller','kontrollor')),
  assigned_by uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_list_id, user_id, role),
  FOREIGN KEY (count_list_id, legal_entity_id) REFERENCES public.vt_count_lists (id, legal_entity_id)
);

-- Eksplisitte rettigheter, uavhengig av standard-ACL: klient leser via RLS; bare service skriver direkte.
REVOKE ALL ON public.vt_ocr_jobs, public.vt_ocr_proposals, public.vt_report_mail_ops, public.vt_list_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vt_ocr_jobs, public.vt_ocr_proposals, public.vt_list_assignments TO authenticated;
GRANT SELECT (op_id, legal_entity_id, count_id, count_revision, report_hash, recipient, subject, state, detail, created_by, created_at, updated_at)
  ON public.vt_report_mail_ops TO authenticated;
GRANT ALL ON public.vt_ocr_jobs, public.vt_ocr_proposals, public.vt_report_mail_ops, public.vt_list_assignments TO service_role;
ALTER TABLE public.vt_ocr_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_ocr_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_report_mail_ops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_list_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY vt_ocr_jobs_read ON public.vt_ocr_jobs FOR SELECT TO authenticated USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY vt_ocr_proposals_read ON public.vt_ocr_proposals FOR SELECT TO authenticated USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY vt_report_mail_ops_read ON public.vt_report_mail_ops FOR SELECT TO authenticated USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY vt_list_assignments_read ON public.vt_list_assignments FOR SELECT TO authenticated USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));

-- ---------- Rapport: koherent øyeblikksbilde (én setning, ingen radgrense) ----------
-- generatedAt = dataversjonen (siste endring), så samme data gir byte-like vedlegg og samme hash.
CREATE OR REPLACE FUNCTION public.vt_report_snapshot(p_count_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c vt_counts; v jsonb;
BEGIN
  SELECT * INTO v_c FROM vt_counts WHERE id = p_count_id;
  PERFORM _vt_require(v_c.legal_entity_id, 'read');
  IF v_c.status = 'planlagt' THEN RAISE EXCEPTION 'Tellingen er ikke startet' USING ERRCODE = '55000'; END IF;
  SELECT jsonb_build_object(
    'count', jsonb_build_object('id', v_c.id, 'name', v_c.name, 'planned_date', v_c.planned_date, 'status', v_c.status, 'revision', v_c.revision,
       'valuation_mode', v_c.valuation_mode, 'valuation_date', v_c.valuation_date, 'finished_at', v_c.finished_at),
    'lists', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'department', department, 'status', status, 'sort_order', sort_order,
       'source_template_revision', source_template_revision) ORDER BY sort_order, id) FROM vt_count_lists WHERE count_id = p_count_id), '[]'::jsonb),
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'count_list_id', count_list_id, 'raw_material_id', raw_material_id, 'sort_order', sort_order,
       'snap_name', snap_name, 'snap_sku', snap_sku, 'snap_location_name', snap_location_name, 'snap_base_unit', snap_base_unit,
       'snap_price_per_base', snap_price_per_base, 'snap_price_source', snap_price_source, 'snap_price_reason', snap_price_reason,
       'snap_price_effective_date', snap_price_effective_date, 'snap_price_known_after_valuation', snap_price_known_after_valuation,
       'state', state, 'counted_base', counted_base, 'note', note, 'revision', revision) ORDER BY sort_order, id) FROM vt_count_lines WHERE count_id = p_count_id), '[]'::jsonb),
    'generatedAt', 'data per ' || to_char(greatest(v_c.started_at, v_c.finished_at, (SELECT max(updated_at) FROM vt_count_lines WHERE count_id = p_count_id))
       AT TIME ZONE 'Europe/Oslo', 'DD.MM.YYYY HH24:MI:SS') || ' (rev ' || v_c.revision || ')')
  INTO v;
  RETURN v;
END $$;

-- ---------- RPC: opprett opplastingsjobb (én jobb per liste med alle sider) ----------
CREATE OR REPLACE FUNCTION public.vt_ocr_create_job(p_op_id uuid, p_list_id uuid, p_files jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_prev jsonb; v_list vt_count_lists; v_count vt_counts; v_job vt_ocr_jobs; v_key text; f jsonb; v_n int := 0;
  v_orig jsonb := '[]'::jsonb; v_res jsonb; v_id uuid := gen_random_uuid(); v_ext text;
BEGIN
  SELECT * INTO v_list FROM vt_count_lists WHERE id = p_list_id;
  v_uid := _vt_require(v_list.legal_entity_id, 'write');
  IF p_files IS NULL OR jsonb_typeof(p_files) <> 'array' OR jsonb_array_length(p_files) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Last opp 1–20 sider' USING ERRCODE = '22023'; END IF;
  FOR f IN SELECT x FROM jsonb_array_elements(p_files) x LOOP
    v_n := v_n + 1;
    IF jsonb_typeof(f) <> 'object' OR coalesce(f->>'sha256', '') !~ '^[0-9a-f]{64}$' OR jsonb_typeof(f->'size') <> 'number'
       OR (f->>'size')::numeric NOT BETWEEN 1 AND 20971520 OR (f->>'size')::numeric <> trunc((f->>'size')::numeric)
       OR coalesce(f->>'mime', '') NOT IN ('application/pdf','image/jpeg','image/png') THEN
      RAISE EXCEPTION 'Ugyldig fil (bare PDF, JPEG eller PNG, maks 20 MB)' USING ERRCODE = '22023'; END IF;
    v_ext := CASE f->>'mime' WHEN 'application/pdf' THEN 'pdf' WHEN 'image/png' THEN 'png' ELSE 'jpg' END;
    v_orig := v_orig || jsonb_build_object('path', v_list.legal_entity_id || '/' || v_list.count_id || '/' || p_list_id || '/' || v_id || '/side-' || v_n || '.' || v_ext,
      'sha256', f->>'sha256', 'size', (f->>'size')::int, 'mime', f->>'mime');
  END LOOP;
  SELECT string_agg((x->>'sha256') || ':' || (x->>'size'), '|' ORDER BY o) INTO v_key FROM jsonb_array_elements(p_files) WITH ORDINALITY t(x, o);
  v_prev := _vt_op_begin(p_op_id, 'ocr_create_job', v_list.legal_entity_id, v_uid, jsonb_build_object('list_id', p_list_id, 'files', p_files));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  SELECT * INTO v_count FROM vt_counts WHERE id = v_list.count_id FOR SHARE;
  SELECT * INTO v_list FROM vt_count_lists WHERE id = p_list_id FOR SHARE;
  IF v_count.status NOT IN ('pagar','til_kontroll') OR v_list.status = 'godkjent' THEN
    RAISE EXCEPTION 'Listen er ikke åpen for registrering' USING ERRCODE = '55000'; END IF;
  SELECT * INTO v_job FROM vt_ocr_jobs WHERE count_list_id = p_list_id AND files_key = v_key;
  IF FOUND THEN
    RETURN _vt_op_finish(p_op_id, jsonb_build_object('ok', true, 'kind', 'ocr_create_job', 'duplicate', true, 'job_id', v_job.id, 'status', v_job.status, 'originals', v_job.originals));
  END IF;
  INSERT INTO vt_ocr_jobs (id, legal_entity_id, count_id, count_list_id, template_revision, line_revisions, files_key, originals, created_by)
  VALUES (v_id, v_list.legal_entity_id, v_list.count_id, v_list.id, v_list.source_template_revision,
          coalesce((SELECT jsonb_object_agg(id, revision) FROM vt_count_lines WHERE count_list_id = v_list.id), '{}'::jsonb), v_key, v_orig, v_uid)
  RETURNING * INTO v_job;
  v_res := jsonb_build_object('ok', true, 'kind', 'ocr_create_job', 'duplicate', false, 'job_id', v_job.id, 'status', v_job.status, 'originals', v_job.originals);
  RETURN _vt_op_finish(p_op_id, v_res);
END $$;

-- ---------- RPC: lease for lesing (Edge med brukerens JWT) ----------
-- Bare «opprettet» kan tas, og bare mens telling/liste er åpen. Gir ny attempt_id + lease (15 min).
CREATE OR REPLACE FUNCTION public.vt_ocr_claim(p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job vt_ocr_jobs; v_cs text; v_ls text; v_lines jsonb; v_attempt uuid := gen_random_uuid();
BEGIN
  SELECT * INTO v_job FROM vt_ocr_jobs WHERE id = p_job_id;
  PERFORM _vt_require(v_job.legal_entity_id, 'write');
  SELECT status INTO v_cs FROM vt_counts WHERE id = v_job.count_id FOR SHARE;
  SELECT status INTO v_ls FROM vt_count_lists WHERE id = v_job.count_list_id FOR SHARE;
  SELECT * INTO v_job FROM vt_ocr_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_cs NOT IN ('pagar','til_kontroll') OR v_ls = 'godkjent' THEN RAISE EXCEPTION 'Listen er ikke åpen' USING ERRCODE = '55000'; END IF;
  IF v_job.status <> 'opprettet' THEN RAISE EXCEPTION 'Jobben er allerede tatt' USING ERRCODE = '55000'; END IF;
  UPDATE vt_ocr_jobs SET status = 'behandler', attempt_id = v_attempt, lease_until = now() + interval '15 minutes', attempts = attempts + 1, detail = NULL
   WHERE id = p_job_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'revision', (v_job.line_revisions->>(l.id::text))::int, 'snap_name', l.snap_name,
           'snap_base_unit', l.snap_base_unit, 'snap_units', l.snap_units) ORDER BY l.sort_order, l.id), '[]'::jsonb)
    INTO v_lines FROM vt_count_lines l WHERE l.count_list_id = v_job.count_list_id;
  RETURN jsonb_build_object('attempt_id', v_attempt, 'count_id', v_job.count_id, 'list_id', v_job.count_list_id, 'template_revision', v_job.template_revision,
    'originals', v_job.originals, 'lines', v_lines);
END $$;

-- ---------- Service: registrering bundet til attempt_id (gammelt forsøk kan aldri overskrive nyere) ----------
CREATE OR REPLACE FUNCTION public._vt_ocr_attempt(p_job_id uuid, p_attempt uuid) RETURNS vt_ocr_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v vt_ocr_jobs;
BEGIN
  SELECT * INTO v FROM vt_ocr_jobs WHERE id = p_job_id FOR UPDATE;
  IF v.status IS DISTINCT FROM 'behandler' OR v.attempt_id IS DISTINCT FROM p_attempt OR p_attempt IS NULL THEN
    RAISE EXCEPTION 'Forsøket er ikke lenger gjeldende' USING ERRCODE = '55000'; END IF;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.vt_ocr_record_page_count(p_job_id uuid, p_attempt_id uuid, p_pages integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _vt_ocr_attempt(p_job_id, p_attempt_id);
  IF p_pages IS NULL OR p_pages NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Ugyldig sideantall' USING ERRCODE = '22023'; END IF;
  UPDATE vt_ocr_jobs SET page_count = p_pages WHERE id = p_job_id;
END $$;
CREATE OR REPLACE FUNCTION public.vt_ocr_record_unknown(p_job_id uuid, p_attempt_id uuid, p_detail text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _vt_ocr_attempt(p_job_id, p_attempt_id);
  UPDATE vt_ocr_jobs SET status = 'ukjent_ai_utfall', detail = left(p_detail, 300), finished_at = now() WHERE id = p_job_id;
END $$;
CREATE OR REPLACE FUNCTION public.vt_ocr_record_failure(p_job_id uuid, p_attempt_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _vt_ocr_attempt(p_job_id, p_attempt_id);
  UPDATE vt_ocr_jobs SET status = 'feilet', detail = left(p_reason, 300), finished_at = now() WHERE id = p_job_id;
END $$;
CREATE OR REPLACE FUNCTION public.vt_ocr_record_result(p_job_id uuid, p_attempt_id uuid, p_document_ok boolean, p_issues jsonb, p_proposals jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job vt_ocr_jobs; p jsonb; v_rev int; v_n int := 0; v_issues jsonb := coalesce(p_issues, '[]'::jsonb); v_ok boolean := coalesce(p_document_ok, false);
BEGIN
  v_job := _vt_ocr_attempt(p_job_id, p_attempt_id);
  IF jsonb_typeof(p_proposals) IS DISTINCT FROM 'array' OR jsonb_array_length(p_proposals) > 2000 OR jsonb_typeof(v_issues) <> 'array' THEN
    RAISE EXCEPTION 'Ugyldig resultat' USING ERRCODE = '22023'; END IF;
  FOR p IN SELECT * FROM jsonb_array_elements(p_proposals) LOOP
    v_rev := (v_job.line_revisions->>(p->>'line_id'))::int;
    IF v_rev IS NULL OR NOT EXISTS (SELECT 1 FROM vt_count_lines WHERE id = (p->>'line_id')::uuid AND count_list_id = v_job.count_list_id)
       OR (p->>'line_revision_at_job')::int IS DISTINCT FROM v_rev OR jsonb_typeof(p->'entries') IS DISTINCT FROM 'array' THEN
      v_issues := v_issues || to_jsonb('Forslag for ukjent/fremmed linje avvist'::text); v_ok := false; CONTINUE;
    END IF;
    INSERT INTO vt_ocr_proposals (job_id, legal_entity_id, line_id, line_revision_at_job, page, row_code, entries, reasons)
    VALUES (v_job.id, v_job.legal_entity_id, (p->>'line_id')::uuid, v_rev, (p->>'page')::int, left(p->>'row_code', 16),
            p->'entries', coalesce(p->'reasons', '[]'::jsonb))
    ON CONFLICT (job_id, line_id) DO NOTHING;
    v_n := v_n + 1;
  END LOOP;
  UPDATE vt_ocr_jobs SET status = 'klar', document_ok = v_ok, issues = v_issues, finished_at = now() WHERE id = p_job_id;
  RETURN jsonb_build_object('proposals', v_n);
END $$;

/** Skrivebeskyttet status inkl. utløpt lease (vises som ukjent utfall; ingen sideeffekt). */
CREATE OR REPLACE FUNCTION public.vt_ocr_job_status(p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v vt_ocr_jobs;
BEGIN
  SELECT * INTO v FROM vt_ocr_jobs WHERE id = p_job_id;
  PERFORM _vt_require(v.legal_entity_id, 'read');
  RETURN jsonb_build_object('status', v.status, 'lease_expired', v.status = 'behandler' AND v.lease_until < now(), 'attempts', v.attempts, 'detail', v.detail);
END $$;

/** Godkjenner bekrefter ny BETALT lesing etter ukjent utfall eller utløpt lease. Gammelt forsøk blir ugyldig. */
CREATE OR REPLACE FUNCTION public.vt_ocr_reset_unknown(p_op_id uuid, p_job_id uuid, p_confirm_paid_rerun boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job vt_ocr_jobs; v_uid uuid; v_prev jsonb;
BEGIN
  SELECT * INTO v_job FROM vt_ocr_jobs WHERE id = p_job_id;
  v_uid := _vt_require(v_job.legal_entity_id, 'approve');
  IF p_confirm_paid_rerun IS NOT TRUE THEN RAISE EXCEPTION 'Ny kjøring må bekreftes' USING ERRCODE = '22023'; END IF;
  v_prev := _vt_op_begin(p_op_id, 'ocr_reset', v_job.legal_entity_id, v_uid, jsonb_build_object('job_id', p_job_id));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  UPDATE vt_ocr_jobs SET status = 'opprettet', attempt_id = NULL, lease_until = NULL, finished_at = NULL
   WHERE id = p_job_id AND (status = 'ukjent_ai_utfall' OR (status = 'behandler' AND lease_until < now()));
  IF NOT FOUND THEN RAISE EXCEPTION 'Jobben har ikke ukjent utfall' USING ERRCODE = '55000'; END IF;
  RETURN _vt_op_finish(p_op_id, jsonb_build_object('ok', true, 'kind', 'ocr_reset', 'job_id', p_job_id));
END $$;

-- ---------- RPC: godkjenn ett forslag ----------
-- Egen op (med forslags-ID) + avledet op for linjelagringen. Låser telling → liste → linje → forslag → jobb og
-- kontrollerer alt avgjørende under lås. Lagring og revisjonsspor skjer i samme transaksjon (enten begge eller ingen).
CREATE OR REPLACE FUNCTION public.vt_ocr_accept(p_op_id uuid, p_proposal_id uuid, p_expected_revision integer, p_state text,
  p_counted_base numeric, p_entry jsonb, p_note text, p_exclusions jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p vt_ocr_proposals; v_job vt_ocr_jobs; v_line vt_count_lines; v_uid uuid; v_prev jsonb; v_res jsonb; v_n int; v_save uuid; x jsonb;
BEGIN
  SELECT * INTO v_p FROM vt_ocr_proposals WHERE id = p_proposal_id;
  v_uid := _vt_require(v_p.legal_entity_id, 'write');
  IF p_exclusions IS NULL OR jsonb_typeof(p_exclusions) <> 'array' OR jsonb_array_length(p_exclusions) > 12 THEN
    RAISE EXCEPTION 'Ugyldige utelatelser' USING ERRCODE = '22023'; END IF;
  FOR x IN SELECT e FROM jsonb_array_elements(p_exclusions) e LOOP
    IF jsonb_typeof(x) <> 'object' OR length(btrim(coalesce(x->>'reason', ''))) < 3 OR length(x->>'reason') > 300 THEN
      RAISE EXCEPTION 'Utelatt felt må begrunnes' USING ERRCODE = '22023'; END IF;
  END LOOP;
  v_prev := _vt_op_begin(p_op_id, 'ocr_accept', v_p.legal_entity_id, v_uid, jsonb_build_object('proposal_id', p_proposal_id,
    'expected_revision', p_expected_revision, 'state', p_state, 'counted_base', p_counted_base::text, 'entry', p_entry, 'note', p_note, 'exclusions', p_exclusions));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  SELECT * INTO v_line FROM vt_count_lines WHERE id = v_p.line_id;
  PERFORM 1 FROM vt_counts WHERE id = v_line.count_id FOR SHARE;
  PERFORM 1 FROM vt_count_lists WHERE id = v_line.count_list_id FOR UPDATE;
  SELECT * INTO v_line FROM vt_count_lines WHERE id = v_p.line_id FOR UPDATE;
  SELECT * INTO v_p FROM vt_ocr_proposals WHERE id = p_proposal_id FOR UPDATE;
  SELECT * INTO v_job FROM vt_ocr_jobs WHERE id = v_p.job_id FOR SHARE;
  IF v_job.status <> 'klar' OR v_job.document_ok IS NOT TRUE THEN RAISE EXCEPTION 'Dokumentets identitet er ikke bekreftet' USING ERRCODE = '55000'; END IF;
  IF v_p.status <> 'foreslatt' THEN RAISE EXCEPTION 'Forslaget er allerede avgjort' USING ERRCODE = '55000'; END IF;
  IF v_line.count_list_id <> v_job.count_list_id THEN RAISE EXCEPTION 'Linjen hører ikke til listen' USING ERRCODE = '42501'; END IF;
  IF p_expected_revision IS DISTINCT FROM v_p.line_revision_at_job OR v_line.revision <> v_p.line_revision_at_job THEN
    RAISE EXCEPTION 'Linjen er endret etter opplasting — kontroller manuelt' USING ERRCODE = '40001'; END IF;
  v_save := md5(p_op_id::text || ':ocr-save')::uuid;
  v_res := vt_save_line(v_save, v_p.line_id, p_expected_revision, p_state, p_counted_base, p_entry, p_note) - 'replayed';
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Linjen kunne ikke lagres' USING ERRCODE = '40001'; END IF;
  UPDATE vt_ocr_proposals SET status = 'godkjent', decided_by = v_uid, decided_at = now(), accepted_entry = p_entry, accepted_state = p_state,
         accepted_exclusions = p_exclusions, save_op_id = v_save
   WHERE id = p_proposal_id AND status = 'foreslatt';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Forslaget endret seg under godkjenning' USING ERRCODE = 'XX000'; END IF;
  RETURN _vt_op_finish(p_op_id, v_res || jsonb_build_object('kind', 'ocr_accept', 'proposal_id', p_proposal_id));
END $$;

CREATE OR REPLACE FUNCTION public.vt_ocr_reject(p_op_id uuid, p_proposal_id uuid, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p vt_ocr_proposals; v_line vt_count_lines; v_uid uuid; v_prev jsonb; v_n int;
BEGIN
  SELECT * INTO v_p FROM vt_ocr_proposals WHERE id = p_proposal_id;
  v_uid := _vt_require(v_p.legal_entity_id, 'write');
  v_prev := _vt_op_begin(p_op_id, 'ocr_reject', v_p.legal_entity_id, v_uid, jsonb_build_object('proposal_id', p_proposal_id, 'note', p_note));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  SELECT * INTO v_line FROM vt_count_lines WHERE id = v_p.line_id;
  PERFORM 1 FROM vt_counts WHERE id = v_line.count_id FOR SHARE;
  PERFORM 1 FROM vt_count_lists WHERE id = v_line.count_list_id FOR UPDATE;
  PERFORM 1 FROM vt_count_lines WHERE id = v_p.line_id FOR UPDATE;
  UPDATE vt_ocr_proposals SET status = 'avvist', decided_by = v_uid, decided_at = now(), decision_note = left(p_note, 500)
   WHERE id = p_proposal_id AND status = 'foreslatt';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Forslaget er allerede avgjort' USING ERRCODE = '55000'; END IF;
  RETURN _vt_op_finish(p_op_id, jsonb_build_object('ok', true, 'kind', 'ocr_reject', 'proposal_id', p_proposal_id));
END $$;

-- ---------- RPC: rapport-e-post ----------
CREATE OR REPLACE FUNCTION public.vt_report_mail_reserve(p_op_id uuid, p_count_id uuid, p_count_revision integer, p_report_hash text,
  p_recipient text, p_subject text, p_message text, p_snapshot jsonb, p_csv text, p_pdf_b64 text, p_attachment_base text, p_final boolean, p_sender text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c vt_counts; v_uid uuid; v_op vt_report_mail_ops;
BEGIN
  SELECT * INTO v_c FROM vt_counts WHERE id = p_count_id;
  v_uid := _vt_require(v_c.legal_entity_id, 'write');
  IF p_op_id IS NULL OR p_snapshot IS NULL OR p_csv IS NULL OR p_pdf_b64 IS NULL OR p_final IS NULL OR coalesce(p_sender, '') !~ '@' THEN
    RAISE EXCEPTION 'Ufullstendig sending' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_op FROM vt_report_mail_ops WHERE op_id = p_op_id FOR UPDATE;
  IF FOUND THEN
    IF v_op.count_id <> p_count_id OR v_op.created_by <> v_uid OR v_op.report_hash <> p_report_hash OR v_op.recipient <> btrim(p_recipient)
       OR v_op.subject <> btrim(p_subject) OR v_op.message <> p_message THEN
      RAISE EXCEPTION 'Operasjons-ID er brukt med annet innhold' USING ERRCODE = '23505'; END IF;
    RETURN jsonb_build_object('op_id', p_op_id, 'state', v_op.state, 'replayed', true);
  END IF;
  IF v_c.status = 'planlagt' OR v_c.revision <> p_count_revision OR (p_snapshot->'count'->>'id') IS DISTINCT FROM p_count_id::text THEN
    RAISE EXCEPTION 'Rapporten er endret' USING ERRCODE = '40001'; END IF;
  INSERT INTO vt_report_mail_ops (op_id, legal_entity_id, count_id, count_revision, report_hash, recipient, subject, message, snapshot, csv, pdf_b64,
                                  attachment_base, final, sender, created_by)
  VALUES (p_op_id, v_c.legal_entity_id, p_count_id, p_count_revision, p_report_hash, btrim(p_recipient), btrim(p_subject), p_message, p_snapshot, p_csv, p_pdf_b64,
          left(p_attachment_base, 120), p_final, p_sender, v_uid);
  RETURN jsonb_build_object('op_id', p_op_id, 'state', 'reservert', 'replayed', false);
END $$;

/** Skrivebeskyttet: status for egen/firmaets sending. Sender aldri. */
CREATE OR REPLACE FUNCTION public.vt_report_mail_status(p_op_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v vt_report_mail_ops;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Mangler tilgang' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM vt_report_mail_ops WHERE op_id = p_op_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  PERFORM _vt_require(v.legal_entity_id, 'read');
  RETURN jsonb_build_object('found', true, 'state', v.state, 'detail', v.detail, 'count_id', v.count_id, 'report_hash', v.report_hash);
END $$;

/** Service: bare «reservert» → «sender», med LAGREDE vedlegg. Alt annet returneres uendret (aldri ny sending). */
CREATE OR REPLACE FUNCTION public.vt_report_mail_claim(p_op_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v vt_report_mail_ops;
BEGIN
  SELECT * INTO v FROM vt_report_mail_ops WHERE op_id = p_op_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('claimed', false, 'state', 'ukjent'); END IF;
  IF v.state <> 'reservert' THEN RETURN jsonb_build_object('claimed', false, 'state', v.state); END IF;
  UPDATE vt_report_mail_ops SET state = 'sender', updated_at = now() WHERE op_id = p_op_id;
  RETURN jsonb_build_object('claimed', true, 'state', 'sender', 'recipient', v.recipient, 'subject', v.subject, 'message', v.message,
    'csv', v.csv, 'pdf_b64', v.pdf_b64, 'attachment_base', v.attachment_base, 'final', v.final, 'sender', v.sender);
END $$;
CREATE OR REPLACE FUNCTION public.vt_report_mail_finish(p_op_id uuid, p_state text, p_detail text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_state NOT IN ('akseptert_av_tjenesten','avvist','ukjent') THEN RAISE EXCEPTION 'Ugyldig utfall' USING ERRCODE = '22023'; END IF;
  UPDATE vt_report_mail_ops SET state = p_state, detail = left(p_detail, 300), updated_at = now() WHERE op_id = p_op_id AND state = 'sender';
END $$;

-- ---------- RPC: tildeling (bare mens tellingen er planlagt/pågår/til kontroll; historikk endres ikke etterpå) ----------
CREATE OR REPLACE FUNCTION public.vt_assign_list(p_op_id uuid, p_list_id uuid, p_user_id uuid, p_role text, p_remove boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_l vt_count_lists; v_uid uuid; v_prev jsonb; v_cs text;
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
  SELECT status INTO v_cs FROM vt_counts WHERE id = v_l.count_id FOR SHARE;
  PERFORM 1 FROM vt_count_lists WHERE id = p_list_id FOR UPDATE;
  IF v_cs NOT IN ('planlagt','pagar','til_kontroll') THEN RAISE EXCEPTION 'Tellingen er avsluttet — tildeling endres ikke' USING ERRCODE = '55000'; END IF;
  IF p_remove THEN DELETE FROM vt_list_assignments WHERE count_list_id = p_list_id AND user_id = p_user_id AND role = p_role;
  ELSE INSERT INTO vt_list_assignments (count_list_id, legal_entity_id, user_id, role, assigned_by)
       VALUES (p_list_id, v_l.legal_entity_id, p_user_id, p_role, v_uid) ON CONFLICT DO NOTHING; END IF;
  RETURN _vt_op_finish(p_op_id, jsonb_build_object('ok', true, 'kind', 'assign_list', 'list_id', p_list_id, 'user_id', p_user_id, 'role', p_role, 'removed', p_remove));
END $$;

-- ---------- Rettigheter: eksakt minimum, eksplisitt for alle roller ----------
REVOKE ALL ON FUNCTION public.vt_stage3_version(), public.vt_report_snapshot(uuid), public.vt_ocr_create_job(uuid,uuid,jsonb), public.vt_ocr_claim(uuid),
  public._vt_ocr_attempt(uuid,uuid), public.vt_ocr_record_page_count(uuid,uuid,integer), public.vt_ocr_record_unknown(uuid,uuid,text),
  public.vt_ocr_record_failure(uuid,uuid,text), public.vt_ocr_record_result(uuid,uuid,boolean,jsonb,jsonb), public.vt_ocr_job_status(uuid),
  public.vt_ocr_reset_unknown(uuid,uuid,boolean), public.vt_ocr_accept(uuid,uuid,integer,text,numeric,jsonb,text,jsonb), public.vt_ocr_reject(uuid,uuid,text),
  public.vt_report_mail_reserve(uuid,uuid,integer,text,text,text,text,jsonb,text,text,text,boolean,text), public.vt_report_mail_status(uuid),
  public.vt_report_mail_claim(uuid), public.vt_report_mail_finish(uuid,text,text), public.vt_assign_list(uuid,uuid,uuid,text,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vt_stage3_version(), public.vt_report_snapshot(uuid), public.vt_ocr_create_job(uuid,uuid,jsonb), public.vt_ocr_claim(uuid),
  public.vt_ocr_job_status(uuid), public.vt_ocr_reset_unknown(uuid,uuid,boolean), public.vt_ocr_accept(uuid,uuid,integer,text,numeric,jsonb,text,jsonb),
  public.vt_ocr_reject(uuid,uuid,text), public.vt_report_mail_reserve(uuid,uuid,integer,text,text,text,text,jsonb,text,text,text,boolean,text),
  public.vt_report_mail_status(uuid), public.vt_assign_list(uuid,uuid,uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vt_ocr_record_page_count(uuid,uuid,integer), public.vt_ocr_record_unknown(uuid,uuid,text), public.vt_ocr_record_failure(uuid,uuid,text),
  public.vt_ocr_record_result(uuid,uuid,boolean,jsonb,jsonb), public.vt_report_mail_claim(uuid), public.vt_report_mail_finish(uuid,text,text) TO service_role;
