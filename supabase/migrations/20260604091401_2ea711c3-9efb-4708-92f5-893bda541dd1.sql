CREATE OR REPLACE FUNCTION public.get_apps_for_entity(entity_id uuid)
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
    AND up.legal_entity_id = entity_id
    AND up.valid_from <= current_date
    AND (up.valid_to IS NULL OR up.valid_to >= current_date)
    AND paa.level <> 'none'::public.access_level
    AND a.status IN ('active', 'beta', 'in_development')
    AND NOT EXISTS (
      SELECT 1
      FROM public.legal_entity_app_access lea
      WHERE lea.app_id = a.id
        AND lea.legal_entity_id = entity_id
        AND lea.enabled = false
    )
  ORDER BY a.id, paa.level DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_apps_for_entity(uuid) TO authenticated;