-- =====================================================================
-- VARETELLING – FASE 1 GRUNNLAG, REVISJON 2 (FORSLAG, IKKE KJØRT MOT LIVE)
-- Status: til uavhengig gjennomgang. Ikke legg i supabase/migrations før godkjent.
-- Erstatter revisjon 1 (aldri kjørt). Additivt: bare nye objekter med prefiks vt_/_vt_.
-- Ingen endring av eksisterende tabeller, funksjoner, data eller grants.
-- Gammel dagstelling (rm_stock_count_*) er uberørt.
--
-- Live-avhengigheter (lest read-only 12.10.2026, ikke endret):
--   has_ravarer_access(uuid,uuid,access_level), has_ravarer_invoice_access(uuid,text),
--   _rm_cost_candidates(uuid,date)  (kanonisk prisvelger, samme som rm_list_price_evidence).
--
-- PRIS (samme bevis i dekning og startgrunnlag, _vt_price_evidence):
--   * Baseenhet må være kg/g/l/ml/stk; ellers ingen pris og ingen baseenhet (aldri «stk» som gjetning).
--   * Startbruker uten fakturalesetilgang får ingen pris (som rm_list_price_evidence).
--   * «Ved start»: nyeste kandidat fra _rm_cost_candidates(id, dagens Oslo-dato) OG raw_materials
--     bundet til nøyaktig den kandidaten (verifisert, samme history_id, samme pris på 4 desimaler).
--     cost_basis_status='verifisert' alene er IKKE bevis.
--   * «Historisk» må velges eksplisitt med dato før i dag: nyeste kandidat med virkningsdato <= datoen.
--     Kandidatvelgerens gyldighetsregler vurderes slik de står i dag; registreringstidspunkt lagres og
--     «registrert etter verdsettelsesdato» merkes. Ingen kandidat => ingen pris (ikke «finnes ikke»).
--   * Fremtidig verdsettelsesdato avvises.
-- Ingen automatisk lagerjustering i denne fasen. Lagerføring (stock_tracking) endres aldri.
--
-- LÅSREKKEFØLGE (alle muterende RPC-er): vt_counts -> vt_count_lists -> vt_count_lines.
--   Maler: vt_templates (id-rekkefølge) -> vt_locations (id-rekkefølge).
--   Start: count FOR UPDATE -> maler FOR SHARE -> steder FOR SHARE. Malredigering: mal FOR UPDATE ->
--   steder FOR SHARE. Stedendring: sted FOR UPDATE alene. Ingen funksjon låser i motsatt rekkefølge.
-- OPERASJONER: hver muterende RPC reserverer op-id transaksjonelt i vt_ops (unik nøkkel; samtidig
--   duplikat venter og leser lagret kvittering). Samme op-id + annet innhold/bruker/type => 23505.
--   Avvisninger ruller tilbake reservasjonen, så samme op-id gir et nytt, definitivt svar.
-- =====================================================================

CREATE OR REPLACE FUNCTION public._vt_finite(p numeric) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p IS NOT NULL AND p <> 'NaN'::numeric AND p <> 'Infinity'::numeric AND p <> '-Infinity'::numeric $$;

-- ---------- Steder ----------
CREATE TABLE public.vt_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL,
  department text NOT NULL CHECK (length(btrim(department)) BETWEEN 1 AND 80),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  sort_order integer NOT NULL DEFAULT 0,
  revision integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, legal_entity_id)
);
CREATE UNIQUE INDEX vt_locations_unique_active
  ON public.vt_locations (legal_entity_id, lower(btrim(department)), lower(btrim(name)))
  WHERE archived_at IS NULL;

-- ---------- Listemaler ----------
CREATE TABLE public.vt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  department text NOT NULL CHECK (length(btrim(department)) BETWEEN 1 AND 80),
  default_location_id uuid,
  revision integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, legal_entity_id),
  FOREIGN KEY (default_location_id, legal_entity_id) REFERENCES public.vt_locations (id, legal_entity_id)
);
CREATE UNIQUE INDEX vt_templates_unique_active
  ON public.vt_templates (legal_entity_id, lower(btrim(name))) WHERE archived_at IS NULL;

CREATE TABLE public.vt_template_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id),
  location_id uuid,
  sort_order integer NOT NULL,
  count_unit_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (template_id, legal_entity_id) REFERENCES public.vt_templates (id, legal_entity_id) ON DELETE CASCADE,
  FOREIGN KEY (location_id, legal_entity_id) REFERENCES public.vt_locations (id, legal_entity_id)
);
CREATE UNIQUE INDEX vt_template_lines_unique
  ON public.vt_template_lines (template_id, raw_material_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX vt_template_lines_material ON public.vt_template_lines (legal_entity_id, raw_material_id);

-- ---------- Tellinger ----------
CREATE TABLE public.vt_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  planned_date date NOT NULL,
  valuation_mode text NOT NULL CHECK (valuation_mode IN ('ved_start','historisk')),
  valuation_date date,   -- 'ved_start': settes ved start; 'historisk': eksplisitt ved opprettelse
  status text NOT NULL DEFAULT 'planlagt'
    CHECK (status IN ('planlagt','pagar','til_kontroll','avsluttet','avbrutt')),
  template_ids uuid[] NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  started_at timestamptz, started_by uuid,
  finished_at timestamptz, finished_by uuid,
  cancelled_at timestamptz, cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, legal_entity_id),
  CONSTRAINT vt_counts_valuation CHECK (
    (valuation_mode = 'historisk' AND valuation_date IS NOT NULL)
    OR (valuation_mode = 'ved_start' AND (status = 'planlagt' OR status = 'avbrutt' OR valuation_date IS NOT NULL)))
);
CREATE INDEX vt_counts_entity ON public.vt_counts (legal_entity_id, planned_date DESC);

CREATE TABLE public.vt_count_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  source_template_id uuid NOT NULL,
  source_template_revision integer NOT NULL,
  name text NOT NULL,
  department text NOT NULL,
  status text NOT NULL DEFAULT 'ikke_startet'
    CHECK (status IN ('ikke_startet','under_telling','til_kontroll','godkjent')),
  revision integer NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_id, source_template_id),
  UNIQUE (id, legal_entity_id),
  FOREIGN KEY (count_id, legal_entity_id) REFERENCES public.vt_counts (id, legal_entity_id)
);

CREATE TABLE public.vt_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL,
  count_list_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  raw_material_id uuid NOT NULL,
  location_id uuid,
  sort_order integer NOT NULL DEFAULT 0,
  -- Uforanderlig startgrunnlag
  snap_name text NOT NULL,
  snap_sku text,
  snap_location_name text,
  snap_base_unit text CHECK (snap_base_unit IS NULL OR snap_base_unit IN ('kg','g','l','ml','stk')),
  snap_units jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{id,label,units_in_base}] fra raw_material_units ved start
  snap_price_per_base numeric CHECK (snap_price_per_base IS NULL OR (public._vt_finite(snap_price_per_base) AND snap_price_per_base > 0)),
  snap_price_source text NOT NULL CHECK (snap_price_source IN ('dokumentert_kostpris','historisk_dokumentert','mangler_pris')),
  snap_price_reason text,                          -- årsakskode når pris mangler
  snap_price_history_id uuid,
  snap_price_effective_date date,
  snap_price_recorded_at timestamptz,
  snap_price_source_kind text,
  snap_price_as_of date NOT NULL,
  snap_price_known_after_valuation boolean NOT NULL DEFAULT false,
  snap_currency text NOT NULL DEFAULT 'NOK' CHECK (snap_currency = 'NOK'),
  snap_price_excl_vat boolean NOT NULL DEFAULT true,
  snap_taken_at timestamptz NOT NULL,
  -- Registrering
  state text NOT NULL DEFAULT 'ikke_talt'
    CHECK (state IN ('ikke_talt','talt','null','ikke_her','ma_kontrolleres')),
  counted_base numeric CHECK (counted_base IS NULL OR (public._vt_finite(counted_base) AND counted_base >= 0)),
  entry jsonb NOT NULL DEFAULT '[]'::jsonb,        -- serverbygd: [{unit_id|null,label,units_in_base,amount}]
  note text CHECK (note IS NULL OR length(note) <= 500),
  revision integer NOT NULL DEFAULT 0,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (count_id, legal_entity_id) REFERENCES public.vt_counts (id, legal_entity_id),
  FOREIGN KEY (count_list_id, legal_entity_id) REFERENCES public.vt_count_lists (id, legal_entity_id),
  CONSTRAINT vt_line_price_source CHECK (
    (snap_price_source = 'mangler_pris' AND snap_price_per_base IS NULL AND snap_price_reason IS NOT NULL)
    OR (snap_price_source <> 'mangler_pris' AND snap_price_per_base IS NOT NULL AND snap_price_history_id IS NOT NULL)),
  CONSTRAINT vt_line_state_qty CHECK (
    (state = 'talt' AND counted_base > 0 AND snap_base_unit IS NOT NULL)
    OR (state = 'null' AND counted_base = 0)
    OR (state IN ('ikke_talt','ikke_her') AND counted_base IS NULL)
    OR (state = 'ma_kontrolleres'))
);
CREATE UNIQUE INDEX vt_count_lines_unique
  ON public.vt_count_lines (count_id, raw_material_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX vt_count_lines_list ON public.vt_count_lines (count_list_id, sort_order);

-- Operasjonskvitteringer for alle muterende RPC-er (ingen klienttilgang).
CREATE TABLE public.vt_ops (
  op_id uuid PRIMARY KEY,
  kind text NOT NULL,
  legal_entity_id uuid NOT NULL,
  created_by uuid NOT NULL,
  request jsonb NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Databasevern (gjelder alle roller, også definer-funksjoner og service) ----------
CREATE OR REPLACE FUNCTION public._vt_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.legal_entity_id <> OLD.legal_entity_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Identitet kan ikke endres' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER vt_locations_identity BEFORE UPDATE ON public.vt_locations
  FOR EACH ROW EXECUTE FUNCTION public._vt_identity_guard();
CREATE TRIGGER vt_templates_identity BEFORE UPDATE ON public.vt_templates
  FOR EACH ROW EXECUTE FUNCTION public._vt_identity_guard();

CREATE OR REPLACE FUNCTION public._vt_line_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Tellelinjer kan ikke slettes' USING ERRCODE = '42501'; END IF;
  IF (NEW.id, NEW.count_id, NEW.count_list_id, NEW.legal_entity_id, NEW.raw_material_id, NEW.location_id, NEW.sort_order,
      NEW.snap_name, NEW.snap_sku, NEW.snap_location_name, NEW.snap_base_unit, NEW.snap_units,
      NEW.snap_price_per_base, NEW.snap_price_source, NEW.snap_price_reason, NEW.snap_price_history_id,
      NEW.snap_price_effective_date, NEW.snap_price_recorded_at, NEW.snap_price_source_kind, NEW.snap_price_as_of,
      NEW.snap_price_known_after_valuation, NEW.snap_currency, NEW.snap_price_excl_vat, NEW.snap_taken_at)
     IS DISTINCT FROM
     (OLD.id, OLD.count_id, OLD.count_list_id, OLD.legal_entity_id, OLD.raw_material_id, OLD.location_id, OLD.sort_order,
      OLD.snap_name, OLD.snap_sku, OLD.snap_location_name, OLD.snap_base_unit, OLD.snap_units,
      OLD.snap_price_per_base, OLD.snap_price_source, OLD.snap_price_reason, OLD.snap_price_history_id,
      OLD.snap_price_effective_date, OLD.snap_price_recorded_at, OLD.snap_price_source_kind, OLD.snap_price_as_of,
      OLD.snap_price_known_after_valuation, OLD.snap_currency, OLD.snap_price_excl_vat, OLD.snap_taken_at) THEN
    RAISE EXCEPTION 'Startgrunnlaget er låst' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM vt_counts WHERE id = OLD.count_id;
  IF v_status NOT IN ('pagar','til_kontroll') THEN
    RAISE EXCEPTION 'Tellingen er ikke åpen for registrering' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM vt_count_lists WHERE id = OLD.count_list_id AND status = 'godkjent') THEN
    RAISE EXCEPTION 'Godkjent liste er låst' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vt_line_guard BEFORE UPDATE OR DELETE ON public.vt_count_lines
  FOR EACH ROW EXECUTE FUNCTION public._vt_line_guard();

CREATE OR REPLACE FUNCTION public._vt_count_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Tellinger kan ikke slettes' USING ERRCODE = '42501'; END IF;
  IF OLD.status IN ('avsluttet','avbrutt') THEN
    RAISE EXCEPTION 'Avsluttet eller avbrutt telling er låst' USING ERRCODE = '42501';
  END IF;
  IF NEW.id <> OLD.id OR NEW.legal_entity_id <> OLD.legal_entity_id OR NEW.created_by <> OLD.created_by
     OR NEW.valuation_mode <> OLD.valuation_mode OR NEW.template_ids <> OLD.template_ids OR NEW.name <> OLD.name
     OR NEW.planned_date <> OLD.planned_date THEN
    RAISE EXCEPTION 'Identitet og omfang kan ikke endres' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'planlagt' AND NEW.valuation_date IS DISTINCT FROM OLD.valuation_date THEN
    RAISE EXCEPTION 'Verdsettelsesdato er låst etter start' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER vt_count_guard BEFORE UPDATE OR DELETE ON public.vt_counts
  FOR EACH ROW EXECUTE FUNCTION public._vt_count_guard();

CREATE OR REPLACE FUNCTION public._vt_list_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Tellelister kan ikke slettes' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM vt_counts c WHERE c.id = OLD.count_id AND c.status NOT IN ('pagar','til_kontroll')) THEN
    RAISE EXCEPTION 'Tellingen er låst' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.count_id, NEW.source_template_id, NEW.source_template_revision, NEW.name, NEW.department, NEW.legal_entity_id, NEW.sort_order)
     IS DISTINCT FROM (OLD.id, OLD.count_id, OLD.source_template_id, OLD.source_template_revision, OLD.name, OLD.department, OLD.legal_entity_id, OLD.sort_order) THEN
    RAISE EXCEPTION 'Tellelistens grunnlag er låst' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vt_list_guard BEFORE UPDATE OR DELETE ON public.vt_count_lists
  FOR EACH ROW EXECUTE FUNCTION public._vt_list_guard();

-- ---------- Grants: nullstill arvede rettigheter, gi eksakt minimum ----------
REVOKE ALL ON public.vt_locations, public.vt_templates, public.vt_template_lines,
  public.vt_counts, public.vt_count_lists, public.vt_count_lines, public.vt_ops FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vt_locations, public.vt_templates, public.vt_template_lines,
  public.vt_counts, public.vt_count_lists, public.vt_count_lines TO authenticated;
-- All skriving fra klient går via RPC-ene nedenfor. vt_ops: ingen klienttilgang.
GRANT ALL ON public.vt_locations, public.vt_templates, public.vt_template_lines,
  public.vt_counts, public.vt_count_lists, public.vt_count_lines, public.vt_ops TO service_role;

ALTER TABLE public.vt_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_template_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_count_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_ops ENABLE ROW LEVEL SECURITY;

CREATE POLICY vt_locations_read ON public.vt_locations FOR SELECT TO authenticated
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY vt_templates_read ON public.vt_templates FOR SELECT TO authenticated
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY vt_template_lines_read ON public.vt_template_lines FOR SELECT TO authenticated
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY vt_counts_read ON public.vt_counts FOR SELECT TO authenticated
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY vt_count_lists_read ON public.vt_count_lists FOR SELECT TO authenticated
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY vt_count_lines_read ON public.vt_count_lines FOR SELECT TO authenticated
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));

-- ---------- Interne hjelpere ----------
CREATE OR REPLACE FUNCTION public._vt_require(p_entity uuid, p_level text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_entity IS NULL OR has_ravarer_access(v_uid, p_entity, p_level::access_level) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Mangler tilgang' USING ERRCODE = '42501';
  END IF;
  RETURN v_uid;
END $$;

/** Reserver op-id. NULL = ny operasjon; ellers lagret kvittering (+replayed). */
CREATE OR REPLACE FUNCTION public._vt_op_begin(p_op uuid, p_kind text, p_entity uuid, p_uid uuid, p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v vt_ops; v_n integer;
BEGIN
  IF p_op IS NULL THEN RAISE EXCEPTION 'Operasjons-ID mangler' USING ERRCODE = '22023'; END IF;
  INSERT INTO vt_ops (op_id, kind, legal_entity_id, created_by, request) VALUES (p_op, p_kind, p_entity, p_uid, p_request)
  ON CONFLICT (op_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 1 THEN RETURN NULL; END IF;
  SELECT * INTO v FROM vt_ops WHERE op_id = p_op;
  IF v.kind <> p_kind OR v.legal_entity_id <> p_entity OR v.created_by <> p_uid OR v.request <> p_request OR v.result IS NULL THEN
    RAISE EXCEPTION 'Operasjons-ID er brukt med annet innhold' USING ERRCODE = '23505';
  END IF;
  RETURN v.result || jsonb_build_object('replayed', true);
END $$;

CREATE OR REPLACE FUNCTION public._vt_op_finish(p_op uuid, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE vt_ops SET result = p_result WHERE op_id = p_op AND result IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operasjonen er ikke reservert' USING ERRCODE = 'XX000'; END IF;
  RETURN p_result || jsonb_build_object('replayed', false);
END $$;

/** Prisbevis for én vare. Brukes av både dekning og start (samme regel). */
CREATE OR REPLACE FUNCTION public._vt_price_evidence(p_rm_id uuid, p_entity uuid, p_mode text, p_as_of date, p_invoice_access boolean)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r raw_materials; c record; v_reason text;
BEGIN
  SELECT * INTO r FROM raw_materials WHERE id = p_rm_id AND legal_entity_id = p_entity;
  IF NOT FOUND THEN v_reason := 'vare_ukjent';
  ELSIF r.base_unit IS NULL OR r.base_unit NOT IN ('kg','g','l','ml','stk') THEN v_reason := 'enhet_ukjent';
  ELSIF NOT p_invoice_access THEN v_reason := 'fakturatilgang_mangler';
  END IF;
  IF v_reason IS NULL THEN
    SELECT * INTO c FROM _rm_cost_candidates(p_rm_id, p_as_of) ORDER BY effective_date DESC, created_at DESC, history_id DESC LIMIT 1;
    IF c.history_id IS NULL THEN v_reason := 'ingen_dokumentert_pris';
    ELSIF NOT _vt_finite(c.price) OR c.price <= 0 THEN v_reason := 'pris_ugyldig';
    ELSIF p_mode = 'ved_start' AND (r.cost_basis_status IS DISTINCT FROM 'verifisert'
          OR r.cost_source_history_id IS DISTINCT FROM c.history_id
          OR NOT _vt_finite(r.current_cost_price) OR round(r.current_cost_price, 4) IS DISTINCT FROM round(c.price, 4)) THEN
      v_reason := 'kostpris_ikke_bekreftet';
    END IF;
  END IF;
  IF v_reason IS NOT NULL THEN
    RETURN jsonb_build_object('price', NULL, 'source', 'mangler_pris', 'reason', v_reason, 'as_of', p_as_of);
  END IF;
  RETURN jsonb_build_object('price', c.price,
    'source', CASE WHEN p_mode = 'historisk' THEN 'historisk_dokumentert' ELSE 'dokumentert_kostpris' END,
    'reason', NULL, 'history_id', c.history_id, 'effective_date', c.effective_date, 'recorded_at', c.created_at,
    'source_kind', c.source, 'as_of', p_as_of,
    'known_after', (c.created_at AT TIME ZONE 'Europe/Oslo')::date > p_as_of);
END $$;

-- Validerer en malrad-liste [{raw_material_id, location_id, count_unit_ids}] for firmaet.
CREATE OR REPLACE FUNCTION public._vt_validate_template_lines(p_entity uuid, p_template_id uuid, p_lines jsonb) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e jsonb; v_mid uuid; v_lid uuid; v_units uuid[]; v_seen text[] := '{}'; v_key text;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) > 2000 THEN
    RAISE EXCEPTION 'Ugyldig vareliste (maks 2000 linjer)' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_lines) x LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR jsonb_typeof(e->'raw_material_id') IS DISTINCT FROM 'string'
       OR coalesce(jsonb_typeof(e->'location_id'), 'null') NOT IN ('string','null')
       OR jsonb_typeof(coalesce(e->'count_unit_ids', '[]'::jsonb)) IS DISTINCT FROM 'array'
       OR jsonb_array_length(coalesce(e->'count_unit_ids', '[]'::jsonb)) > 10 THEN
      RAISE EXCEPTION 'Ugyldig linje i varelisten' USING ERRCODE = '22023';
    END IF;
    v_mid := (e->>'raw_material_id')::uuid;
    v_lid := nullif(e->>'location_id', '')::uuid;
    v_units := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(coalesce(e->'count_unit_ids', '[]'::jsonb)) x);
    v_key := v_mid::text || '|' || coalesce(v_lid::text, '');
    IF v_key = ANY(v_seen) THEN
      RAISE EXCEPTION 'Samme vare og sted finnes to ganger i listen' USING ERRCODE = '23505';
    END IF;
    v_seen := v_seen || v_key;
    -- Varen må tilhøre firmaet. Nye linjer krever aktiv vare; eksisterende linje for inaktiv vare kan beholdes.
    IF NOT EXISTS (SELECT 1 FROM raw_materials r WHERE r.id = v_mid AND r.legal_entity_id = p_entity
                    AND (coalesce(r.is_active, true)
                         OR EXISTS (SELECT 1 FROM vt_template_lines tl WHERE tl.template_id = p_template_id AND tl.raw_material_id = v_mid))) THEN
      RAISE EXCEPTION 'Varen tilhører ikke firmaet eller er inaktiv' USING ERRCODE = '22023';
    END IF;
    IF v_lid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vt_locations l WHERE l.id = v_lid AND l.legal_entity_id = p_entity AND l.archived_at IS NULL) THEN
      RAISE EXCEPTION 'Stedet finnes ikke i firmaet eller er arkivert' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(DISTINCT x) FROM unnest(v_units) x) <> cardinality(v_units)
       OR EXISTS (SELECT 1 FROM unnest(v_units) x WHERE NOT EXISTS (
            SELECT 1 FROM raw_material_units u WHERE u.id = x AND u.raw_material_id = v_mid AND _vt_finite(u.units_in_base) AND u.units_in_base > 0)) THEN
      RAISE EXCEPTION 'Telleenhet tilhører ikke varen' USING ERRCODE = '22023';
    END IF;
  END LOOP;
END $$;

-- ---------- RPC: versjon (sonde) ----------
CREATE OR REPLACE FUNCTION public.vt_backend_version() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object('system', 'varetelling', 'version', 2) $$;

-- ---------- RPC: sted ----------
CREATE OR REPLACE FUNCTION public.vt_save_location(
  p_op_id uuid, p_legal_entity_id uuid, p_location_id uuid, p_expected_revision integer,
  p_department text, p_name text, p_sort_order integer, p_archived boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_prev jsonb; v_l vt_locations;
  v_req jsonb := jsonb_build_object('location_id', p_location_id, 'expected_revision', p_expected_revision,
    'department', btrim(coalesce(p_department, '')), 'name', btrim(coalesce(p_name, '')), 'sort_order', p_sort_order, 'archived', p_archived);
BEGIN
  v_uid := _vt_require(p_legal_entity_id, 'write');
  v_prev := _vt_op_begin(p_op_id, 'location', p_legal_entity_id, v_uid, v_req);
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  IF p_sort_order IS NULL OR p_archived IS NULL THEN RAISE EXCEPTION 'Ugyldige verdier' USING ERRCODE = '22023'; END IF;
  IF p_location_id IS NULL THEN
    IF p_expected_revision IS NOT NULL OR p_archived THEN RAISE EXCEPTION 'Ugyldige verdier' USING ERRCODE = '22023'; END IF;
    INSERT INTO vt_locations (legal_entity_id, department, name, sort_order, created_by)
    VALUES (p_legal_entity_id, btrim(p_department), btrim(p_name), p_sort_order, v_uid) RETURNING * INTO v_l;
  ELSE
    IF p_expected_revision IS NULL THEN RAISE EXCEPTION 'Revisjon mangler' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_l FROM vt_locations WHERE id = p_location_id AND legal_entity_id = p_legal_entity_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Stedet finnes ikke' USING ERRCODE = '22023'; END IF;
    IF v_l.revision <> p_expected_revision THEN RAISE EXCEPTION 'Stedet er endret av andre' USING ERRCODE = '40001'; END IF;
    IF v_l.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Arkivert sted kan ikke endres' USING ERRCODE = '55000'; END IF;
    UPDATE vt_locations SET department = btrim(p_department), name = btrim(p_name), sort_order = p_sort_order,
           archived_at = CASE WHEN p_archived THEN now() ELSE NULL END, revision = revision + 1
     WHERE id = p_location_id RETURNING * INTO v_l;
  END IF;
  RETURN _vt_op_finish(p_op_id, jsonb_build_object('ok', true, 'kind', 'location',
    'location', jsonb_build_object('id', v_l.id, 'department', v_l.department, 'name', v_l.name, 'sort_order', v_l.sort_order,
      'revision', v_l.revision, 'archived_at', v_l.archived_at)));
END $$;

-- ---------- RPC: listemal (hode + valgfritt full erstatning av linjer i rekkefølge) ----------
CREATE OR REPLACE FUNCTION public.vt_save_template(
  p_op_id uuid, p_legal_entity_id uuid, p_template_id uuid, p_expected_revision integer,
  p_name text, p_department text, p_default_location_id uuid, p_archived boolean, p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_prev jsonb; v_t vt_templates; v_n integer;
  v_req jsonb := jsonb_build_object('template_id', p_template_id, 'expected_revision', p_expected_revision,
    'name', btrim(coalesce(p_name, '')), 'department', btrim(coalesce(p_department, '')),
    'default_location_id', p_default_location_id, 'archived', p_archived, 'lines', p_lines);
BEGIN
  v_uid := _vt_require(p_legal_entity_id, 'write');
  v_prev := _vt_op_begin(p_op_id, 'template', p_legal_entity_id, v_uid, v_req);
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  IF p_archived IS NULL THEN RAISE EXCEPTION 'Ugyldige verdier' USING ERRCODE = '22023'; END IF;
  IF p_template_id IS NULL THEN
    IF p_expected_revision IS NOT NULL OR p_archived THEN RAISE EXCEPTION 'Ugyldige verdier' USING ERRCODE = '22023'; END IF;
  ELSE
    IF p_expected_revision IS NULL THEN RAISE EXCEPTION 'Revisjon mangler' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_t FROM vt_templates WHERE id = p_template_id AND legal_entity_id = p_legal_entity_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Listemalen finnes ikke' USING ERRCODE = '22023'; END IF;
    IF v_t.revision <> p_expected_revision THEN RAISE EXCEPTION 'Listemalen er endret av andre' USING ERRCODE = '40001'; END IF;
    IF v_t.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Arkivert listemal kan ikke endres' USING ERRCODE = '55000'; END IF;
  END IF;
  -- Steder låses i id-rekkefølge etter malen (samme rekkefølge som start).
  PERFORM 1 FROM vt_locations WHERE legal_entity_id = p_legal_entity_id AND (id = p_default_location_id OR id IN (
    SELECT nullif(x->>'location_id', '')::uuid FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_lines) = 'array' THEN p_lines ELSE '[]'::jsonb END) x))
    ORDER BY id FOR SHARE;
  IF p_default_location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vt_locations WHERE id = p_default_location_id
       AND legal_entity_id = p_legal_entity_id AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'Stedet finnes ikke i firmaet eller er arkivert' USING ERRCODE = '22023';
  END IF;
  IF p_lines IS NOT NULL THEN PERFORM _vt_validate_template_lines(p_legal_entity_id, p_template_id, p_lines); END IF;
  IF p_template_id IS NULL THEN
    INSERT INTO vt_templates (legal_entity_id, name, department, default_location_id, created_by)
    VALUES (p_legal_entity_id, btrim(p_name), btrim(p_department), p_default_location_id, v_uid) RETURNING * INTO v_t;
  ELSE
    UPDATE vt_templates SET name = btrim(p_name), department = btrim(p_department), default_location_id = p_default_location_id,
           archived_at = CASE WHEN p_archived THEN now() ELSE NULL END, revision = revision + 1
     WHERE id = p_template_id RETURNING * INTO v_t;
  END IF;
  IF p_lines IS NOT NULL THEN
    DELETE FROM vt_template_lines WHERE template_id = v_t.id;
    INSERT INTO vt_template_lines (template_id, legal_entity_id, raw_material_id, location_id, sort_order, count_unit_ids)
    SELECT v_t.id, p_legal_entity_id, (x->>'raw_material_id')::uuid, nullif(x->>'location_id', '')::uuid, o::integer,
           ARRAY(SELECT y::uuid FROM jsonb_array_elements_text(coalesce(x->'count_unit_ids', '[]'::jsonb)) y)
      FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(x, o);
  END IF;
  SELECT count(*) INTO v_n FROM vt_template_lines WHERE template_id = v_t.id;
  RETURN _vt_op_finish(p_op_id, jsonb_build_object('ok', true, 'kind', 'template', 'line_count', v_n,
    'template', jsonb_build_object('id', v_t.id, 'name', v_t.name, 'department', v_t.department,
      'default_location_id', v_t.default_location_id, 'revision', v_t.revision, 'archived_at', v_t.archived_at, 'updated_at', v_t.updated_at)));
END $$;

-- ---------- RPC: kopier listemal (struktur, aldri mengder/priser) ----------
CREATE OR REPLACE FUNCTION public.vt_copy_template(p_op_id uuid, p_legal_entity_id uuid, p_source_id uuid, p_expected_revision integer, p_name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_prev jsonb; v_s vt_templates; v_t vt_templates; v_n integer;
  v_req jsonb := jsonb_build_object('source_id', p_source_id, 'expected_revision', p_expected_revision, 'name', btrim(coalesce(p_name, '')));
BEGIN
  v_uid := _vt_require(p_legal_entity_id, 'write');
  v_prev := _vt_op_begin(p_op_id, 'copy_template', p_legal_entity_id, v_uid, v_req);
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  IF p_expected_revision IS NULL THEN RAISE EXCEPTION 'Revisjon mangler' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_s FROM vt_templates WHERE id = p_source_id AND legal_entity_id = p_legal_entity_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Listemalen finnes ikke' USING ERRCODE = '22023'; END IF;
  IF v_s.revision <> p_expected_revision THEN RAISE EXCEPTION 'Listemalen er endret av andre' USING ERRCODE = '40001'; END IF;
  INSERT INTO vt_templates (legal_entity_id, name, department, default_location_id, created_by)
  VALUES (p_legal_entity_id, btrim(p_name), v_s.department,
          (SELECT id FROM vt_locations WHERE id = v_s.default_location_id AND archived_at IS NULL), v_uid) RETURNING * INTO v_t;
  INSERT INTO vt_template_lines (template_id, legal_entity_id, raw_material_id, location_id, sort_order, count_unit_ids)
  SELECT v_t.id, p_legal_entity_id, raw_material_id, location_id, sort_order, count_unit_ids
    FROM vt_template_lines WHERE template_id = v_s.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN _vt_op_finish(p_op_id, jsonb_build_object('ok', true, 'kind', 'template', 'line_count', v_n,
    'template', jsonb_build_object('id', v_t.id, 'name', v_t.name, 'department', v_t.department,
      'default_location_id', v_t.default_location_id, 'revision', v_t.revision, 'archived_at', v_t.archived_at, 'updated_at', v_t.updated_at)));
END $$;

-- ---------- RPC: opprett planlagt telling ----------
CREATE OR REPLACE FUNCTION public.vt_create_count(
  p_op_id uuid, p_legal_entity_id uuid, p_name text, p_planned_date date,
  p_valuation_mode text, p_valuation_date date, p_template_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_prev jsonb; v_row vt_counts; v_ids uuid[]; v_req jsonb;
BEGIN
  v_uid := _vt_require(p_legal_entity_id, 'write');
  IF p_template_ids IS NULL OR array_ndims(p_template_ids) > 1 OR cardinality(p_template_ids) = 0 OR cardinality(p_template_ids) > 50
     OR EXISTS (SELECT 1 FROM unnest(p_template_ids) x WHERE x IS NULL)
     OR (SELECT count(DISTINCT x) FROM unnest(p_template_ids) x) <> cardinality(p_template_ids) THEN
    RAISE EXCEPTION 'Velg 1–50 ulike listemaler' USING ERRCODE = '22023';
  END IF;
  v_ids := ARRAY(SELECT x FROM unnest(p_template_ids) x ORDER BY x);
  v_req := jsonb_build_object('name', btrim(coalesce(p_name, '')), 'planned_date', p_planned_date, 'valuation_mode', p_valuation_mode,
    'valuation_date', p_valuation_date, 'template_ids', to_jsonb(v_ids));
  v_prev := _vt_op_begin(p_op_id, 'create_count', p_legal_entity_id, v_uid, v_req);
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  IF p_planned_date IS NULL THEN RAISE EXCEPTION 'Telledato mangler' USING ERRCODE = '22023'; END IF;
  IF p_valuation_mode = 'ved_start' THEN
    IF p_valuation_date IS NOT NULL THEN RAISE EXCEPTION 'Verdsettelsesdato settes ved start' USING ERRCODE = '22023'; END IF;
  ELSIF p_valuation_mode = 'historisk' THEN
    IF p_valuation_date IS NULL OR p_valuation_date >= (now() AT TIME ZONE 'Europe/Oslo')::date THEN
      RAISE EXCEPTION 'Historisk verdsettelse krever en dato før i dag' USING ERRCODE = '22023';
    END IF;
  ELSE RAISE EXCEPTION 'Ugyldig verdsettelse' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM vt_templates t WHERE t.id = ANY(v_ids) AND t.legal_entity_id = p_legal_entity_id AND t.archived_at IS NULL)
     <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Ukjent eller arkivert listemal' USING ERRCODE = '22023';
  END IF;
  INSERT INTO vt_counts (legal_entity_id, name, planned_date, valuation_mode, valuation_date, template_ids, created_by)
  VALUES (p_legal_entity_id, btrim(p_name), p_planned_date, p_valuation_mode, p_valuation_date, v_ids, v_uid)
  RETURNING * INTO v_row;
  RETURN _vt_op_finish(p_op_id, jsonb_build_object('ok', true, 'kind', 'create_count', 'count_id', v_row.id,
    'status', v_row.status, 'revision', v_row.revision, 'template_ids', to_jsonb(v_row.template_ids)));
END $$;

-- ---------- RPC: dekningskontroll før start (lesing, samme prisbevis som start) ----------
CREATE OR REPLACE FUNCTION public.vt_check_coverage(p_legal_entity_id uuid, p_template_ids uuid[], p_valuation_mode text, p_valuation_date date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_today date := (now() AT TIME ZONE 'Europe/Oslo')::date; v_asof date; v_inv boolean; v_ev jsonb;
BEGIN
  v_uid := _vt_require(p_legal_entity_id, 'read');
  IF p_template_ids IS NULL OR cardinality(p_template_ids) > 50 THEN RAISE EXCEPTION 'Ugyldig utvalg' USING ERRCODE = '22023'; END IF;
  IF p_valuation_mode = 'ved_start' THEN v_asof := v_today;
  ELSIF p_valuation_mode = 'historisk' AND p_valuation_date IS NOT NULL AND p_valuation_date < v_today THEN v_asof := p_valuation_date;
  ELSE RAISE EXCEPTION 'Ugyldig verdsettelse' USING ERRCODE = '22023';
  END IF;
  v_inv := has_ravarer_invoice_access(p_legal_entity_id, 'read') IS NOT DISTINCT FROM true;
  WITH sel AS (
    SELECT tl.* FROM vt_template_lines tl JOIN vt_templates t ON t.id = tl.template_id
     WHERE tl.legal_entity_id = p_legal_entity_id AND t.archived_at IS NULL AND tl.template_id = ANY(p_template_ids)
  ), mats AS (
    SELECT DISTINCT raw_material_id FROM sel
  ), ev AS (
    SELECT m.raw_material_id, _vt_price_evidence(m.raw_material_id, p_legal_entity_id, p_valuation_mode, v_asof, v_inv) e FROM mats m
  )
  SELECT jsonb_build_object(
    'as_of', v_asof, 'valuation_mode', p_valuation_mode, 'invoice_access', v_inv,
    'duplicates', coalesce((SELECT jsonb_agg(jsonb_build_object('raw_material_id', d.raw_material_id, 'location_id', d.location_id, 'template_ids', d.tids))
        FROM (SELECT raw_material_id, location_id, to_jsonb(array_agg(DISTINCT template_id ORDER BY template_id)) tids FROM sel
               GROUP BY raw_material_id, location_id HAVING count(*) > 1) d), '[]'::jsonb),
    'line_count', (SELECT count(*) FROM sel),
    'material_count', (SELECT count(*) FROM mats),
    'missing_location', (SELECT count(*) FROM sel WHERE location_id IS NULL),
    'archived_location', (SELECT count(*) FROM sel s JOIN vt_locations l ON l.id = s.location_id WHERE l.archived_at IS NOT NULL),
    'empty_templates', (SELECT count(*) FROM unnest(p_template_ids) x WHERE NOT EXISTS (SELECT 1 FROM sel WHERE template_id = x)),
    'priced', (SELECT count(*) FROM ev WHERE e->>'source' <> 'mangler_pris'),
    'missing_price', (SELECT count(*) FROM ev WHERE e->>'source' = 'mangler_pris'),
    'missing_price_by_reason', coalesce((SELECT jsonb_object_agg(reason, n) FROM (SELECT e->>'reason' reason, count(*) n FROM ev
        WHERE e->>'source' = 'mangler_pris' GROUP BY 1) z), '{}'::jsonb),
    'missing_unit', (SELECT count(*) FROM ev WHERE e->>'reason' = 'enhet_ukjent'),
    'known_after_valuation', (SELECT count(*) FROM ev WHERE (e->>'known_after')::boolean)
  ) INTO v_ev;
  RETURN v_ev;
END $$;

-- ---------- RPC: start telling (atomisk kopi + frosset grunnlag) ----------
CREATE OR REPLACE FUNCTION public.vt_start_count(p_op_id uuid, p_count_id uuid, p_expected_revision integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid; v_prev jsonb; v_entity uuid; v_c vt_counts; v_now timestamptz := now();
  v_today date := (now() AT TIME ZONE 'Europe/Oslo')::date; v_asof date; v_inv boolean; v_lines integer; v_lists integer; v_priced integer;
BEGIN
  SELECT legal_entity_id INTO v_entity FROM vt_counts WHERE id = p_count_id;
  v_uid := _vt_require(v_entity, 'write');
  v_prev := _vt_op_begin(p_op_id, 'start_count', v_entity, v_uid,
    jsonb_build_object('count_id', p_count_id, 'expected_revision', p_expected_revision));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  IF p_expected_revision IS NULL THEN RAISE EXCEPTION 'Revisjon mangler' USING ERRCODE = '22023'; END IF;
  -- 1) telling, 2) maler (id-rekkefølge), 3) steder (id-rekkefølge) — FØR all validering og kopiering.
  SELECT * INTO v_c FROM vt_counts WHERE id = p_count_id FOR UPDATE;
  IF v_c.status <> 'planlagt' THEN RAISE EXCEPTION 'Tellingen er allerede startet eller lukket' USING ERRCODE = '55000'; END IF;
  IF v_c.revision <> p_expected_revision THEN RAISE EXCEPTION 'Tellingen er endret av andre' USING ERRCODE = '40001'; END IF;
  PERFORM 1 FROM vt_templates t WHERE t.id = ANY(v_c.template_ids) ORDER BY t.id FOR SHARE;
  PERFORM 1 FROM vt_locations l WHERE l.id IN (SELECT tl.location_id FROM vt_template_lines tl WHERE tl.template_id = ANY(v_c.template_ids))
    ORDER BY l.id FOR SHARE;
  IF (SELECT count(*) FROM vt_templates t WHERE t.id = ANY(v_c.template_ids) AND t.archived_at IS NULL AND t.legal_entity_id = v_c.legal_entity_id)
     <> cardinality(v_c.template_ids) THEN
    RAISE EXCEPTION 'En valgt listemal er arkivert eller finnes ikke' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_c.template_ids) x WHERE NOT EXISTS (SELECT 1 FROM vt_template_lines tl WHERE tl.template_id = x)) THEN
    RAISE EXCEPTION 'En valgt listemal har ingen varer' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM vt_template_lines tl JOIN vt_locations l ON l.id = tl.location_id
              WHERE tl.template_id = ANY(v_c.template_ids) AND l.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'En valgt liste bruker et arkivert sted' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM vt_template_lines tl WHERE tl.template_id = ANY(v_c.template_ids)
              GROUP BY tl.raw_material_id, coalesce(tl.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
              HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Samme vare på samme sted finnes i flere valgte lister — avklar før start' USING ERRCODE = '23505';
  END IF;
  IF v_c.valuation_mode = 'ved_start' THEN v_asof := v_today;
  ELSE
    IF v_c.valuation_date >= v_today THEN RAISE EXCEPTION 'Historisk verdsettelsesdato må være før i dag' USING ERRCODE = '22023'; END IF;
    v_asof := v_c.valuation_date;
  END IF;
  v_inv := has_ravarer_invoice_access(v_c.legal_entity_id, 'read') IS NOT DISTINCT FROM true;

  INSERT INTO vt_count_lists (count_id, legal_entity_id, source_template_id, source_template_revision, name, department, sort_order)
  SELECT v_c.id, v_c.legal_entity_id, t.id, t.revision, t.name, t.department,
         row_number() OVER (ORDER BY t.department, t.name, t.id)
    FROM vt_templates t WHERE t.id = ANY(v_c.template_ids);
  GET DIAGNOSTICS v_lists = ROW_COUNT;

  INSERT INTO vt_count_lines (count_id, count_list_id, legal_entity_id, raw_material_id, location_id, sort_order,
    snap_name, snap_sku, snap_location_name, snap_base_unit, snap_units,
    snap_price_per_base, snap_price_source, snap_price_reason, snap_price_history_id, snap_price_effective_date,
    snap_price_recorded_at, snap_price_source_kind, snap_price_as_of, snap_price_known_after_valuation, snap_taken_at)
  SELECT v_c.id, cl.id, v_c.legal_entity_id, r.id, tl.location_id, tl.sort_order,
         r.name, r.sku, CASE WHEN l.id IS NULL THEN NULL ELSE l.department || ' / ' || l.name END,
         CASE WHEN r.base_unit IN ('kg','g','l','ml','stk') THEN r.base_unit END,
         CASE WHEN r.base_unit IN ('kg','g','l','ml','stk') THEN
           coalesce((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'label', u.unit_label, 'units_in_base', u.units_in_base) ORDER BY u.sort_order, u.id)
                       FROM raw_material_units u
                      WHERE u.raw_material_id = r.id AND _vt_finite(u.units_in_base) AND u.units_in_base > 0
                        AND (cardinality(tl.count_unit_ids) = 0 OR u.id = ANY(tl.count_unit_ids))), '[]'::jsonb)
           ELSE '[]'::jsonb END,
         (ev.e->>'price')::numeric, ev.e->>'source', ev.e->>'reason', (ev.e->>'history_id')::uuid,
         (ev.e->>'effective_date')::date, (ev.e->>'recorded_at')::timestamptz, ev.e->>'source_kind', v_asof,
         coalesce((ev.e->>'known_after')::boolean, false), v_now
    FROM vt_template_lines tl
    JOIN vt_count_lists cl ON cl.count_id = v_c.id AND cl.source_template_id = tl.template_id
    JOIN raw_materials r ON r.id = tl.raw_material_id AND r.legal_entity_id = v_c.legal_entity_id
    LEFT JOIN vt_locations l ON l.id = tl.location_id
    CROSS JOIN LATERAL (SELECT _vt_price_evidence(r.id, v_c.legal_entity_id, v_c.valuation_mode, v_asof, v_inv) e) ev;
  GET DIAGNOSTICS v_lines = ROW_COUNT;
  IF v_lines <> (SELECT count(*) FROM vt_template_lines WHERE template_id = ANY(v_c.template_ids)) THEN
    RAISE EXCEPTION 'Malene inneholder varer utenfor firmaet' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_priced FROM vt_count_lines WHERE count_id = v_c.id AND snap_price_per_base IS NOT NULL;

  UPDATE vt_counts SET status = 'pagar', valuation_date = v_asof, started_at = v_now, started_by = v_uid,
         revision = revision + 1 WHERE id = v_c.id RETURNING * INTO v_c;
  RETURN _vt_op_finish(p_op_id, jsonb_build_object('ok', true, 'kind', 'start_count', 'count_id', v_c.id, 'status', v_c.status,
    'revision', v_c.revision, 'list_count', v_lists, 'line_count', v_lines, 'priced_count', v_priced,
    'valuation_mode', v_c.valuation_mode, 'valuation_date', v_c.valuation_date));
END $$;

-- ---------- RPC: lagre én linje (CAS + op-id; serveren beregner mengden) ----------
CREATE OR REPLACE FUNCTION public.vt_save_line(
  p_op_id uuid, p_line_id uuid, p_expected_revision integer, p_state text,
  p_counted_base numeric, p_entry jsonb, p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid; v_prev jsonb; v_entity uuid; v_count uuid; v_list uuid; v_cstatus text; v_lstatus text; v_l vt_count_lines;
  e jsonb; v_unit jsonb; v_amount numeric; v_total numeric := 0; v_entry jsonb := '[]'::jsonb; v_seen text[] := '{}';
  v_key text; v_counted numeric; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_res jsonb; v_req jsonb;
BEGIN
  SELECT legal_entity_id, count_id, count_list_id INTO v_entity, v_count, v_list FROM vt_count_lines WHERE id = p_line_id;
  v_uid := _vt_require(v_entity, 'write');
  IF p_entry IS NULL OR jsonb_typeof(p_entry) <> 'array' OR jsonb_array_length(p_entry) > 11 THEN
    RAISE EXCEPTION 'Ugyldig registrering' USING ERRCODE = '22023';
  END IF;
  v_req := jsonb_build_object('line_id', p_line_id, 'expected_revision', p_expected_revision, 'state', p_state,
    'counted_base', p_counted_base::text, 'entry', p_entry, 'note', v_note);
  v_prev := _vt_op_begin(p_op_id, 'save_line', v_entity, v_uid, v_req);
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  IF p_expected_revision IS NULL OR p_state IS NULL THEN RAISE EXCEPTION 'Revisjon eller tilstand mangler' USING ERRCODE = '22023'; END IF;
  IF p_state NOT IN ('ikke_talt','talt','null','ikke_her','ma_kontrolleres') THEN RAISE EXCEPTION 'Ugyldig tilstand' USING ERRCODE = '22023'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN RAISE EXCEPTION 'Kommentaren er for lang' USING ERRCODE = '22023'; END IF;
  -- Låsrekkefølge: telling (delt) -> liste (eksklusiv, serialiserer statusoppdatering) -> linje.
  SELECT status INTO v_cstatus FROM vt_counts WHERE id = v_count FOR SHARE;
  SELECT status INTO v_lstatus FROM vt_count_lists WHERE id = v_list FOR UPDATE;
  SELECT * INTO v_l FROM vt_count_lines WHERE id = p_line_id FOR UPDATE;
  IF v_cstatus NOT IN ('pagar','til_kontroll') OR v_lstatus = 'godkjent' THEN
    RAISE EXCEPTION 'Listen er ikke åpen for registrering' USING ERRCODE = '55000';
  END IF;
  -- Registrering valideres mot frosne enheter; klientens faktorer/etiketter brukes aldri.
  FOR e IN SELECT x FROM jsonb_array_elements(p_entry) x LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR jsonb_typeof(e->'amount') IS DISTINCT FROM 'number'
       OR (e ? 'unit_id') IS NOT TRUE OR coalesce(jsonb_typeof(e->'unit_id'), 'x') NOT IN ('string','null') THEN
      RAISE EXCEPTION 'Ugyldig registreringsdel' USING ERRCODE = '22023';
    END IF;
    v_amount := (e->>'amount')::numeric;
    IF NOT _vt_finite(v_amount) OR v_amount < 0 OR v_amount > 1000000000 THEN
      RAISE EXCEPTION 'Ugyldig mengde' USING ERRCODE = '22023';
    END IF;
    v_key := coalesce(e->>'unit_id', 'base');
    IF v_key = ANY(v_seen) THEN RAISE EXCEPTION 'Samme enhet to ganger' USING ERRCODE = '22023'; END IF;
    v_seen := v_seen || v_key;
    IF v_l.snap_base_unit IS NULL THEN RAISE EXCEPTION 'Varen mangler gyldig baseenhet — merk «Må kontrolleres» eller 0' USING ERRCODE = '22023'; END IF;
    IF e->>'unit_id' IS NULL THEN
      v_unit := jsonb_build_object('id', NULL, 'label', v_l.snap_base_unit, 'units_in_base', 1);
    ELSE
      SELECT u INTO v_unit FROM jsonb_array_elements(v_l.snap_units) u WHERE u->>'id' = e->>'unit_id';
      IF v_unit IS NULL THEN RAISE EXCEPTION 'Ukjent telleenhet' USING ERRCODE = '22023'; END IF;
    END IF;
    v_total := v_total + v_amount * (v_unit->>'units_in_base')::numeric;
    v_entry := v_entry || jsonb_build_array(jsonb_build_object('unit_id', v_unit->'id', 'label', v_unit->>'label',
      'units_in_base', (v_unit->>'units_in_base')::numeric, 'amount', v_amount));
  END LOOP;
  IF p_counted_base IS NOT NULL AND NOT _vt_finite(p_counted_base) THEN RAISE EXCEPTION 'Ugyldig mengde' USING ERRCODE = '22023'; END IF;
  IF p_state = 'talt' THEN
    IF jsonb_array_length(v_entry) = 0 THEN RAISE EXCEPTION 'Talt krever mengde' USING ERRCODE = '22023'; END IF;
    IF v_total <= 0 THEN RAISE EXCEPTION 'Mengde 0: bruk «0 på lager»' USING ERRCODE = '22023'; END IF;
  ELSIF p_state IN ('null','ikke_talt','ikke_her') THEN
    IF jsonb_array_length(v_entry) > 0 THEN RAISE EXCEPTION 'Tilstanden tar ikke mengde' USING ERRCODE = '22023'; END IF;
  END IF;
  v_counted := CASE WHEN p_state = 'null' THEN 0
                    WHEN p_state IN ('ikke_talt','ikke_her') THEN NULL
                    WHEN jsonb_array_length(v_entry) = 0 THEN NULL
                    ELSE v_total END;
  IF (p_state = 'null' AND p_counted_base IS NOT NULL AND p_counted_base <> 0)
     OR (p_state <> 'null' AND v_counted IS NULL AND p_counted_base IS NOT NULL)
     OR (v_counted IS NOT NULL AND p_state <> 'null' AND (p_counted_base IS NULL
         OR abs(p_counted_base - v_counted) > 0.000001 * greatest(1, v_counted))) THEN
    RAISE EXCEPTION 'Oppgitt sum stemmer ikke med registreringen' USING ERRCODE = '22023';
  END IF;
  IF v_l.revision <> p_expected_revision THEN
    v_res := jsonb_build_object('ok', false, 'kind', 'save_line', 'conflict', true, 'line', to_jsonb(v_l) - 'legal_entity_id');
    RETURN _vt_op_finish(p_op_id, v_res);
  END IF;
  UPDATE vt_count_lines SET state = p_state, counted_base = v_counted, entry = v_entry, note = v_note,
         revision = revision + 1, updated_by = v_uid, updated_at = now()
   WHERE id = p_line_id RETURNING * INTO v_l;
  UPDATE vt_count_lists SET status = 'under_telling', revision = revision + 1 WHERE id = v_list AND status = 'ikke_startet';
  v_res := jsonb_build_object('ok', true, 'kind', 'save_line', 'conflict', false, 'line', to_jsonb(v_l) - 'legal_entity_id');
  RETURN _vt_op_finish(p_op_id, v_res);
END $$;

-- ---------- RPC: listestatus ----------
CREATE OR REPLACE FUNCTION public.vt_set_list_status(p_op_id uuid, p_list_id uuid, p_expected_revision integer, p_status text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_prev jsonb; v_entity uuid; v_count uuid; v_cstatus text; v_cl vt_count_lists; v_need text;
BEGIN
  SELECT legal_entity_id, count_id INTO v_entity, v_count FROM vt_count_lists WHERE id = p_list_id;
  v_need := CASE WHEN p_status = 'godkjent' THEN 'approve' ELSE 'write' END;
  v_uid := _vt_require(v_entity, v_need);
  v_prev := _vt_op_begin(p_op_id, 'list_status', v_entity, v_uid,
    jsonb_build_object('list_id', p_list_id, 'expected_revision', p_expected_revision, 'status', p_status));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  IF p_expected_revision IS NULL OR p_status IS NULL THEN RAISE EXCEPTION 'Revisjon eller status mangler' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_cstatus FROM vt_counts WHERE id = v_count FOR SHARE;
  SELECT * INTO v_cl FROM vt_count_lists WHERE id = p_list_id FOR UPDATE;
  IF v_cstatus NOT IN ('pagar','til_kontroll') THEN RAISE EXCEPTION 'Tellingen er ikke åpen' USING ERRCODE = '55000'; END IF;
  IF v_cl.revision <> p_expected_revision THEN RAISE EXCEPTION 'Listen er endret av andre' USING ERRCODE = '40001'; END IF;
  -- Gjenåpning av godkjent liste krever godkjenningsrett.
  IF v_cl.status = 'godkjent' AND NOT has_ravarer_access(v_uid, v_entity, 'approve') THEN
    RAISE EXCEPTION 'Mangler tilgang' USING ERRCODE = '42501';
  END IF;
  IF NOT ((p_status = 'til_kontroll' AND v_cl.status IN ('ikke_startet','under_telling'))
       OR (p_status = 'under_telling' AND v_cl.status IN ('til_kontroll','godkjent'))
       OR (p_status = 'godkjent' AND v_cl.status = 'til_kontroll')) THEN
    RAISE EXCEPTION 'Ugyldig listeovergang' USING ERRCODE = '55000';
  END IF;
  IF p_status = 'godkjent' AND EXISTS (SELECT 1 FROM vt_count_lines WHERE count_list_id = p_list_id AND state IN ('ikke_talt','ma_kontrolleres')) THEN
    RAISE EXCEPTION 'Listen har linjer som ikke er talt eller må kontrolleres' USING ERRCODE = '55000';
  END IF;
  UPDATE vt_count_lists SET status = p_status, revision = revision + 1 WHERE id = p_list_id RETURNING * INTO v_cl;
  RETURN _vt_op_finish(p_op_id, jsonb_build_object('ok', true, 'kind', 'list_status', 'list_id', v_cl.id, 'count_id', v_cl.count_id,
    'status', v_cl.status, 'revision', v_cl.revision));
END $$;

-- ---------- RPC: til kontroll / tilbake / avslutt / avbryt ----------
CREATE OR REPLACE FUNCTION public.vt_transition_count(
  p_op_id uuid, p_count_id uuid, p_expected_revision integer, p_to text, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_prev jsonb; v_entity uuid; v_c vt_counts; v_need text;
BEGIN
  SELECT legal_entity_id INTO v_entity FROM vt_counts WHERE id = p_count_id;
  v_need := CASE WHEN p_to IN ('avsluttet','avbrutt') THEN 'approve' ELSE 'write' END;
  v_uid := _vt_require(v_entity, v_need);
  v_prev := _vt_op_begin(p_op_id, 'transition', v_entity, v_uid, jsonb_build_object('count_id', p_count_id,
    'expected_revision', p_expected_revision, 'to', p_to, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  IF p_expected_revision IS NULL OR p_to IS NULL THEN RAISE EXCEPTION 'Revisjon eller status mangler' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_c FROM vt_counts WHERE id = p_count_id FOR UPDATE;   -- utelukker samtidige linje-/listeskrivinger
  IF v_c.revision <> p_expected_revision THEN RAISE EXCEPTION 'Tellingen er endret av andre' USING ERRCODE = '40001'; END IF;
  IF p_to = 'til_kontroll' AND v_c.status <> 'pagar' THEN RAISE EXCEPTION 'Ugyldig overgang' USING ERRCODE = '55000';
  ELSIF p_to = 'pagar' AND v_c.status <> 'til_kontroll' THEN RAISE EXCEPTION 'Ugyldig overgang' USING ERRCODE = '55000';
  ELSIF p_to = 'avsluttet' THEN
    IF v_c.status NOT IN ('pagar','til_kontroll') THEN RAISE EXCEPTION 'Ugyldig overgang' USING ERRCODE = '55000'; END IF;
    PERFORM 1 FROM vt_count_lists WHERE count_id = v_c.id ORDER BY id FOR SHARE;
    IF NOT EXISTS (SELECT 1 FROM vt_count_lines WHERE count_id = v_c.id) THEN
      RAISE EXCEPTION 'Tom telling kan ikke avsluttes' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM vt_count_lists cl WHERE cl.count_id = v_c.id
                AND (cl.status <> 'godkjent' OR NOT EXISTS (SELECT 1 FROM vt_count_lines ln WHERE ln.count_list_id = cl.id))) THEN
      RAISE EXCEPTION 'Alle lister må ha varer og være godkjent' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM vt_count_lines WHERE count_id = v_c.id AND state NOT IN ('talt','null','ikke_her')) THEN
      RAISE EXCEPTION 'Linjer er ikke talt eller må kontrolleres' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM vt_count_lines WHERE count_id = v_c.id AND state = 'talt' AND snap_price_per_base IS NULL) THEN
      RAISE EXCEPTION 'Verdien er ufullstendig: talte varer mangler dokumentert pris' USING ERRCODE = '55000';
    END IF;
  ELSIF p_to = 'avbrutt' THEN
    IF v_c.status NOT IN ('planlagt','pagar','til_kontroll') THEN RAISE EXCEPTION 'Ugyldig overgang' USING ERRCODE = '55000'; END IF;
    IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Begrunnelse kreves' USING ERRCODE = '22023'; END IF;
  ELSIF p_to NOT IN ('til_kontroll','pagar') THEN
    RAISE EXCEPTION 'Ugyldig status' USING ERRCODE = '22023';
  END IF;
  UPDATE vt_counts SET status = p_to, revision = revision + 1,
         finished_at = CASE WHEN p_to = 'avsluttet' THEN now() ELSE finished_at END,
         finished_by = CASE WHEN p_to = 'avsluttet' THEN v_uid ELSE finished_by END,
         cancelled_at = CASE WHEN p_to = 'avbrutt' THEN now() ELSE cancelled_at END,
         cancel_reason = CASE WHEN p_to = 'avbrutt' THEN btrim(p_reason) ELSE cancel_reason END
   WHERE id = v_c.id RETURNING * INTO v_c;
  RETURN _vt_op_finish(p_op_id, jsonb_build_object('ok', true, 'kind', 'transition', 'count_id', v_c.id,
    'status', v_c.status, 'revision', v_c.revision));
END $$;

-- ---------- Funksjonsrettigheter ----------
REVOKE ALL ON FUNCTION public._vt_finite(numeric), public._vt_identity_guard(), public._vt_line_guard(),
  public._vt_count_guard(), public._vt_list_guard(), public._vt_require(uuid,text),
  public._vt_op_begin(uuid,text,uuid,uuid,jsonb), public._vt_op_finish(uuid,jsonb),
  public._vt_price_evidence(uuid,uuid,text,date,boolean), public._vt_validate_template_lines(uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vt_backend_version(),
  public.vt_save_location(uuid,uuid,uuid,integer,text,text,integer,boolean),
  public.vt_save_template(uuid,uuid,uuid,integer,text,text,uuid,boolean,jsonb),
  public.vt_copy_template(uuid,uuid,uuid,integer,text),
  public.vt_create_count(uuid,uuid,text,date,text,date,uuid[]),
  public.vt_check_coverage(uuid,uuid[],text,date),
  public.vt_start_count(uuid,uuid,integer),
  public.vt_save_line(uuid,uuid,integer,text,numeric,jsonb,text),
  public.vt_set_list_status(uuid,uuid,integer,text),
  public.vt_transition_count(uuid,uuid,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vt_backend_version(),
  public.vt_save_location(uuid,uuid,uuid,integer,text,text,integer,boolean),
  public.vt_save_template(uuid,uuid,uuid,integer,text,text,uuid,boolean,jsonb),
  public.vt_copy_template(uuid,uuid,uuid,integer,text),
  public.vt_create_count(uuid,uuid,text,date,text,date,uuid[]),
  public.vt_check_coverage(uuid,uuid[],text,date),
  public.vt_start_count(uuid,uuid,integer),
  public.vt_save_line(uuid,uuid,integer,text,numeric,jsonb,text),
  public.vt_set_list_status(uuid,uuid,integer,text),
  public.vt_transition_count(uuid,uuid,integer,text,text) TO authenticated;
