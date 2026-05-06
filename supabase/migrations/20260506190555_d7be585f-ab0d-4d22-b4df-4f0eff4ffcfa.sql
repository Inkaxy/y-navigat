
-- 1. raw_materials: composite + grain classification
ALTER TABLE public.raw_materials
  ADD COLUMN IF NOT EXISTS is_composite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS components_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS grain_classification text;

ALTER TABLE public.raw_materials
  DROP CONSTRAINT IF EXISTS raw_materials_grain_classification_check;
ALTER TABLE public.raw_materials
  ADD CONSTRAINT raw_materials_grain_classification_check CHECK (
    grain_classification IS NULL OR grain_classification IN (
      'sifted_flour','whole_grain_flour','whole_grains','wheat_bran','rye_bran','oat_bran',
      'gluten_free_grain','other_flour','not_grain'
    )
  );

-- 2. raw_material_components
CREATE TABLE IF NOT EXISTS public.raw_material_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  component_raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
  primary_ingredient_name text,
  percentage numeric NOT NULL CHECK (percentage > 0 AND percentage <= 100),
  is_explicit_percentage boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  allergens public.allergen_type[],
  is_quid_relevant boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (component_raw_material_id IS NOT NULL AND primary_ingredient_name IS NULL) OR
    (component_raw_material_id IS NULL AND primary_ingredient_name IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_rmc_parent ON public.raw_material_components(parent_raw_material_id, sort_order);
ALTER TABLE public.raw_material_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rmc_select" ON public.raw_material_components FOR SELECT
  USING (public.app_access_level('varer') <> 'none');
CREATE POLICY "rmc_write" ON public.raw_material_components FOR ALL
  USING (public.app_access_level('varer') IN ('write','approve','admin'))
  WITH CHECK (public.app_access_level('varer') IN ('write','approve','admin'));

-- 3. products + legal_entities: breadscale toggles
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS show_breadscale boolean;

ALTER TABLE public.legal_entities
  ADD COLUMN IF NOT EXISTS breadscale_default_enabled boolean NOT NULL DEFAULT false;

-- 4. recipe_grain_score cache
CREATE TABLE IF NOT EXISTS public.recipe_grain_score (
  product_recipe_link_id uuid PRIMARY KEY REFERENCES public.product_recipe_links(id) ON DELETE CASCADE,
  total_flour_grams numeric,
  coarse_grams_weighted numeric,
  grain_score_pct numeric,
  category text,
  classification_complete boolean,
  unclassified_count integer NOT NULL DEFAULT 0,
  unclassified_names text[],
  computed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recipe_grain_score ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rgs_select" ON public.recipe_grain_score FOR SELECT
  USING (public.app_access_level('varer') <> 'none');
CREATE POLICY "rgs_write" ON public.recipe_grain_score FOR ALL
  USING (public.app_access_level('varer') IN ('write','approve','admin'))
  WITH CHECK (public.app_access_level('varer') IN ('write','approve','admin'));
