ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS manual_ingredient_declaration text,
  ADD COLUMN IF NOT EXISTS manual_allergens_contains text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS manual_allergens_may_contain text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS manual_nutrition_per_100g jsonb,
  ADD COLUMN IF NOT EXISTS manual_declaration_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_declaration_updated_by uuid;