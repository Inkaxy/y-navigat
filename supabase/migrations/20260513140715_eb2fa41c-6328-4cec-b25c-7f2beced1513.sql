CREATE OR REPLACE FUNCTION public.get_ordrekontor_assignees()
RETURNS TABLE(id uuid, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT u.id, COALESCE(u.display_name, '(uten navn)')
  FROM public.user_positions up
  JOIN public.positions p ON p.id = up.position_id
  JOIN public.users u ON u.id = up.user_id
  WHERE p.code = 'ordrekontor'
    AND u.status = 'active'
    AND up.valid_from <= CURRENT_DATE
    AND (up.valid_to IS NULL OR up.valid_to >= CURRENT_DATE)
  ORDER BY 2;
$$;

GRANT EXECUTE ON FUNCTION public.get_ordrekontor_assignees() TO authenticated;