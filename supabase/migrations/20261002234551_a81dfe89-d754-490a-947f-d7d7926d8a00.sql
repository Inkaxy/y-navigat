DROP POLICY IF EXISTS "matvaretabellen_read" ON public.matvaretabellen_foods;
CREATE POLICY "matvaretabellen_read_app_users" ON public.matvaretabellen_foods
  FOR SELECT TO authenticated
  USING (public.app_access_level('ravarer') <> 'none' OR public.app_access_level('varer') <> 'none');

DROP POLICY IF EXISTS "ptc_select_authenticated" ON public.production_template_categories;
CREATE POLICY "ptc_select_produksjon_users" ON public.production_template_categories
  FOR SELECT TO authenticated
  USING (public.app_access_level('produksjon') <> 'none');