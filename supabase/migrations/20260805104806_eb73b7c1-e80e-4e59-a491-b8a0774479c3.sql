DROP POLICY IF EXISTS outlets_select_authenticated ON public.outlets;
CREATE POLICY outlets_select_scoped ON public.outlets
FOR SELECT TO authenticated
USING (public.has_position_in_entity(legal_entity_id) OR public.is_platform_admin());