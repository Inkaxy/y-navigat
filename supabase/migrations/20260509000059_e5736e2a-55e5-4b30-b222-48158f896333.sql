ALTER TABLE public.raw_materials
  ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}';

UPDATE public.raw_materials
  SET categories = ARRAY[category]
  WHERE category IS NOT NULL
    AND (categories IS NULL OR cardinality(categories) = 0);

CREATE INDEX IF NOT EXISTS raw_materials_categories_gin
  ON public.raw_materials USING GIN (categories);