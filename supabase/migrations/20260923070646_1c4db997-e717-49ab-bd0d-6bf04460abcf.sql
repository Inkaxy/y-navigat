DROP POLICY IF EXISTS rmcfg_select_authenticated ON public.raw_material_category_food_groups;

CREATE POLICY rmcfg_select_ravarer_users
ON public.raw_material_category_food_groups
FOR SELECT
TO authenticated
USING (public.app_access_level('ravarer') <> 'none'::public.access_level);