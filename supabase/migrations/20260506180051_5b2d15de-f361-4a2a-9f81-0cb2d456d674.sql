
-- 1. Add new pricing/labor defaults to recipes
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS hourly_rate numeric NOT NULL DEFAULT 400,
  ADD COLUMN IF NOT EXISTS target_db_pct numeric NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS units_per_batch numeric,
  ADD COLUMN IF NOT EXISTS price_netto numeric,
  ADD COLUMN IF NOT EXISTS price_engros numeric,
  ADD COLUMN IF NOT EXISTS price_engros_with_packaging numeric,
  ADD COLUMN IF NOT EXISTS price_egne_utsalg numeric;

ALTER TABLE public.recipes ALTER COLUMN product_id DROP NOT NULL;

-- Add a friendly name on master recipes (fall back to product name when null)
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS legal_entity_id uuid;

-- Backfill legal_entity_id from product
UPDATE public.recipes r
SET legal_entity_id = p.legal_entity_id
FROM public.products p
WHERE r.product_id = p.id AND r.legal_entity_id IS NULL;

-- 2. recipe_labor_lines
CREATE TABLE IF NOT EXISTS public.recipe_labor_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  labor_type text NOT NULL,
  hours numeric NOT NULL DEFAULT 0,
  hourly_rate numeric,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rll_recipe ON public.recipe_labor_lines(recipe_id);
ALTER TABLE public.recipe_labor_lines ENABLE ROW LEVEL SECURITY;

-- 3. recipe_packaging_lines
CREATE TABLE IF NOT EXISTS public.recipe_packaging_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  name text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price_override numeric,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rpl_recipe ON public.recipe_packaging_lines(recipe_id);
ALTER TABLE public.recipe_packaging_lines ENABLE ROW LEVEL SECURITY;

-- 4. product_recipe_links
CREATE TABLE IF NOT EXISTS public.product_recipe_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT true,
  units_per_batch_override numeric,
  yield_weight_g_override numeric,
  extra_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  extra_packaging jsonb NOT NULL DEFAULT '[]'::jsonb,
  price_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, recipe_id)
);
CREATE INDEX IF NOT EXISTS idx_prl_product ON public.product_recipe_links(product_id);
CREATE INDEX IF NOT EXISTS idx_prl_recipe ON public.product_recipe_links(recipe_id);
ALTER TABLE public.product_recipe_links ENABLE ROW LEVEL SECURITY;

-- 5. Backfill product_recipe_links from existing recipes
INSERT INTO public.product_recipe_links (product_id, recipe_id, is_primary)
SELECT r.product_id, r.id, true
FROM public.recipes r
WHERE r.product_id IS NOT NULL
ON CONFLICT (product_id, recipe_id) DO NOTHING;

-- 6. Updated_at triggers
DROP TRIGGER IF EXISTS trg_rll_updated ON public.recipe_labor_lines;
CREATE TRIGGER trg_rll_updated BEFORE UPDATE ON public.recipe_labor_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_rpl_updated ON public.recipe_packaging_lines;
CREATE TRIGGER trg_rpl_updated BEFORE UPDATE ON public.recipe_packaging_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_prl_updated ON public.product_recipe_links;
CREATE TRIGGER trg_prl_updated BEFORE UPDATE ON public.product_recipe_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. RLS policies — mirror recipe_lines (anyone with varer access)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='recipe_lines' AND policyname='recipe_lines_select') THEN
    NULL;
  END IF;
END $$;

-- Generic permissive policies based on app_access_level for 'varer'
CREATE POLICY "rll_select" ON public.recipe_labor_lines FOR SELECT
  USING (public.app_access_level('varer') <> 'none');
CREATE POLICY "rll_write" ON public.recipe_labor_lines FOR ALL
  USING (public.app_access_level('varer') IN ('write','approve','admin'))
  WITH CHECK (public.app_access_level('varer') IN ('write','approve','admin'));

CREATE POLICY "rpl_select" ON public.recipe_packaging_lines FOR SELECT
  USING (public.app_access_level('varer') <> 'none');
CREATE POLICY "rpl_write" ON public.recipe_packaging_lines FOR ALL
  USING (public.app_access_level('varer') IN ('write','approve','admin'))
  WITH CHECK (public.app_access_level('varer') IN ('write','approve','admin'));

CREATE POLICY "prl_select" ON public.product_recipe_links FOR SELECT
  USING (public.app_access_level('varer') <> 'none');
CREATE POLICY "prl_write" ON public.product_recipe_links FOR ALL
  USING (public.app_access_level('varer') IN ('write','approve','admin'))
  WITH CHECK (public.app_access_level('varer') IN ('write','approve','admin'));
