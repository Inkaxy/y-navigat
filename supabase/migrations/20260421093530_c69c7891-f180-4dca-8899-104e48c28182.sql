-- 1. Add color_hex column to apps
ALTER TABLE public.apps
  ADD COLUMN IF NOT EXISTS color_hex TEXT NOT NULL DEFAULT '#64748b';

-- 2. Seed colors for known app codes (only updates rows that exist)
UPDATE public.apps SET color_hex = '#475569' WHERE code = 'nbos';
UPDATE public.apps SET color_hex = '#0ea5e9' WHERE code = 'nbhub';
UPDATE public.apps SET color_hex = '#f59e0b' WHERE code = 'ordre';
UPDATE public.apps SET color_hex = '#8b5cf6' WHERE code = 'kunder';
UPDATE public.apps SET color_hex = '#10b981' WHERE code = 'varer';
UPDATE public.apps SET color_hex = '#84cc16' WHERE code = 'ravarer';
UPDATE public.apps SET color_hex = '#ef4444' WHERE code = 'produksjon';
UPDATE public.apps SET color_hex = '#06b6d4' WHERE code = 'lager';
UPDATE public.apps SET color_hex = '#a855f7' WHERE code = 'faktura';
UPDATE public.apps SET color_hex = '#f97316' WHERE code = 'salg';
UPDATE public.apps SET color_hex = '#ec4899' WHERE code = 'kampanje';
UPDATE public.apps SET color_hex = '#6366f1' WHERE code = 'nbanalyse';
UPDATE public.apps SET color_hex = '#14b8a6' WHERE code = 'bemanning';
UPDATE public.apps SET color_hex = '#78716c' WHERE code = 'internkontroll';
UPDATE public.apps SET color_hex = '#d946ef' WHERE code = 'hr';
UPDATE public.apps SET color_hex = '#3b82f6' WHERE code = 'publikum';

-- 3. Update get_my_accessible_apps() to include color_hex
-- We must DROP first since the return signature changes (new column added).
DROP FUNCTION IF EXISTS public.get_my_accessible_apps();

CREATE OR REPLACE FUNCTION public.get_my_accessible_apps()
RETURNS TABLE (
  id uuid,
  slug text,
  display_name text,
  category text,
  deploy_url text,
  start_path text,
  icon_name text,
  sort_order integer,
  status text,
  color_hex text,
  access_level public.access_level
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (a.id)
    a.id,
    a.code AS slug,
    a.display_name,
    a.category,
    a.deploy_url,
    a.start_path,
    a.icon AS icon_name,
    a.sort_order,
    a.status,
    a.color_hex,
    paa.level AS access_level
  FROM public.apps a
  JOIN public.position_app_access paa ON paa.app_id = a.id
  JOIN public.user_positions up ON up.position_id = paa.position_id
  WHERE up.user_id = auth.uid()
    AND paa.level <> 'none'::public.access_level
    AND a.status IN ('active', 'beta')
  ORDER BY a.id, paa.level DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_accessible_apps() TO authenticated;