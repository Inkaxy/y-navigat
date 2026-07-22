
DROP POLICY IF EXISTS refunds_insert ON public.refunds;
DROP POLICY IF EXISTS refunds_update ON public.refunds;

CREATE POLICY refunds_insert ON public.refunds
  FOR INSERT TO authenticated
  WITH CHECK (public.has_app_write_access('ordre'));

CREATE POLICY refunds_update ON public.refunds
  FOR UPDATE TO authenticated
  USING (public.has_app_write_access('ordre'))
  WITH CHECK (public.has_app_write_access('ordre'));
