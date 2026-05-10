
-- 1) Categories (configurable colors per category code)
CREATE TABLE public.production_template_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  color_hex text NOT NULL DEFAULT '#e2e8f0',
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.production_template_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ptc_select_authenticated"
  ON public.production_template_categories FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "ptc_write_admin"
  ON public.production_template_categories FOR ALL
  TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

INSERT INTO public.production_template_categories (code, label, color_hex, sort_order) VALUES
  ('B', 'Bakeri',      '#dbeafe',  10),
  ('C', 'Konditori',   '#fed7aa',  20),
  ('D', 'Deig',        '#e7d4b5',  30),
  ('J', 'Jul/sesong',  '#fef9c3',  40),
  ('K', 'Kake',        '#e9d5ff',  50),
  ('P', 'Pakking',     '#bbf7d0',  60),
  ('V', 'Vanlig',      '#ffffff',  70);

-- 2) Templates
CREATE TABLE public.production_criteria_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  name text NOT NULL,
  category_code text REFERENCES public.production_template_categories(code) ON UPDATE CASCADE ON DELETE SET NULL,
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pct_legal_entity ON public.production_criteria_templates(legal_entity_id);
CREATE INDEX idx_pct_name ON public.production_criteria_templates(legal_entity_id, name);

ALTER TABLE public.production_criteria_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pct_select_in_entity"
  ON public.production_criteria_templates FOR SELECT
  TO authenticated
  USING (has_position_in_entity(legal_entity_id) OR is_platform_admin());

CREATE POLICY "pct_insert_write"
  ON public.production_criteria_templates FOR INSERT
  TO authenticated
  WITH CHECK (
    has_position_in_entity(legal_entity_id)
    AND (has_app_write_access('produksjon') OR has_app_write_access('varer'))
  );

CREATE POLICY "pct_update_write"
  ON public.production_criteria_templates FOR UPDATE
  TO authenticated
  USING (
    has_position_in_entity(legal_entity_id)
    AND (has_app_write_access('produksjon') OR has_app_write_access('varer'))
  );

CREATE POLICY "pct_delete_write"
  ON public.production_criteria_templates FOR DELETE
  TO authenticated
  USING (
    has_position_in_entity(legal_entity_id)
    AND (has_app_write_access('produksjon') OR has_app_write_access('varer'))
  );

-- 3) Snapshots
CREATE TABLE public.production_plan_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.production_criteria_templates(id) ON DELETE SET NULL,
  template_name_copy text,
  production_date date NOT NULL,
  tours integer[] NOT NULL DEFAULT '{}',
  criteria_copy jsonb NOT NULL DEFAULT '{}'::jsonb,
  list_type text NOT NULL DEFAULT 'produksjonsliste',
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pps_lookup
  ON public.production_plan_snapshots(legal_entity_id, production_date, template_id, created_at DESC);

ALTER TABLE public.production_plan_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pps_select_in_entity"
  ON public.production_plan_snapshots FOR SELECT
  TO authenticated
  USING (has_position_in_entity(legal_entity_id) OR is_platform_admin());

CREATE POLICY "pps_insert_write"
  ON public.production_plan_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (
    has_position_in_entity(legal_entity_id)
    AND (has_app_write_access('produksjon') OR has_app_write_access('varer'))
  );

CREATE POLICY "pps_delete_write"
  ON public.production_plan_snapshots FOR DELETE
  TO authenticated
  USING (
    has_position_in_entity(legal_entity_id)
    AND (has_app_write_access('produksjon') OR has_app_write_access('varer'))
  );

-- 4) Snapshot items
CREATE TABLE public.production_plan_snapshot_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES public.production_plan_snapshots(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity_ordered numeric NOT NULL DEFAULT 0,
  quantity_from_stock numeric NOT NULL DEFAULT 0,
  quantity_to_produce numeric NOT NULL DEFAULT 0,
  trays_full integer NOT NULL DEFAULT 0,
  trays_partial integer NOT NULL DEFAULT 0
);

CREATE INDEX idx_ppsi_snapshot ON public.production_plan_snapshot_items(snapshot_id);
CREATE INDEX idx_ppsi_product ON public.production_plan_snapshot_items(product_id);

ALTER TABLE public.production_plan_snapshot_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ppsi_select_via_snapshot"
  ON public.production_plan_snapshot_items FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.production_plan_snapshots s
    WHERE s.id = snapshot_id
      AND (has_position_in_entity(s.legal_entity_id) OR is_platform_admin())
  ));

CREATE POLICY "ppsi_insert_via_snapshot"
  ON public.production_plan_snapshot_items FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.production_plan_snapshots s
    WHERE s.id = snapshot_id
      AND has_position_in_entity(s.legal_entity_id)
      AND (has_app_write_access('produksjon') OR has_app_write_access('varer'))
  ));

CREATE POLICY "ppsi_delete_via_snapshot"
  ON public.production_plan_snapshot_items FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.production_plan_snapshots s
    WHERE s.id = snapshot_id
      AND has_position_in_entity(s.legal_entity_id)
      AND (has_app_write_access('produksjon') OR has_app_write_access('varer'))
  ));

-- updated_at triggers
CREATE TRIGGER trg_ptc_updated_at BEFORE UPDATE ON public.production_template_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_pct_updated_at BEFORE UPDATE ON public.production_criteria_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
