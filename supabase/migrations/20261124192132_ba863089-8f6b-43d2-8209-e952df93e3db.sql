DROP POLICY IF EXISTS positions_select_authenticated ON public.positions;
CREATE POLICY positions_select_internal ON public.positions
  FOR SELECT TO authenticated
  USING (public.is_internal_user() OR public.is_platform_admin());