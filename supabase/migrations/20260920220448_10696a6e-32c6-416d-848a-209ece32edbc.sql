ALTER TABLE public.product_recipe_links
  ADD COLUMN IF NOT EXISTS sales_unit_basis text,
  ADD COLUMN IF NOT EXISTS units_per_sales_unit numeric,
  ADD COLUMN IF NOT EXISTS sales_unit_weight_g numeric,
  ADD COLUMN IF NOT EXISTS sales_unit_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sales_unit_confirmed_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_recipe_links_sales_unit_basis_chk'
  ) THEN
    ALTER TABLE public.product_recipe_links
      ADD CONSTRAINT product_recipe_links_sales_unit_basis_chk
      CHECK (sales_unit_basis IS NULL OR sales_unit_basis IN ('stk','vekt','flerpakk'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_recipe_links_units_per_sales_unit_chk'
  ) THEN
    ALTER TABLE public.product_recipe_links
      ADD CONSTRAINT product_recipe_links_units_per_sales_unit_chk
      CHECK (units_per_sales_unit IS NULL OR units_per_sales_unit > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_recipe_links_sales_unit_weight_chk'
  ) THEN
    ALTER TABLE public.product_recipe_links
      ADD CONSTRAINT product_recipe_links_sales_unit_weight_chk
      CHECK (sales_unit_weight_g IS NULL OR sales_unit_weight_g > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.product_recipe_links.sales_unit_basis IS 'Hvordan oppskriftens utbytte svarer til varens salgsenhet: stk | vekt | flerpakk. Bekreftes manuelt, utledes aldri fra varenavn.';
COMMENT ON COLUMN public.product_recipe_links.units_per_sales_unit IS 'Antall emner fra oppskriften per salgsenhet (f.eks. 8 boller per pakke).';
COMMENT ON COLUMN public.product_recipe_links.sales_unit_weight_g IS 'Bekreftet vekt per salgsenhet i gram, brukt når salgsenheten er vektbasert.';