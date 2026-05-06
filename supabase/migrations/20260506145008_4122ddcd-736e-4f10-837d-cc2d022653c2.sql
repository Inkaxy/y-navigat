
-- Helper function (idempotent)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN
  CREATE TYPE public.declaration_mode AS ENUM ('auto', 'manual', 'auto_with_overrides');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS unit_weight_grams numeric;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS packaging_cost_per_unit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS labor_cost_per_unit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS energy_cost_per_unit numeric NOT NULL DEFAULT 0;

ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS requires_cleanup boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS yield_grams numeric,
  ADD COLUMN IF NOT EXISTS yield_loss_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bulk_proof_minutes integer,
  ADD COLUMN IF NOT EXISTS shape_proof_minutes integer,
  ADD COLUMN IF NOT EXISTS bake_temp_celsius integer,
  ADD COLUMN IF NOT EXISTS bake_time_minutes integer,
  ADD COLUMN IF NOT EXISTS steam_seconds integer,
  ADD COLUMN IF NOT EXISTS cooling_minutes integer,
  ADD COLUMN IF NOT EXISTS production_notes text,
  ADD COLUMN IF NOT EXISTS declaration_mode public.declaration_mode NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS manual_ingredient_declaration text,
  ADD COLUMN IF NOT EXISTS manual_nutrition jsonb,
  ADD COLUMN IF NOT EXISTS manual_allergen_summary jsonb,
  ADD COLUMN IF NOT EXISTS declaration_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS declaration_updated_by uuid REFERENCES auth.users(id);

CREATE TABLE IF NOT EXISTS public.recipe_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  instructions text,
  prep_time_minutes integer,
  rest_time_minutes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recipe_parts_recipe ON public.recipe_parts(recipe_id, sort_order);
ALTER TABLE public.recipe_parts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recipe_parts_select_in_entity ON public.recipe_parts;
CREATE POLICY recipe_parts_select_in_entity ON public.recipe_parts FOR SELECT
USING (EXISTS (SELECT 1 FROM public.recipes r JOIN public.products p ON p.id = r.product_id
  WHERE r.id = recipe_parts.recipe_id AND (public.has_position_in_entity(p.legal_entity_id) OR public.is_platform_admin())));
DROP POLICY IF EXISTS recipe_parts_insert_write ON public.recipe_parts;
CREATE POLICY recipe_parts_insert_write ON public.recipe_parts FOR INSERT
WITH CHECK (public.has_app_write_access('varer') AND EXISTS (SELECT 1 FROM public.recipes r JOIN public.products p ON p.id = r.product_id
  WHERE r.id = recipe_parts.recipe_id AND public.has_position_in_entity(p.legal_entity_id)));
DROP POLICY IF EXISTS recipe_parts_update_write ON public.recipe_parts;
CREATE POLICY recipe_parts_update_write ON public.recipe_parts FOR UPDATE
USING (public.has_app_write_access('varer') AND EXISTS (SELECT 1 FROM public.recipes r JOIN public.products p ON p.id = r.product_id
  WHERE r.id = recipe_parts.recipe_id AND public.has_position_in_entity(p.legal_entity_id)))
WITH CHECK (public.has_app_write_access('varer') AND EXISTS (SELECT 1 FROM public.recipes r JOIN public.products p ON p.id = r.product_id
  WHERE r.id = recipe_parts.recipe_id AND public.has_position_in_entity(p.legal_entity_id)));
DROP POLICY IF EXISTS recipe_parts_delete_write ON public.recipe_parts;
CREATE POLICY recipe_parts_delete_write ON public.recipe_parts FOR DELETE
USING (public.has_app_write_access('varer') AND EXISTS (SELECT 1 FROM public.recipes r JOIN public.products p ON p.id = r.product_id
  WHERE r.id = recipe_parts.recipe_id AND public.has_position_in_entity(p.legal_entity_id)));

ALTER TABLE public.recipe_lines
  ADD COLUMN IF NOT EXISTS recipe_part_id uuid REFERENCES public.recipe_parts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS include_in_declaration boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_quid_relevant boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_declaration_text text;
ALTER TABLE public.recipe_lines ALTER COLUMN ingredient_name DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recipe_lines_part ON public.recipe_lines(recipe_part_id);
CREATE INDEX IF NOT EXISTS idx_recipe_lines_raw_material ON public.recipe_lines(raw_material_id);

CREATE TABLE IF NOT EXISTS public.recipe_declaration_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  override_value jsonb NOT NULL,
  reason text,
  set_by uuid REFERENCES auth.users(id),
  set_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, field_name)
);
ALTER TABLE public.recipe_declaration_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rdo_select ON public.recipe_declaration_overrides;
CREATE POLICY rdo_select ON public.recipe_declaration_overrides FOR SELECT
USING (EXISTS (SELECT 1 FROM public.recipes r JOIN public.products p ON p.id = r.product_id
  WHERE r.id = recipe_declaration_overrides.recipe_id AND (public.has_position_in_entity(p.legal_entity_id) OR public.is_platform_admin())));
DROP POLICY IF EXISTS rdo_write ON public.recipe_declaration_overrides;
CREATE POLICY rdo_write ON public.recipe_declaration_overrides FOR ALL
USING (public.has_app_write_access('varer') AND EXISTS (SELECT 1 FROM public.recipes r JOIN public.products p ON p.id = r.product_id
  WHERE r.id = recipe_declaration_overrides.recipe_id AND public.has_position_in_entity(p.legal_entity_id)))
WITH CHECK (public.has_app_write_access('varer') AND EXISTS (SELECT 1 FROM public.recipes r JOIN public.products p ON p.id = r.product_id
  WHERE r.id = recipe_declaration_overrides.recipe_id AND public.has_position_in_entity(p.legal_entity_id)));

CREATE TABLE IF NOT EXISTS public.legal_entity_margin_thresholds (
  legal_entity_id uuid PRIMARY KEY REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  critical_below_pct numeric NOT NULL DEFAULT 30,
  warning_below_pct numeric NOT NULL DEFAULT 50,
  target_above_pct numeric NOT NULL DEFAULT 60,
  warn_on_drop_pp numeric NOT NULL DEFAULT 5,
  warn_on_price_age_days integer NOT NULL DEFAULT 90,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.legal_entity_margin_thresholds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lemt_select ON public.legal_entity_margin_thresholds;
CREATE POLICY lemt_select ON public.legal_entity_margin_thresholds FOR SELECT
USING (public.has_position_in_entity(legal_entity_id) OR public.is_platform_admin());
DROP POLICY IF EXISTS lemt_write ON public.legal_entity_margin_thresholds;
CREATE POLICY lemt_write ON public.legal_entity_margin_thresholds FOR ALL
USING (public.has_app_write_access('varer') AND public.has_position_in_entity(legal_entity_id))
WITH CHECK (public.has_app_write_access('varer') AND public.has_position_in_entity(legal_entity_id));
INSERT INTO public.legal_entity_margin_thresholds (legal_entity_id)
SELECT id FROM public.legal_entities ON CONFLICT (legal_entity_id) DO NOTHING;

CREATE OR REPLACE VIEW public.recipe_nutrition_calculated AS
WITH line_grams AS (
  SELECT rl.id, rl.recipe_id, rl.raw_material_id,
    CASE lower(rl.unit)
      WHEN 'g' THEN rl.quantity
      WHEN 'kg' THEN rl.quantity * 1000
      WHEN 'ml' THEN rl.quantity
      WHEN 'cl' THEN rl.quantity * 10
      WHEN 'dl' THEN rl.quantity * 100
      WHEN 'l' THEN rl.quantity * 1000
      WHEN 'stk' THEN rl.quantity * COALESCE(rm.unit_weight_grams, 0)
      ELSE NULL END AS grams
  FROM public.recipe_lines rl
  LEFT JOIN public.raw_materials rm ON rm.id = rl.raw_material_id
  WHERE rl.include_in_declaration = true
),
recipe_totals AS (
  SELECT r.id AS recipe_id, r.yield_grams, COALESCE(r.yield_loss_pct, 0) AS yield_loss_pct,
    SUM(lg.grams) AS total_input_grams,
    SUM((lg.grams / 100.0) * COALESCE(n.energy_kj, 0)) AS total_energy_kj,
    SUM((lg.grams / 100.0) * COALESCE(n.energy_kcal, 0)) AS total_energy_kcal,
    SUM((lg.grams / 100.0) * COALESCE(n.fat_g, 0)) AS total_fat_g,
    SUM((lg.grams / 100.0) * COALESCE(n.saturated_fat_g, 0)) AS total_saturated_fat_g,
    SUM((lg.grams / 100.0) * COALESCE(n.carbs_g, 0)) AS total_carbs_g,
    SUM((lg.grams / 100.0) * COALESCE(n.sugars_g, 0)) AS total_sugars_g,
    SUM((lg.grams / 100.0) * COALESCE(n.fiber_g, 0)) AS total_fiber_g,
    SUM((lg.grams / 100.0) * COALESCE(n.protein_g, 0)) AS total_protein_g,
    SUM((lg.grams / 100.0) * COALESCE(n.salt_g, 0)) AS total_salt_g,
    COUNT(lg.id) AS ingredient_count,
    COUNT(n.raw_material_id) AS ingredients_with_nutrition
  FROM public.recipes r
  LEFT JOIN line_grams lg ON lg.recipe_id = r.id
  LEFT JOIN public.raw_material_nutrition n ON n.raw_material_id = lg.raw_material_id
  WHERE r.declaration_mode <> 'manual'
  GROUP BY r.id, r.yield_grams, r.yield_loss_pct
)
SELECT recipe_id, ingredient_count, ingredients_with_nutrition, total_input_grams,
  (total_input_grams * (1 - yield_loss_pct / 100.0)) AS final_weight_grams,
  CASE WHEN total_input_grams * (1 - yield_loss_pct / 100.0) > 0 THEN ROUND((total_energy_kj / (total_input_grams * (1 - yield_loss_pct / 100.0)) * 100)::numeric, 1) END AS energy_kj_per_100g,
  CASE WHEN total_input_grams * (1 - yield_loss_pct / 100.0) > 0 THEN ROUND((total_energy_kcal / (total_input_grams * (1 - yield_loss_pct / 100.0)) * 100)::numeric, 1) END AS energy_kcal_per_100g,
  CASE WHEN total_input_grams * (1 - yield_loss_pct / 100.0) > 0 THEN ROUND((total_fat_g / (total_input_grams * (1 - yield_loss_pct / 100.0)) * 100)::numeric, 2) END AS fat_g_per_100g,
  CASE WHEN total_input_grams * (1 - yield_loss_pct / 100.0) > 0 THEN ROUND((total_saturated_fat_g / (total_input_grams * (1 - yield_loss_pct / 100.0)) * 100)::numeric, 2) END AS saturated_fat_g_per_100g,
  CASE WHEN total_input_grams * (1 - yield_loss_pct / 100.0) > 0 THEN ROUND((total_carbs_g / (total_input_grams * (1 - yield_loss_pct / 100.0)) * 100)::numeric, 2) END AS carbs_g_per_100g,
  CASE WHEN total_input_grams * (1 - yield_loss_pct / 100.0) > 0 THEN ROUND((total_sugars_g / (total_input_grams * (1 - yield_loss_pct / 100.0)) * 100)::numeric, 2) END AS sugars_g_per_100g,
  CASE WHEN total_input_grams * (1 - yield_loss_pct / 100.0) > 0 THEN ROUND((total_fiber_g / (total_input_grams * (1 - yield_loss_pct / 100.0)) * 100)::numeric, 2) END AS fiber_g_per_100g,
  CASE WHEN total_input_grams * (1 - yield_loss_pct / 100.0) > 0 THEN ROUND((total_protein_g / (total_input_grams * (1 - yield_loss_pct / 100.0)) * 100)::numeric, 2) END AS protein_g_per_100g,
  CASE WHEN total_input_grams * (1 - yield_loss_pct / 100.0) > 0 THEN ROUND((total_salt_g / (total_input_grams * (1 - yield_loss_pct / 100.0)) * 100)::numeric, 3) END AS salt_g_per_100g
FROM recipe_totals;

DO $$
DECLARE rec RECORD; new_part_id uuid;
BEGIN
  FOR rec IN SELECT id FROM public.recipes WHERE NOT EXISTS (SELECT 1 FROM public.recipe_parts rp WHERE rp.recipe_id = recipes.id) LOOP
    INSERT INTO public.recipe_parts(recipe_id, name, sort_order) VALUES (rec.id, 'Hoveddel', 0) RETURNING id INTO new_part_id;
    UPDATE public.recipe_lines SET recipe_part_id = new_part_id WHERE recipe_id = rec.id AND recipe_part_id IS NULL;
  END LOOP;
END $$;

DO $$
DECLARE line_row RECORD; match_id uuid; match_score numeric; second_score numeric;
BEGIN
  FOR line_row IN
    SELECT rl2.id AS line_id, rl2.ingredient_name AS iname, p.legal_entity_id AS le_id
    FROM public.recipe_lines rl2
    JOIN public.recipes r ON r.id = rl2.recipe_id
    JOIN public.products p ON p.id = r.product_id
    WHERE rl2.raw_material_id IS NULL AND rl2.ingredient_name IS NOT NULL AND length(trim(rl2.ingredient_name)) > 1
  LOOP
    SELECT s.id, s.sim INTO match_id, match_score FROM (
      SELECT rm.id, similarity(rm.name, line_row.iname) AS sim FROM public.raw_materials rm
      WHERE rm.legal_entity_id = line_row.le_id AND rm.is_active = true ORDER BY sim DESC LIMIT 1
    ) s;
    SELECT s2.sim INTO second_score FROM (
      SELECT similarity(rm.name, line_row.iname) AS sim FROM public.raw_materials rm
      WHERE rm.legal_entity_id = line_row.le_id AND rm.is_active = true AND rm.id <> match_id ORDER BY sim DESC LIMIT 1
    ) s2;
    IF match_id IS NOT NULL AND match_score >= 0.7 AND (second_score IS NULL OR match_score - second_score >= 0.1) THEN
      UPDATE public.recipe_lines SET raw_material_id = match_id WHERE id = line_row.line_id;
    END IF;
  END LOOP;
END $$;

UPDATE public.recipes r SET requires_cleanup = true
WHERE EXISTS (SELECT 1 FROM public.recipe_lines rl WHERE rl.recipe_id = r.id AND rl.raw_material_id IS NULL);

UPDATE public.recipe_lines rl SET recipe_part_id = (
  SELECT id FROM public.recipe_parts rp WHERE rp.recipe_id = rl.recipe_id ORDER BY sort_order LIMIT 1
) WHERE recipe_part_id IS NULL;

ALTER TABLE public.recipe_lines ALTER COLUMN recipe_part_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.recipe_lines_update_cleanup_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid; unlinked_count integer;
BEGIN
  rid := COALESCE(NEW.recipe_id, OLD.recipe_id);
  SELECT COUNT(*) INTO unlinked_count FROM public.recipe_lines WHERE recipe_id = rid AND raw_material_id IS NULL;
  UPDATE public.recipes SET requires_cleanup = (unlinked_count > 0) WHERE id = rid;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_recipe_lines_cleanup ON public.recipe_lines;
CREATE TRIGGER trg_recipe_lines_cleanup
AFTER INSERT OR UPDATE OF raw_material_id OR DELETE ON public.recipe_lines
FOR EACH ROW EXECUTE FUNCTION public.recipe_lines_update_cleanup_flag();

DROP TRIGGER IF EXISTS trg_recipe_parts_updated ON public.recipe_parts;
CREATE TRIGGER trg_recipe_parts_updated
BEFORE UPDATE ON public.recipe_parts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
