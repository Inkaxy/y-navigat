
-- 1. Add declaration override fields on product_recipe_links
ALTER TABLE public.product_recipe_links
  ADD COLUMN IF NOT EXISTS declaration_mode public.declaration_mode,
  ADD COLUMN IF NOT EXISTS manual_ingredient_declaration text,
  ADD COLUMN IF NOT EXISTS manual_nutrition jsonb,
  ADD COLUMN IF NOT EXISTS manual_allergen_summary jsonb,
  ADD COLUMN IF NOT EXISTS declaration_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS declaration_updated_by uuid REFERENCES auth.users(id);

-- 2. Rename + drop old policies that depend on recipe_id
ALTER TABLE IF EXISTS public.recipe_declaration_overrides
  RENAME TO product_declaration_overrides;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='product_declaration_overrides' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.product_declaration_overrides', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.product_declaration_overrides
  ADD COLUMN IF NOT EXISTS product_recipe_link_id uuid REFERENCES public.product_recipe_links(id) ON DELETE CASCADE;

UPDATE public.product_declaration_overrides pdo
SET product_recipe_link_id = (
  SELECT id FROM public.product_recipe_links
  WHERE recipe_id = pdo.recipe_id
  ORDER BY is_primary DESC, created_at ASC
  LIMIT 1
)
WHERE product_recipe_link_id IS NULL;

DELETE FROM public.product_declaration_overrides WHERE product_recipe_link_id IS NULL;

ALTER TABLE public.product_declaration_overrides
  ALTER COLUMN product_recipe_link_id SET NOT NULL;

ALTER TABLE public.product_declaration_overrides
  DROP COLUMN IF EXISTS recipe_id;

CREATE INDEX IF NOT EXISTS idx_pdo_link ON public.product_declaration_overrides(product_recipe_link_id);

ALTER TABLE public.product_declaration_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pdo_select" ON public.product_declaration_overrides FOR SELECT
  USING (public.app_access_level('varer') <> 'none');
CREATE POLICY "pdo_write" ON public.product_declaration_overrides FOR ALL
  USING (public.app_access_level('varer') IN ('write','approve','admin'))
  WITH CHECK (public.app_access_level('varer') IN ('write','approve','admin'));

-- 3. Migrate manual declaration fields from recipes -> primary link
UPDATE public.product_recipe_links prl
SET declaration_mode = r.declaration_mode,
    manual_ingredient_declaration = r.manual_ingredient_declaration,
    manual_nutrition = r.manual_nutrition,
    manual_allergen_summary = r.manual_allergen_summary,
    declaration_updated_at = r.declaration_updated_at,
    declaration_updated_by = r.declaration_updated_by
FROM public.recipes r
WHERE r.id = prl.recipe_id
  AND prl.is_primary = true
  AND (
    r.declaration_mode IS DISTINCT FROM 'auto'::public.declaration_mode
    OR r.manual_ingredient_declaration IS NOT NULL
    OR r.manual_nutrition IS NOT NULL
    OR r.manual_allergen_summary IS NOT NULL
  );

-- 4. New view product_nutrition_calculated
DROP VIEW IF EXISTS public.product_nutrition_calculated;
CREATE VIEW public.product_nutrition_calculated AS
WITH all_lines AS (
  SELECT
    prl.id AS product_recipe_link_id,
    prl.product_id,
    prl.recipe_id,
    rl.raw_material_id,
    rl.quantity,
    rl.unit,
    COALESCE(rl.include_in_declaration, true) AS include_in_declaration,
    'master'::text AS source_type
  FROM public.product_recipe_links prl
  JOIN public.recipe_lines rl ON rl.recipe_id = prl.recipe_id
  UNION ALL
  SELECT
    prl.id,
    prl.product_id,
    prl.recipe_id,
    NULLIF(extra->>'raw_material_id','')::uuid,
    COALESCE((extra->>'quantity')::numeric, (extra->>'quantity_amount')::numeric, 0),
    COALESCE(extra->>'unit', extra->>'quantity_unit', 'g'),
    COALESCE((extra->>'include_in_declaration')::boolean, true),
    'extra'::text
  FROM public.product_recipe_links prl,
       jsonb_array_elements(COALESCE(prl.extra_lines, '[]'::jsonb)) AS extra
),
line_grams AS (
  SELECT al.*,
    CASE lower(al.unit)
      WHEN 'g'   THEN al.quantity
      WHEN 'kg'  THEN al.quantity * 1000
      WHEN 'ml'  THEN al.quantity
      WHEN 'cl'  THEN al.quantity * 10
      WHEN 'dl'  THEN al.quantity * 100
      WHEN 'l'   THEN al.quantity * 1000
      WHEN 'stk' THEN al.quantity * COALESCE(rm.unit_weight_grams, 0)
      ELSE NULL
    END AS grams
  FROM all_lines al
  LEFT JOIN public.raw_materials rm ON rm.id = al.raw_material_id
  WHERE al.include_in_declaration = true
),
totals AS (
  SELECT
    prl.id AS product_recipe_link_id,
    prl.product_id,
    COALESCE(prl.yield_weight_g_override, r.yield_grams) AS yield_grams,
    COALESCE(r.yield_loss_pct, 0) AS yield_loss_pct,
    SUM(lg.grams) AS total_input_grams,
    SUM(lg.grams / 100.0 * COALESCE(n.energy_kj, 0))        AS total_energy_kj,
    SUM(lg.grams / 100.0 * COALESCE(n.energy_kcal, 0))      AS total_energy_kcal,
    SUM(lg.grams / 100.0 * COALESCE(n.fat_g, 0))            AS total_fat_g,
    SUM(lg.grams / 100.0 * COALESCE(n.saturated_fat_g, 0))  AS total_saturated_fat_g,
    SUM(lg.grams / 100.0 * COALESCE(n.carbs_g, 0))          AS total_carbs_g,
    SUM(lg.grams / 100.0 * COALESCE(n.sugars_g, 0))         AS total_sugars_g,
    SUM(lg.grams / 100.0 * COALESCE(n.fiber_g, 0))          AS total_fiber_g,
    SUM(lg.grams / 100.0 * COALESCE(n.protein_g, 0))        AS total_protein_g,
    SUM(lg.grams / 100.0 * COALESCE(n.salt_g, 0))           AS total_salt_g,
    COUNT(lg.product_recipe_link_id) AS ingredient_count,
    COUNT(n.raw_material_id) AS ingredients_with_nutrition
  FROM public.product_recipe_links prl
  JOIN public.recipes r ON r.id = prl.recipe_id
  LEFT JOIN line_grams lg ON lg.product_recipe_link_id = prl.id
  LEFT JOIN public.raw_material_nutrition n ON n.raw_material_id = lg.raw_material_id
  GROUP BY prl.id, prl.product_id, prl.yield_weight_g_override, r.yield_grams, r.yield_loss_pct
)
SELECT
  product_recipe_link_id, product_id,
  ingredient_count, ingredients_with_nutrition, total_input_grams,
  COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) AS final_weight_grams,
  CASE WHEN COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) > 0
    THEN round(total_energy_kj / COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) * 100, 1) END AS energy_kj_per_100g,
  CASE WHEN COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) > 0
    THEN round(total_energy_kcal / COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) * 100, 1) END AS energy_kcal_per_100g,
  CASE WHEN COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) > 0
    THEN round(total_fat_g / COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) * 100, 2) END AS fat_g_per_100g,
  CASE WHEN COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) > 0
    THEN round(total_saturated_fat_g / COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) * 100, 2) END AS saturated_fat_g_per_100g,
  CASE WHEN COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) > 0
    THEN round(total_carbs_g / COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) * 100, 2) END AS carbs_g_per_100g,
  CASE WHEN COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) > 0
    THEN round(total_sugars_g / COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) * 100, 2) END AS sugars_g_per_100g,
  CASE WHEN COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) > 0
    THEN round(total_fiber_g / COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) * 100, 2) END AS fiber_g_per_100g,
  CASE WHEN COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) > 0
    THEN round(total_protein_g / COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) * 100, 2) END AS protein_g_per_100g,
  CASE WHEN COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) > 0
    THEN round(total_salt_g / COALESCE(yield_grams, total_input_grams * (1 - yield_loss_pct / 100.0)) * 100, 3) END AS salt_g_per_100g
FROM totals;
