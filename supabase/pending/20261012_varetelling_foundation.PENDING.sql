-- =====================================================================
-- VARETELLING – FASE 1 GRUNNLAG (FORSLAG, IKKE KJØRT MOT LIVE)
-- Status: til uavhengig gjennomgang. Ikke legg i supabase/migrations før godkjent.
-- Additivt: bare nye objekter med prefiks vt_. Ingen endring av eksisterende
-- tabeller, funksjoner, data eller grants. Gammel dagstelling (rm_stock_count_*)
-- er uberørt.
--
-- Tilgang: public.has_ravarer_access(uid, legal_entity_id, level) (live, lest 12.10.2026).
-- Pris: samme kontrakt som public.rm_usable_cost: bare cost_basis_status='verifisert'
-- gir pris; ellers NULL. Historisk verdsettelsesdato (< start-dato i Oslo) får
-- ALDRI dagens pris: NULL + kilde 'historisk_ikke_tilgjengelig'.
-- Ingen automatisk lagerjustering finnes i denne fasen.
-- =====================================================================

-- ---------- Steder (avdeling / lagersted / rom / reol / hylle) ----------
CREATE TABLE public.vt_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL,
  department text NOT NULL CHECK (length(btrim(department)) BETWEEN 1 AND 80),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  sort_order integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
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
  default_location_id uuid REFERENCES public.vt_locations(id),
  revision integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vt_templates_unique_active
  ON public.vt_templates (legal_entity_id, lower(btrim(name))) WHERE archived_at IS NULL;

CREATE TABLE public.vt_template_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.vt_templates(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id),
  location_id uuid REFERENCES public.vt_locations(id),
  sort_order integer NOT NULL DEFAULT 0,
  count_unit_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);
-- Samme vare + samme sted to ganger i samme mal er umulig (også ved samtidighet).
CREATE UNIQUE INDEX vt_template_lines_unique
  ON public.vt_template_lines (template_id, raw_material_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX vt_template_lines_material ON public.vt_template_lines (legal_entity_id, raw_material_id);

-- Firma-konsistens: mal/sted/vare må tilhøre samme firma som raden.
CREATE OR REPLACE FUNCTION public._vt_template_line_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vt_templates t WHERE t.id = NEW.template_id AND t.legal_entity_id = NEW.legal_entity_id AND t.archived_at IS NULL) THEN
    RAISE EXCEPTION 'Listemalen finnes ikke i firmaet eller er arkivert' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM raw_materials r WHERE r.id = NEW.raw_material_id AND r.legal_entity_id = NEW.legal_entity_id) THEN
    RAISE EXCEPTION 'Varen tilhører ikke firmaet' USING ERRCODE = '22023';
  END IF;
  IF NEW.location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vt_locations l WHERE l.id = NEW.location_id AND l.legal_entity_id = NEW.legal_entity_id) THEN
    RAISE EXCEPTION 'Stedet tilhører ikke firmaet' USING ERRCODE = '22023';
  END IF;
  UPDATE vt_templates SET revision = revision + 1, updated_at = now() WHERE id = NEW.template_id;
  RETURN NEW;
END $$;
CREATE TRIGGER vt_template_line_guard BEFORE INSERT OR UPDATE ON public.vt_template_lines
  FOR EACH ROW EXECUTE FUNCTION public._vt_template_line_guard();

CREATE OR REPLACE FUNCTION public._vt_template_line_bump_on_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE vt_templates SET revision = revision + 1, updated_at = now() WHERE id = OLD.template_id;
  RETURN OLD;
END $$;
CREATE TRIGGER vt_template_line_bump_on_delete AFTER DELETE ON public.vt_template_lines
  FOR EACH ROW EXECUTE FUNCTION public._vt_template_line_bump_on_delete();

CREATE OR REPLACE FUNCTION public._vt_template_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.legal_entity_id <> OLD.legal_entity_id THEN
      RAISE EXCEPTION 'Firma kan ikke endres' USING ERRCODE = '22023';
    END IF;
    IF NEW.default_location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vt_locations l WHERE l.id = NEW.default_location_id AND l.legal_entity_id = NEW.legal_entity_id) THEN
      RAISE EXCEPTION 'Stedet tilhører ikke firmaet' USING ERRCODE = '22023';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER vt_template_guard BEFORE UPDATE ON public.vt_templates
  FOR EACH ROW EXECUTE FUNCTION public._vt_template_guard();

-- ---------- Tellinger ----------
CREATE TABLE public.vt_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  planned_date date NOT NULL,
  valuation_date date NOT NULL,
  status text NOT NULL DEFAULT 'planlagt'
    CHECK (status IN ('planlagt','pagar','til_kontroll','avsluttet','avbrutt')),
  template_ids uuid[] NOT NULL DEFAULT '{}',
  create_op_id uuid NOT NULL UNIQUE,
  start_op_id uuid UNIQUE,
  finish_op_id uuid UNIQUE,
  revision integer NOT NULL DEFAULT 1,
  started_at timestamptz,
  started_by uuid,
  finished_at timestamptz,
  finished_by uuid,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vt_counts_entity ON public.vt_counts (legal_entity_id, planned_date DESC);

CREATE TABLE public.vt_count_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES public.vt_counts(id),
  legal_entity_id uuid NOT NULL,
  source_template_id uuid NOT NULL,
  source_template_revision integer NOT NULL,
  name text NOT NULL,
  department text NOT NULL,
  status text NOT NULL DEFAULT 'ikke_startet'
    CHECK (status IN ('ikke_startet','under_telling','til_kontroll','godkjent')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_id, source_template_id)
);

CREATE TABLE public.vt_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES public.vt_counts(id),
  count_list_id uuid NOT NULL REFERENCES public.vt_count_lists(id),
  legal_entity_id uuid NOT NULL,
  raw_material_id uuid NOT NULL,
  location_id uuid,
  sort_order integer NOT NULL DEFAULT 0,
  -- Uforanderlig startgrunnlag
  snap_name text NOT NULL,
  snap_sku text,
  snap_location_name text,
  snap_base_unit text NOT NULL,
  snap_units jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{id,label,units_in_base}]
  snap_price_per_base numeric,                     -- NULL = mangler dokumentert pris
  snap_price_source text NOT NULL
    CHECK (snap_price_source IN ('verifisert_kostpris','mangler_verifisert_pris','historisk_ikke_tilgjengelig')),
  snap_price_history_id uuid,
  snap_currency text NOT NULL DEFAULT 'NOK',
  snap_price_excl_vat boolean NOT NULL DEFAULT true,
  snap_taken_at timestamptz NOT NULL,
  -- Registrering
  state text NOT NULL DEFAULT 'ikke_talt'
    CHECK (state IN ('ikke_talt','talt','null','ikke_her','ma_kontrolleres')),
  counted_base numeric,
  entry jsonb NOT NULL DEFAULT '[]'::jsonb,        -- [{unit_id|null,label,units_in_base,amount}]
  note text CHECK (note IS NULL OR length(note) <= 500),
  revision integer NOT NULL DEFAULT 0,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vt_line_state_qty CHECK (
    (state = 'talt' AND counted_base IS NOT NULL AND counted_base >= 0)
    OR (state = 'null' AND counted_base = 0)
    OR (state IN ('ikke_talt','ikke_her') AND counted_base IS NULL)
    OR (state = 'ma_kontrolleres' AND (counted_base IS NULL OR counted_base >= 0))
  )
);
-- Samme vare + samme sted kan ikke telles to ganger i samme telling.
CREATE UNIQUE INDEX vt_count_lines_unique
  ON public.vt_count_lines (count_id, raw_material_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX vt_count_lines_list ON public.vt_count_lines (count_list_id, sort_order);

CREATE TABLE public.vt_line_ops (
  op_id uuid PRIMARY KEY,
  line_id uuid NOT NULL REFERENCES public.vt_count_lines(id),
  request jsonb NOT NULL,
  result jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Startgrunnlag og avsluttede tellinger beskyttes i databasen (også mot feil i RPC-er).
CREATE OR REPLACE FUNCTION public._vt_line_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Tellelinjer kan ikke slettes' USING ERRCODE = '42501';
  END IF;
  IF (NEW.count_id, NEW.count_list_id, NEW.legal_entity_id, NEW.raw_material_id, NEW.location_id,
      NEW.snap_name, NEW.snap_sku, NEW.snap_location_name, NEW.snap_base_unit, NEW.snap_units,
      NEW.snap_price_per_base, NEW.snap_price_source, NEW.snap_price_history_id, NEW.snap_currency,
      NEW.snap_price_excl_vat, NEW.snap_taken_at)
     IS DISTINCT FROM
     (OLD.count_id, OLD.count_list_id, OLD.legal_entity_id, OLD.raw_material_id, OLD.location_id,
      OLD.snap_name, OLD.snap_sku, OLD.snap_location_name, OLD.snap_base_unit, OLD.snap_units,
      OLD.snap_price_per_base, OLD.snap_price_source, OLD.snap_price_history_id, OLD.snap_currency,
      OLD.snap_price_excl_vat, OLD.snap_taken_at) THEN
    RAISE EXCEPTION 'Startgrunnlaget er låst' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM vt_counts WHERE id = OLD.count_id;
  IF v_status IN ('avsluttet','avbrutt','planlagt') THEN
    RAISE EXCEPTION 'Tellingen er ikke åpen for registrering' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vt_line_guard BEFORE UPDATE OR DELETE ON public.vt_count_lines
  FOR EACH ROW EXECUTE FUNCTION public._vt_line_guard();

CREATE OR REPLACE FUNCTION public._vt_count_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Tellinger kan ikke slettes' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('avsluttet','avbrutt') THEN
    RAISE EXCEPTION 'Avsluttet eller avbrutt telling er låst' USING ERRCODE = '42501';
  END IF;
  IF NEW.legal_entity_id <> OLD.legal_entity_id OR NEW.create_op_id <> OLD.create_op_id THEN
    RAISE EXCEPTION 'Identitet kan ikke endres' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'planlagt' AND (NEW.valuation_date <> OLD.valuation_date OR NEW.template_ids <> OLD.template_ids) THEN
    RAISE EXCEPTION 'Startet telling: omfang og verdsettelsesdato er låst' USING ERRCODE = '42501';
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
  IF EXISTS (SELECT 1 FROM vt_counts c WHERE c.id = OLD.count_id AND c.status IN ('avsluttet','avbrutt')) THEN
    RAISE EXCEPTION 'Tellingen er låst' USING ERRCODE = '42501';
  END IF;
  IF (NEW.count_id, NEW.source_template_id, NEW.source_template_revision, NEW.name, NEW.department, NEW.legal_entity_id)
     IS DISTINCT FROM (OLD.count_id, OLD.source_template_id, OLD.source_template_revision, OLD.name, OLD.department, OLD.legal_entity_id) THEN
    RAISE EXCEPTION 'Tellelistens grunnlag er låst' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vt_list_guard BEFORE UPDATE OR DELETE ON public.vt_count_lists
  FOR EACH ROW EXECUTE FUNCTION public._vt_list_guard();

-- ---------- Grants (smale) + RLS ----------
REVOKE ALL ON public.vt_locations, public.vt_templates, public.vt_template_lines,
  public.vt_counts, public.vt_count_lists, public.vt_count_lines, public.vt_line_ops FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.vt_locations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.vt_templates TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.vt_template_lines TO authenticated;
GRANT SELECT ON public.vt_counts, public.vt_count_lists, public.vt_count_lines TO authenticated;
-- vt_line_ops: ingen klienttilgang.
GRANT ALL ON public.vt_locations, public.vt_templates, public.vt_template_lines,
  public.vt_counts, public.vt_count_lists, public.vt_count_lines, public.vt_line_ops TO service_role;

ALTER TABLE public.vt_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_template_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_count_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vt_line_ops ENABLE ROW LEVEL SECURITY;

CREATE POLICY vt_locations_read ON public.vt_locations FOR SELECT TO authenticated
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY vt_locations_insert ON public.vt_locations FOR INSERT TO authenticated
  WITH CHECK (public.has_ravarer_access(auth.uid(), legal_entity_id, 'write'));
CREATE POLICY vt_locations_update ON public.vt_locations FOR UPDATE TO authenticated
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'write'))
  WITH CHECK (public.has_ravarer_access(auth.uid(), legal_entity_id, 'write'));

CREATE POLICY vt_templates_read ON public.vt_templates FOR SELECT TO authenticated
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY vt_templates_insert ON public.vt_templates FOR INSERT TO authenticated
  WITH CHECK (public.has_ravarer_access(auth.uid(), legal_entity_id, 'write'));
CREATE POLICY vt_templates_update ON public.vt_templates FOR UPDATE TO authenticated
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'write'))
  WITH CHECK (public.has_ravarer_access(auth.uid(), legal_entity_id, 'write'));

CREATE POLICY vt_template_lines_read ON public.vt_template_lines FOR SELECT TO authenticated
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY vt_template_lines_insert ON public.vt_template_lines FOR INSERT TO authenticated
  WITH CHECK (public.has_ravarer_access(auth.uid(), legal_entity_id, 'write'));
CREATE POLICY vt_template_lines_delete ON public.vt_template_lines FOR DELETE TO authenticated
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'write'));

CREATE POLICY vt_counts_read ON public.vt_counts FOR SELECT TO authenticated
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY vt_count_lists_read ON public.vt_count_lists FOR SELECT TO authenticated
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY vt_count_lines_read ON public.vt_count_lines FOR SELECT TO authenticated
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));

-- ---------- RPC: opprett planlagt telling (idempotent på op-id) ----------
CREATE OR REPLACE FUNCTION public.vt_create_count(
  p_op_id uuid, p_legal_entity_id uuid, p_name text, p_planned_date date,
  p_valuation_date date, p_template_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row vt_counts;
BEGIN
  IF v_uid IS NULL OR NOT has_ravarer_access(v_uid, p_legal_entity_id, 'write') THEN
    RAISE EXCEPTION 'Mangler skrivetilgang' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM vt_counts WHERE create_op_id = p_op_id;
  IF FOUND THEN
    IF v_row.legal_entity_id <> p_legal_entity_id OR v_row.created_by <> v_uid THEN
      RAISE EXCEPTION 'Operasjons-ID er brukt i en annen sammenheng' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('ok', true, 'count_id', v_row.id, 'already_created', true);
  END IF;
  IF p_planned_date IS NULL OR p_valuation_date IS NULL THEN
    RAISE EXCEPTION 'Dato mangler' USING ERRCODE = '22023';
  END IF;
  IF coalesce(array_length(p_template_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Velg minst én listemal' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM vt_templates t WHERE t.id = ANY(p_template_ids)
        AND t.legal_entity_id = p_legal_entity_id AND t.archived_at IS NULL)
     <> (SELECT count(DISTINCT x) FROM unnest(p_template_ids) x) THEN
    RAISE EXCEPTION 'Ukjent eller arkivert listemal' USING ERRCODE = '22023';
  END IF;
  INSERT INTO vt_counts (legal_entity_id, name, planned_date, valuation_date, template_ids, create_op_id, created_by)
  VALUES (p_legal_entity_id, btrim(p_name), p_planned_date, p_valuation_date,
          ARRAY(SELECT DISTINCT x FROM unnest(p_template_ids) x), p_op_id, v_uid)
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'count_id', v_row.id, 'already_created', false);
END $$;

-- ---------- RPC: dekningskontroll før start (lesing) ----------
CREATE OR REPLACE FUNCTION public.vt_check_coverage(p_legal_entity_id uuid, p_template_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT has_ravarer_access(v_uid, p_legal_entity_id, 'read') THEN
    RAISE EXCEPTION 'Mangler tilgang' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'duplicates', coalesce((
      SELECT jsonb_agg(jsonb_build_object('raw_material_id', d.raw_material_id, 'location_id', d.location_id, 'template_ids', d.tids))
      FROM (SELECT tl.raw_material_id, tl.location_id, array_agg(DISTINCT tl.template_id) tids
              FROM vt_template_lines tl
             WHERE tl.legal_entity_id = p_legal_entity_id AND tl.template_id = ANY(p_template_ids)
             GROUP BY tl.raw_material_id, tl.location_id HAVING count(*) > 1) d), '[]'::jsonb),
    'missing_price', (SELECT count(DISTINCT tl.raw_material_id) FROM vt_template_lines tl JOIN raw_materials r ON r.id = tl.raw_material_id
       WHERE tl.legal_entity_id = p_legal_entity_id AND tl.template_id = ANY(p_template_ids)
         AND (r.cost_basis_status IS DISTINCT FROM 'verifisert' OR r.current_cost_price IS NULL)),
    'missing_location', (SELECT count(*) FROM vt_template_lines tl
       WHERE tl.legal_entity_id = p_legal_entity_id AND tl.template_id = ANY(p_template_ids) AND tl.location_id IS NULL),
    'line_count', (SELECT count(*) FROM vt_template_lines tl
       WHERE tl.legal_entity_id = p_legal_entity_id AND tl.template_id = ANY(p_template_ids))
  );
END $$;

-- ---------- RPC: start telling (atomisk kopi + frosset grunnlag) ----------
CREATE OR REPLACE FUNCTION public.vt_start_count(p_op_id uuid, p_count_id uuid, p_expected_revision integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_c vt_counts; v_now timestamptz := now();
  v_today date := (now() AT TIME ZONE 'Europe/Oslo')::date; v_historic boolean; v_lines integer;
BEGIN
  SELECT * INTO v_c FROM vt_counts WHERE id = p_count_id FOR UPDATE;
  IF NOT FOUND OR v_uid IS NULL OR NOT has_ravarer_access(v_uid, v_c.legal_entity_id, 'write') THEN
    RAISE EXCEPTION 'Mangler skrivetilgang' USING ERRCODE = '42501';
  END IF;
  IF v_c.start_op_id = p_op_id THEN
    RETURN jsonb_build_object('ok', true, 'count_id', v_c.id, 'already_started', true,
      'lines', (SELECT count(*) FROM vt_count_lines WHERE count_id = v_c.id));
  END IF;
  IF v_c.status <> 'planlagt' THEN
    RAISE EXCEPTION 'Tellingen er allerede startet eller lukket' USING ERRCODE = '55000';
  END IF;
  IF v_c.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Tellingen er endret av andre' USING ERRCODE = '40001';
  END IF;
  -- Serverhåndhevet duplikatsperre før start.
  IF EXISTS (SELECT 1 FROM vt_template_lines tl WHERE tl.template_id = ANY(v_c.template_ids)
              GROUP BY tl.raw_material_id, coalesce(tl.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
              HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Samme vare på samme sted finnes i flere valgte lister — avklar før start' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM vt_templates t WHERE t.id = ANY(v_c.template_ids)
              AND (t.archived_at IS NOT NULL OR t.legal_entity_id <> v_c.legal_entity_id)) THEN
    RAISE EXCEPTION 'En valgt listemal er arkivert' USING ERRCODE = '22023';
  END IF;
  v_historic := v_c.valuation_date < v_today;
  -- Lås malene: samtidige malendringer (som øker revisjon) venter til kopien er tatt.
  PERFORM 1 FROM vt_templates t WHERE t.id = ANY(v_c.template_ids) FOR SHARE;

  INSERT INTO vt_count_lists (count_id, legal_entity_id, source_template_id, source_template_revision, name, department, sort_order)
  SELECT v_c.id, v_c.legal_entity_id, t.id, t.revision, t.name, t.department,
         row_number() OVER (ORDER BY t.department, t.name)
    FROM vt_templates t WHERE t.id = ANY(v_c.template_ids);

  INSERT INTO vt_count_lines (count_id, count_list_id, legal_entity_id, raw_material_id, location_id, sort_order,
    snap_name, snap_sku, snap_location_name, snap_base_unit, snap_units,
    snap_price_per_base, snap_price_source, snap_price_history_id, snap_taken_at)
  SELECT v_c.id, cl.id, v_c.legal_entity_id, r.id, tl.location_id, tl.sort_order,
         r.name, r.sku, CASE WHEN l.id IS NULL THEN NULL ELSE l.department || ' / ' || l.name END,
         coalesce(r.base_unit, 'stk'),
         coalesce((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'label', u.unit_label, 'units_in_base', u.units_in_base) ORDER BY u.sort_order)
                     FROM raw_material_units u
                    WHERE u.raw_material_id = r.id AND u.units_in_base > 0
                      AND (cardinality(tl.count_unit_ids) = 0 OR u.id = ANY(tl.count_unit_ids))), '[]'::jsonb),
         CASE WHEN v_historic THEN NULL
              WHEN r.cost_basis_status = 'verifisert' THEN r.current_cost_price END,
         CASE WHEN v_historic THEN 'historisk_ikke_tilgjengelig'
              WHEN r.cost_basis_status = 'verifisert' AND r.current_cost_price IS NOT NULL THEN 'verifisert_kostpris'
              ELSE 'mangler_verifisert_pris' END,
         CASE WHEN NOT v_historic AND r.cost_basis_status = 'verifisert' THEN r.cost_source_history_id END,
         v_now
    FROM vt_template_lines tl
    JOIN vt_count_lists cl ON cl.count_id = v_c.id AND cl.source_template_id = tl.template_id
    JOIN raw_materials r ON r.id = tl.raw_material_id AND r.legal_entity_id = v_c.legal_entity_id
    LEFT JOIN vt_locations l ON l.id = tl.location_id;
  GET DIAGNOSTICS v_lines = ROW_COUNT;

  UPDATE vt_counts SET status = 'pagar', start_op_id = p_op_id, started_at = v_now, started_by = v_uid,
         revision = revision + 1 WHERE id = v_c.id;
  RETURN jsonb_build_object('ok', true, 'count_id', v_c.id, 'already_started', false, 'lines', v_lines,
    'historic_valuation', v_historic);
END $$;

-- ---------- RPC: lagre én linje (CAS + idempotent op-id) ----------
CREATE OR REPLACE FUNCTION public.vt_save_line(
  p_op_id uuid, p_line_id uuid, p_expected_revision integer, p_state text,
  p_counted_base numeric, p_entry jsonb, p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_l vt_count_lines; v_status text; v_list_status text; v_prev vt_line_ops;
  v_req jsonb := jsonb_build_object('line_id', p_line_id, 'expected_revision', p_expected_revision, 'state', p_state,
                                    'counted_base', p_counted_base, 'entry', coalesce(p_entry, '[]'::jsonb), 'note', p_note);
  v_res jsonb;
BEGIN
  SELECT * INTO v_l FROM vt_count_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND OR v_uid IS NULL OR NOT has_ravarer_access(v_uid, v_l.legal_entity_id, 'write') THEN
    RAISE EXCEPTION 'Mangler skrivetilgang' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_prev FROM vt_line_ops WHERE op_id = p_op_id;
  IF FOUND THEN
    IF v_prev.request <> v_req OR v_prev.created_by <> v_uid THEN
      RAISE EXCEPTION 'Operasjons-ID er brukt med annet innhold' USING ERRCODE = '23505';
    END IF;
    RETURN v_prev.result || jsonb_build_object('already_applied', true);
  END IF;
  SELECT status INTO v_status FROM vt_counts WHERE id = v_l.count_id;
  SELECT status INTO v_list_status FROM vt_count_lists WHERE id = v_l.count_list_id;
  IF v_status NOT IN ('pagar','til_kontroll') OR v_list_status = 'godkjent' THEN
    RAISE EXCEPTION 'Listen er ikke åpen for registrering' USING ERRCODE = '55000';
  END IF;
  IF p_state NOT IN ('ikke_talt','talt','null','ikke_her','ma_kontrolleres') THEN
    RAISE EXCEPTION 'Ugyldig tilstand' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(p_entry, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Ugyldig registrering' USING ERRCODE = '22023';
  END IF;
  IF v_l.revision <> p_expected_revision THEN
    -- Konflikt: ingenting skrives; klienten får begge verdier.
    RETURN jsonb_build_object('ok', false, 'conflict', true, 'line', to_jsonb(v_l) - 'legal_entity_id');
  END IF;
  UPDATE vt_count_lines SET state = p_state,
         counted_base = CASE WHEN p_state = 'null' THEN 0 WHEN p_state IN ('ikke_talt','ikke_her') THEN NULL ELSE p_counted_base END,
         entry = coalesce(p_entry, '[]'::jsonb), note = nullif(btrim(coalesce(p_note, '')), ''),
         revision = revision + 1, updated_by = v_uid, updated_at = now()
   WHERE id = p_line_id RETURNING * INTO v_l;
  UPDATE vt_count_lists SET status = 'under_telling' WHERE id = v_l.count_list_id AND status = 'ikke_startet';
  v_res := jsonb_build_object('ok', true, 'conflict', false, 'line', to_jsonb(v_l) - 'legal_entity_id');
  INSERT INTO vt_line_ops (op_id, line_id, request, result, created_by) VALUES (p_op_id, p_line_id, v_req, v_res, v_uid);
  RETURN v_res;
END $$;

-- ---------- RPC: listestatus ----------
CREATE OR REPLACE FUNCTION public.vt_set_list_status(p_list_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_cl vt_count_lists; v_need text;
BEGIN
  SELECT * INTO v_cl FROM vt_count_lists WHERE id = p_list_id FOR UPDATE;
  v_need := CASE WHEN p_status = 'godkjent' OR v_cl.status = 'godkjent' THEN 'approve' ELSE 'write' END;
  IF NOT FOUND OR v_uid IS NULL OR NOT has_ravarer_access(v_uid, v_cl.legal_entity_id, v_need::access_level) THEN
    RAISE EXCEPTION 'Mangler tilgang' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('under_telling','til_kontroll','godkjent') THEN
    RAISE EXCEPTION 'Ugyldig status' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vt_counts WHERE id = v_cl.count_id AND status IN ('pagar','til_kontroll')) THEN
    RAISE EXCEPTION 'Tellingen er ikke åpen' USING ERRCODE = '55000';
  END IF;
  IF p_status = 'godkjent' AND EXISTS (SELECT 1 FROM vt_count_lines WHERE count_list_id = p_list_id AND state IN ('ikke_talt','ma_kontrolleres')) THEN
    RAISE EXCEPTION 'Listen har linjer som ikke er talt eller må kontrolleres' USING ERRCODE = '55000';
  END IF;
  UPDATE vt_count_lists SET status = p_status WHERE id = p_list_id;
  RETURN jsonb_build_object('ok', true, 'list_id', p_list_id, 'status', p_status);
END $$;

-- ---------- RPC: til kontroll / avslutt / avbryt ----------
CREATE OR REPLACE FUNCTION public.vt_transition_count(
  p_op_id uuid, p_count_id uuid, p_expected_revision integer, p_to text, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_c vt_counts; v_need text;
BEGIN
  SELECT * INTO v_c FROM vt_counts WHERE id = p_count_id FOR UPDATE;
  v_need := CASE WHEN p_to IN ('avsluttet','avbrutt') THEN 'approve' ELSE 'write' END;
  IF NOT FOUND OR v_uid IS NULL OR NOT has_ravarer_access(v_uid, v_c.legal_entity_id, v_need::access_level) THEN
    RAISE EXCEPTION 'Mangler tilgang' USING ERRCODE = '42501';
  END IF;
  IF v_c.finish_op_id = p_op_id THEN
    RETURN jsonb_build_object('ok', true, 'count_id', v_c.id, 'status', v_c.status, 'already_applied', true);
  END IF;
  IF v_c.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Tellingen er endret av andre' USING ERRCODE = '40001';
  END IF;
  IF p_to = 'til_kontroll' AND v_c.status <> 'pagar' THEN
    RAISE EXCEPTION 'Ugyldig overgang' USING ERRCODE = '55000';
  ELSIF p_to = 'pagar' AND v_c.status <> 'til_kontroll' THEN
    RAISE EXCEPTION 'Ugyldig overgang' USING ERRCODE = '55000';
  ELSIF p_to = 'avsluttet' THEN
    IF v_c.status NOT IN ('pagar','til_kontroll') THEN RAISE EXCEPTION 'Ugyldig overgang' USING ERRCODE = '55000'; END IF;
    IF EXISTS (SELECT 1 FROM vt_count_lines WHERE count_id = v_c.id AND state IN ('ikke_talt','ma_kontrolleres')) THEN
      RAISE EXCEPTION 'Linjer er ikke talt eller må kontrolleres' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM vt_count_lines WHERE count_id = v_c.id AND state IN ('talt','null') AND snap_price_per_base IS NULL) THEN
      RAISE EXCEPTION 'Verdien er ufullstendig: talte varer mangler dokumentert pris' USING ERRCODE = '55000';
    END IF;
  ELSIF p_to = 'avbrutt' THEN
    IF v_c.status NOT IN ('planlagt','pagar','til_kontroll') THEN RAISE EXCEPTION 'Ugyldig overgang' USING ERRCODE = '55000'; END IF;
    IF length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Begrunnelse kreves' USING ERRCODE = '22023'; END IF;
  ELSIF p_to NOT IN ('til_kontroll','pagar') THEN
    RAISE EXCEPTION 'Ugyldig status' USING ERRCODE = '22023';
  END IF;
  UPDATE vt_counts SET status = p_to, revision = revision + 1,
         finish_op_id = CASE WHEN p_to IN ('avsluttet','avbrutt') THEN p_op_id ELSE finish_op_id END,
         finished_at = CASE WHEN p_to = 'avsluttet' THEN now() ELSE finished_at END,
         finished_by = CASE WHEN p_to = 'avsluttet' THEN v_uid ELSE finished_by END,
         cancelled_at = CASE WHEN p_to = 'avbrutt' THEN now() ELSE cancelled_at END,
         cancel_reason = CASE WHEN p_to = 'avbrutt' THEN btrim(p_reason) ELSE cancel_reason END
   WHERE id = v_c.id RETURNING * INTO v_c;
  RETURN jsonb_build_object('ok', true, 'count_id', v_c.id, 'status', v_c.status, 'revision', v_c.revision, 'already_applied', false);
END $$;

REVOKE ALL ON FUNCTION public.vt_create_count(uuid,uuid,text,date,date,uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vt_check_coverage(uuid,uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vt_start_count(uuid,uuid,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vt_save_line(uuid,uuid,integer,text,numeric,jsonb,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vt_set_list_status(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vt_transition_count(uuid,uuid,integer,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._vt_template_line_guard(), public._vt_template_line_bump_on_delete(),
  public._vt_template_guard(), public._vt_line_guard(), public._vt_count_guard(), public._vt_list_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vt_create_count(uuid,uuid,text,date,date,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vt_check_coverage(uuid,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vt_start_count(uuid,uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vt_save_line(uuid,uuid,integer,text,numeric,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vt_set_list_status(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vt_transition_count(uuid,uuid,integer,text,text) TO authenticated;
