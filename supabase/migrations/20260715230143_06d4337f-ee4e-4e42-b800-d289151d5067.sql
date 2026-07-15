
CREATE OR REPLACE FUNCTION public.user_outlet_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT DISTINCT unnest(up.outlet_ids)
      FROM public.user_positions up
      WHERE up.user_id = auth.uid()
        AND up.outlet_scope = 'specific'
        AND up.valid_from <= current_date
        AND (up.valid_to IS NULL OR up.valid_to >= current_date)
    ),
    ARRAY[]::uuid[]
  )
$$;

CREATE OR REPLACE FUNCTION public.is_ordre_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.app_access_level('ordre'::text) = 'admin'::public.access_level
$$;

DROP POLICY IF EXISTS refunds_select ON public.refunds;
CREATE POLICY refunds_select ON public.refunds
  FOR SELECT TO authenticated
  USING (
    public.is_ordre_admin()
    OR (outlet_id IS NOT NULL AND outlet_id = ANY(public.user_outlet_ids()))
    OR (route = 'okonomi' AND EXISTS (
      SELECT 1 FROM public.user_team_memberships utm
      WHERE utm.user_id = auth.uid() AND utm.team = 'admin'::public.ticket_team
    ))
    OR created_by = auth.uid()
  );
