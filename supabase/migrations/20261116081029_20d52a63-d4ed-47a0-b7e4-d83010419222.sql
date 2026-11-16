DROP POLICY IF EXISTS "widget_registry_select_authenticated" ON public.widget_registry;

CREATE POLICY "widget_registry_select_app_access"
ON public.widget_registry
FOR SELECT
TO authenticated
USING (
  public.is_platform_admin()
  OR required_app_code IS NULL
  OR public.app_access_level(required_app_code) <> 'none'::public.access_level
);