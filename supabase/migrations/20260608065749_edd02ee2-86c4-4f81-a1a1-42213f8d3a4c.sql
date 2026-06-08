
-- 1. label_print_jobs UPDATE
DROP POLICY IF EXISTS label_print_jobs_update ON public.label_print_jobs;
CREATE POLICY label_print_jobs_update ON public.label_print_jobs
  FOR UPDATE
  USING (has_position_in_entity(legal_entity_id) AND has_app_write_access('produksjon'))
  WITH CHECK (has_position_in_entity(legal_entity_id) AND has_app_write_access('produksjon'));

-- 2. label_print_profiles UPDATE
DROP POLICY IF EXISTS label_print_profiles_update ON public.label_print_profiles;
CREATE POLICY label_print_profiles_update ON public.label_print_profiles
  FOR UPDATE
  USING ((has_position_in_entity(legal_entity_id) AND has_app_write_access('produksjon')) OR is_platform_admin())
  WITH CHECK ((has_position_in_entity(legal_entity_id) AND has_app_write_access('produksjon')) OR is_platform_admin());

-- 3. packing_areas
DROP POLICY IF EXISTS packing_areas_insert ON public.packing_areas;
CREATE POLICY packing_areas_insert ON public.packing_areas
  FOR INSERT
  WITH CHECK ((has_position_in_entity(legal_entity_id) AND has_app_write_access('produksjon')) OR is_platform_admin());

DROP POLICY IF EXISTS packing_areas_update ON public.packing_areas;
CREATE POLICY packing_areas_update ON public.packing_areas
  FOR UPDATE
  USING ((has_position_in_entity(legal_entity_id) AND has_app_write_access('produksjon')) OR is_platform_admin())
  WITH CHECK ((has_position_in_entity(legal_entity_id) AND has_app_write_access('produksjon')) OR is_platform_admin());

DROP POLICY IF EXISTS packing_areas_delete ON public.packing_areas;
CREATE POLICY packing_areas_delete ON public.packing_areas
  FOR DELETE
  USING ((has_position_in_entity(legal_entity_id) AND has_app_write_access('produksjon')) OR is_platform_admin());

-- 4. product_packing_areas
DROP POLICY IF EXISTS ppa_insert ON public.product_packing_areas;
CREATE POLICY ppa_insert ON public.product_packing_areas
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM packing_areas pa
    WHERE pa.id = product_packing_areas.packing_area_id
      AND ((has_position_in_entity(pa.legal_entity_id) AND has_app_write_access('produksjon')) OR is_platform_admin())
  ));

DROP POLICY IF EXISTS ppa_update ON public.product_packing_areas;
CREATE POLICY ppa_update ON public.product_packing_areas
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM packing_areas pa
    WHERE pa.id = product_packing_areas.packing_area_id
      AND ((has_position_in_entity(pa.legal_entity_id) AND has_app_write_access('produksjon')) OR is_platform_admin())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM packing_areas pa
    WHERE pa.id = product_packing_areas.packing_area_id
      AND ((has_position_in_entity(pa.legal_entity_id) AND has_app_write_access('produksjon')) OR is_platform_admin())
  ));

DROP POLICY IF EXISTS ppa_delete ON public.product_packing_areas;
CREATE POLICY ppa_delete ON public.product_packing_areas
  FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM packing_areas pa
    WHERE pa.id = product_packing_areas.packing_area_id
      AND ((has_position_in_entity(pa.legal_entity_id) AND has_app_write_access('produksjon')) OR is_platform_admin())
  ));

-- 5. order_confirmations_sent
DROP POLICY IF EXISTS ordre_read_confirmations ON public.order_confirmations_sent;
CREATE POLICY ordre_read_confirmations ON public.order_confirmations_sent
  FOR SELECT
  USING (
    has_app_write_access('ordre')
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_confirmations_sent.order_id
        AND has_position_in_entity(o.legal_entity_id)
    )
  );

DROP POLICY IF EXISTS ordre_insert_confirmations ON public.order_confirmations_sent;
CREATE POLICY ordre_insert_confirmations ON public.order_confirmations_sent
  FOR INSERT
  WITH CHECK (
    has_app_write_access('ordre')
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_confirmations_sent.order_id
        AND has_position_in_entity(o.legal_entity_id)
    )
  );

-- 6. negotiation_recipients: hide credential columns
REVOKE SELECT ON public.negotiation_recipients FROM authenticated;
GRANT SELECT (
  id, negotiation_id, supplier_id, contact_email, contact_name,
  password_set_at, password_expires_at, status, invited_at,
  first_viewed_at, last_viewed_at, responded_at, expires_at,
  created_at, updated_at
) ON public.negotiation_recipients TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.negotiation_recipients TO authenticated;

-- 7. pos_operators: hide pin_hash
REVOKE SELECT ON public.pos_operators FROM authenticated;
GRANT SELECT (
  id, legal_entity_id, user_id, operator_code, display_name,
  status, last_login_at, created_at, updated_at
) ON public.pos_operators TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.pos_operators TO authenticated;
