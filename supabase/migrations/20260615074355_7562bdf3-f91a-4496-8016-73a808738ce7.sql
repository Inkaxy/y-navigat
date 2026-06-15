CREATE POLICY pickup_locations_select_pos_active
ON public.pickup_locations FOR SELECT
TO anon, authenticated
USING (status = 'active');

GRANT SELECT ON public.pickup_locations TO anon;