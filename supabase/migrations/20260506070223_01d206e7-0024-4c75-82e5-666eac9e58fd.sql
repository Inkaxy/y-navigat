
-- ============================================================
-- RÅVAREMODULEN PULJE 1: Datamodell
-- ============================================================

-- ---------- ENUMS ----------
CREATE TYPE public.allergen_type AS ENUM (
  'gluten_wheat','gluten_rye','gluten_barley','gluten_oats','gluten_spelt',
  'crustaceans','eggs','fish','peanuts','soybeans',
  'milk','nuts_almond','nuts_hazelnut','nuts_walnut','nuts_cashew',
  'nuts_pecan','nuts_brazil','nuts_pistachio','nuts_macadamia',
  'celery','mustard','sesame','sulphites','lupin','molluscs'
);

CREATE TYPE public.allergen_presence AS ENUM ('contains','may_contain','free_from');

CREATE TYPE public.alias_type AS ENUM ('supplier_sku','product_name','ean','gtin');
CREATE TYPE public.alias_status AS ENUM ('confirmed','pending','rejected','superseded');

-- ---------- POSITIONS: is_owner ----------
ALTER TABLE public.positions ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT false;

-- ---------- SUPPLIERS ----------
CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id UUID NOT NULL REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  org_number TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, name)
);
CREATE INDEX idx_suppliers_legal_entity ON public.suppliers(legal_entity_id, is_active);

-- ---------- RAW MATERIALS ----------
CREATE TABLE public.raw_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id UUID NOT NULL REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  is_packaging BOOLEAN NOT NULL DEFAULT false,
  base_unit TEXT NOT NULL,
  package_size NUMERIC,
  package_unit TEXT,
  current_cost_price NUMERIC CHECK (current_cost_price IS NULL OR current_cost_price >= 0),
  agreed_price NUMERIC CHECK (agreed_price IS NULL OR agreed_price >= 0),
  price_updated_at TIMESTAMPTZ,
  price_source TEXT,
  current_stock NUMERIC NOT NULL DEFAULT 0,
  min_stock NUMERIC,
  is_active BOOLEAN NOT NULL DEFAULT true,
  primary_supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE (legal_entity_id, sku)
);
CREATE INDEX idx_raw_materials_le_active ON public.raw_materials(legal_entity_id, is_active);
CREATE INDEX idx_raw_materials_le_category ON public.raw_materials(legal_entity_id, category);

-- ---------- NUTRITION ----------
CREATE TABLE public.raw_material_nutrition (
  raw_material_id UUID PRIMARY KEY REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  energy_kj NUMERIC, energy_kcal NUMERIC,
  fat_g NUMERIC, saturated_fat_g NUMERIC,
  carbs_g NUMERIC, sugars_g NUMERIC,
  fiber_g NUMERIC, protein_g NUMERIC, salt_g NUMERIC,
  ingredient_declaration TEXT,
  country_of_origin TEXT,
  e_numbers TEXT[],
  source TEXT,
  source_document_url TEXT,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- ALLERGENS ----------
CREATE TABLE public.raw_material_allergens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  allergen public.allergen_type NOT NULL,
  presence public.allergen_presence NOT NULL DEFAULT 'contains',
  UNIQUE (raw_material_id, allergen)
);
CREATE INDEX idx_rm_allergens_rm ON public.raw_material_allergens(raw_material_id);

-- ---------- RAW MATERIAL SUPPLIERS ----------
CREATE TABLE public.raw_material_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  supplier_sku TEXT,
  supplier_product_name TEXT,
  package_size NUMERIC,
  package_unit TEXT,
  agreed_price NUMERIC,
  agreed_price_per_base_unit NUMERIC,
  agreement_valid_from DATE,
  agreement_valid_to DATE,
  agreement_document_url TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  last_invoice_price NUMERIC,
  last_invoice_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (raw_material_id, supplier_id)
);
CREATE INDEX idx_rm_suppliers_rm ON public.raw_material_suppliers(raw_material_id);
CREATE INDEX idx_rm_suppliers_supplier ON public.raw_material_suppliers(supplier_id);

-- ---------- ALIASES (forberedt for Pulje 2) ----------
CREATE TABLE public.raw_material_supplier_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_supplier_id UUID NOT NULL REFERENCES public.raw_material_suppliers(id) ON DELETE CASCADE,
  alias_type public.alias_type NOT NULL,
  alias_value TEXT NOT NULL,
  status public.alias_status NOT NULL DEFAULT 'pending',
  match_count INT NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_seen_invoice_id UUID,
  confirmed_by UUID REFERENCES auth.users(id),
  confirmed_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES auth.users(id),
  rejected_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alias_type, alias_value, raw_material_supplier_id)
);
CREATE INDEX idx_rm_aliases_lookup ON public.raw_material_supplier_aliases(alias_type, alias_value) WHERE status = 'confirmed';
CREATE INDEX idx_rm_aliases_rms ON public.raw_material_supplier_aliases(raw_material_supplier_id);

-- ---------- PRICE HISTORY ----------
CREATE TABLE public.raw_material_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  price NUMERIC NOT NULL CHECK (price >= 0),
  effective_date DATE NOT NULL,
  source TEXT NOT NULL,
  source_reference TEXT,
  invoice_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);
CREATE INDEX idx_rm_price_hist ON public.raw_material_price_history(raw_material_id, effective_date DESC);

-- ---------- RECIPE_LINES: kobling til råvarer (Pulje 3-forberedelse) ----------
ALTER TABLE public.recipe_lines ADD COLUMN IF NOT EXISTS raw_material_id UUID REFERENCES public.raw_materials(id) ON DELETE SET NULL;
ALTER TABLE public.recipe_lines ADD COLUMN IF NOT EXISTS quantity_grams NUMERIC;

-- ---------- TRIGGER: updated_at ----------
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_raw_materials_updated BEFORE UPDATE ON public.raw_materials
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_rm_nutrition_updated BEFORE UPDATE ON public.raw_material_nutrition
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_rm_suppliers_updated BEFORE UPDATE ON public.raw_material_suppliers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- HELPER FUNCTIONS (SECURITY DEFINER) for RLS
-- ============================================================

-- Returnerer true hvis bruker har en aktiv posisjon med is_owner = true
CREATE OR REPLACE FUNCTION public.is_ravarer_owner(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_positions up
    JOIN public.positions p ON p.id = up.position_id
    WHERE up.user_id = _user_id
      AND p.is_owner = true
      AND (up.valid_to IS NULL OR up.valid_to >= CURRENT_DATE)
      AND up.valid_from <= CURRENT_DATE
  );
$$;

-- Sjekker om bruker har minst gitt access_level til ravarer-appen for et legal_entity.
-- _min_level: 'read' | 'write' | 'approve' | 'admin'
CREATE OR REPLACE FUNCTION public.has_ravarer_access(_user_id UUID, _legal_entity_id UUID, _min_level public.access_level)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_positions up
    JOIN public.position_app_access paa ON paa.position_id = up.position_id
    JOIN public.apps a ON a.id = paa.app_id
    WHERE up.user_id = _user_id
      AND a.code = 'ravarer'
      AND up.legal_entity_id = _legal_entity_id
      AND paa.level >= _min_level
      AND (up.valid_to IS NULL OR up.valid_to >= CURRENT_DATE)
      AND up.valid_from <= CURRENT_DATE
  )
  OR public.is_ravarer_owner(_user_id);
$$;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_material_nutrition ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_material_allergens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_material_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_material_supplier_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_material_price_history ENABLE ROW LEVEL SECURITY;

-- SUPPLIERS
CREATE POLICY suppliers_select ON public.suppliers FOR SELECT
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY suppliers_insert ON public.suppliers FOR INSERT
  WITH CHECK (public.has_ravarer_access(auth.uid(), legal_entity_id, 'write') AND NOT public.is_ravarer_owner(auth.uid()) OR EXISTS(
    SELECT 1 FROM public.user_positions up JOIN public.position_app_access paa ON paa.position_id=up.position_id JOIN public.apps a ON a.id=paa.app_id
    WHERE up.user_id=auth.uid() AND a.code='ravarer' AND up.legal_entity_id=suppliers.legal_entity_id AND paa.level >= 'write'
  ));
CREATE POLICY suppliers_update ON public.suppliers FOR UPDATE
  USING (EXISTS(SELECT 1 FROM public.user_positions up JOIN public.position_app_access paa ON paa.position_id=up.position_id JOIN public.apps a ON a.id=paa.app_id
    WHERE up.user_id=auth.uid() AND a.code='ravarer' AND up.legal_entity_id=suppliers.legal_entity_id AND paa.level >= 'write'));
CREATE POLICY suppliers_delete ON public.suppliers FOR DELETE
  USING (EXISTS(SELECT 1 FROM public.user_positions up JOIN public.position_app_access paa ON paa.position_id=up.position_id JOIN public.apps a ON a.id=paa.app_id
    WHERE up.user_id=auth.uid() AND a.code='ravarer' AND up.legal_entity_id=suppliers.legal_entity_id AND paa.level >= 'admin'));

-- RAW MATERIALS
CREATE POLICY rm_select ON public.raw_materials FOR SELECT
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'));
CREATE POLICY rm_insert ON public.raw_materials FOR INSERT
  WITH CHECK (EXISTS(SELECT 1 FROM public.user_positions up JOIN public.position_app_access paa ON paa.position_id=up.position_id JOIN public.apps a ON a.id=paa.app_id
    WHERE up.user_id=auth.uid() AND a.code='ravarer' AND up.legal_entity_id=raw_materials.legal_entity_id AND paa.level >= 'write'));
CREATE POLICY rm_update ON public.raw_materials FOR UPDATE
  USING (EXISTS(SELECT 1 FROM public.user_positions up JOIN public.position_app_access paa ON paa.position_id=up.position_id JOIN public.apps a ON a.id=paa.app_id
    WHERE up.user_id=auth.uid() AND a.code='ravarer' AND up.legal_entity_id=raw_materials.legal_entity_id AND paa.level >= 'write'));
CREATE POLICY rm_delete ON public.raw_materials FOR DELETE
  USING (EXISTS(SELECT 1 FROM public.user_positions up JOIN public.position_app_access paa ON paa.position_id=up.position_id JOIN public.apps a ON a.id=paa.app_id
    WHERE up.user_id=auth.uid() AND a.code='ravarer' AND up.legal_entity_id=raw_materials.legal_entity_id AND paa.level >= 'admin'));

-- Felles helper for child-tabeller via parent raw_material
CREATE OR REPLACE FUNCTION public.rm_can_read(_rm_id UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_ravarer_access(auth.uid(), (SELECT legal_entity_id FROM public.raw_materials WHERE id=_rm_id), 'read')
$$;
CREATE OR REPLACE FUNCTION public.rm_can_write(_rm_id UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_positions up JOIN public.position_app_access paa ON paa.position_id=up.position_id JOIN public.apps a ON a.id=paa.app_id
    WHERE up.user_id=auth.uid() AND a.code='ravarer' AND up.legal_entity_id=(SELECT legal_entity_id FROM public.raw_materials WHERE id=_rm_id) AND paa.level >= 'write')
$$;

-- NUTRITION
CREATE POLICY nutr_select ON public.raw_material_nutrition FOR SELECT USING (public.rm_can_read(raw_material_id));
CREATE POLICY nutr_ins ON public.raw_material_nutrition FOR INSERT WITH CHECK (public.rm_can_write(raw_material_id));
CREATE POLICY nutr_upd ON public.raw_material_nutrition FOR UPDATE USING (public.rm_can_write(raw_material_id));
CREATE POLICY nutr_del ON public.raw_material_nutrition FOR DELETE USING (public.rm_can_write(raw_material_id));

-- ALLERGENS
CREATE POLICY alg_select ON public.raw_material_allergens FOR SELECT USING (public.rm_can_read(raw_material_id));
CREATE POLICY alg_ins ON public.raw_material_allergens FOR INSERT WITH CHECK (public.rm_can_write(raw_material_id));
CREATE POLICY alg_upd ON public.raw_material_allergens FOR UPDATE USING (public.rm_can_write(raw_material_id));
CREATE POLICY alg_del ON public.raw_material_allergens FOR DELETE USING (public.rm_can_write(raw_material_id));

-- RAW MATERIAL SUPPLIERS
CREATE POLICY rms_select ON public.raw_material_suppliers FOR SELECT USING (public.rm_can_read(raw_material_id));
CREATE POLICY rms_ins ON public.raw_material_suppliers FOR INSERT WITH CHECK (public.rm_can_write(raw_material_id));
CREATE POLICY rms_upd ON public.raw_material_suppliers FOR UPDATE USING (public.rm_can_write(raw_material_id));
CREATE POLICY rms_del ON public.raw_material_suppliers FOR DELETE USING (public.rm_can_write(raw_material_id));

-- ALIASES
CREATE POLICY ali_select ON public.raw_material_supplier_aliases FOR SELECT USING (
  public.rm_can_read((SELECT raw_material_id FROM public.raw_material_suppliers WHERE id = raw_material_supplier_id)));
CREATE POLICY ali_ins ON public.raw_material_supplier_aliases FOR INSERT WITH CHECK (
  public.rm_can_write((SELECT raw_material_id FROM public.raw_material_suppliers WHERE id = raw_material_supplier_id)));
CREATE POLICY ali_upd ON public.raw_material_supplier_aliases FOR UPDATE USING (
  public.rm_can_write((SELECT raw_material_id FROM public.raw_material_suppliers WHERE id = raw_material_supplier_id)));
CREATE POLICY ali_del ON public.raw_material_supplier_aliases FOR DELETE USING (
  public.rm_can_write((SELECT raw_material_id FROM public.raw_material_suppliers WHERE id = raw_material_supplier_id)));

-- PRICE HISTORY
CREATE POLICY ph_select ON public.raw_material_price_history FOR SELECT USING (public.rm_can_read(raw_material_id));
CREATE POLICY ph_ins ON public.raw_material_price_history FOR INSERT WITH CHECK (public.rm_can_write(raw_material_id));
CREATE POLICY ph_upd ON public.raw_material_price_history FOR UPDATE USING (public.rm_can_write(raw_material_id));
CREATE POLICY ph_del ON public.raw_material_price_history FOR DELETE USING (public.rm_can_write(raw_material_id));

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('raw-material-datasheets','raw-material-datasheets', false)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('supplier-agreements','supplier-agreements', false)
  ON CONFLICT (id) DO NOTHING;

-- Storage policies: any authenticated user with ravarer read in any LE may read; write requires write level.
-- Path convention: {legal_entity_id}/{...}
CREATE POLICY datasheets_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'raw-material-datasheets'
    AND public.has_ravarer_access(auth.uid(), ((storage.foldername(name))[1])::uuid, 'read'));
CREATE POLICY datasheets_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'raw-material-datasheets'
    AND EXISTS(SELECT 1 FROM public.user_positions up JOIN public.position_app_access paa ON paa.position_id=up.position_id JOIN public.apps a ON a.id=paa.app_id
      WHERE up.user_id=auth.uid() AND a.code='ravarer' AND up.legal_entity_id=((storage.foldername(name))[1])::uuid AND paa.level >= 'write'));
CREATE POLICY datasheets_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'raw-material-datasheets'
    AND EXISTS(SELECT 1 FROM public.user_positions up JOIN public.position_app_access paa ON paa.position_id=up.position_id JOIN public.apps a ON a.id=paa.app_id
      WHERE up.user_id=auth.uid() AND a.code='ravarer' AND up.legal_entity_id=((storage.foldername(name))[1])::uuid AND paa.level >= 'write'));
CREATE POLICY datasheets_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'raw-material-datasheets'
    AND EXISTS(SELECT 1 FROM public.user_positions up JOIN public.position_app_access paa ON paa.position_id=up.position_id JOIN public.apps a ON a.id=paa.app_id
      WHERE up.user_id=auth.uid() AND a.code='ravarer' AND up.legal_entity_id=((storage.foldername(name))[1])::uuid AND paa.level >= 'write'));

CREATE POLICY agreements_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'supplier-agreements'
    AND public.has_ravarer_access(auth.uid(), ((storage.foldername(name))[1])::uuid, 'read'));
CREATE POLICY agreements_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'supplier-agreements'
    AND EXISTS(SELECT 1 FROM public.user_positions up JOIN public.position_app_access paa ON paa.position_id=up.position_id JOIN public.apps a ON a.id=paa.app_id
      WHERE up.user_id=auth.uid() AND a.code='ravarer' AND up.legal_entity_id=((storage.foldername(name))[1])::uuid AND paa.level >= 'write'));
CREATE POLICY agreements_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'supplier-agreements'
    AND EXISTS(SELECT 1 FROM public.user_positions up JOIN public.position_app_access paa ON paa.position_id=up.position_id JOIN public.apps a ON a.id=paa.app_id
      WHERE up.user_id=auth.uid() AND a.code='ravarer' AND up.legal_entity_id=((storage.foldername(name))[1])::uuid AND paa.level >= 'write'));
CREATE POLICY agreements_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'supplier-agreements'
    AND EXISTS(SELECT 1 FROM public.user_positions up JOIN public.position_app_access paa ON paa.position_id=up.position_id JOIN public.apps a ON a.id=paa.app_id
      WHERE up.user_id=auth.uid() AND a.code='ravarer' AND up.legal_entity_id=((storage.foldername(name))[1])::uuid AND paa.level >= 'write'));

-- ============================================================
-- APPS: Sett ravarer som under utvikling
-- ============================================================
UPDATE public.apps SET status = 'in_development' WHERE code = 'ravarer';
