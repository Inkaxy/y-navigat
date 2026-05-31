
-- 1. ai_call_log: scope to authenticated
DROP POLICY IF EXISTS ai_call_log_select_ordre ON public.ai_call_log;
CREATE POLICY ai_call_log_select_ordre ON public.ai_call_log
  FOR SELECT TO authenticated
  USING (has_ordre_settings_access());

-- 2. platform_settings ordre_ai: scope to authenticated
DROP POLICY IF EXISTS platform_settings_select_ordre_ai ON public.platform_settings;
CREATE POLICY platform_settings_select_ordre_ai ON public.platform_settings
  FOR SELECT TO authenticated
  USING (category = 'ordre_ai' AND has_ordre_settings_access());

DROP POLICY IF EXISTS platform_settings_insert_ordre_ai ON public.platform_settings;
CREATE POLICY platform_settings_insert_ordre_ai ON public.platform_settings
  FOR INSERT TO authenticated
  WITH CHECK (category = 'ordre_ai' AND has_ordre_settings_access());

DROP POLICY IF EXISTS platform_settings_update_ordre_ai ON public.platform_settings;
CREATE POLICY platform_settings_update_ordre_ai ON public.platform_settings
  FOR UPDATE TO authenticated
  USING (category = 'ordre_ai' AND has_ordre_settings_access())
  WITH CHECK (category = 'ordre_ai' AND has_ordre_settings_access());

-- 3. pos_operators: scope SELECT to authenticated, and revoke pin_hash column access
DROP POLICY IF EXISTS pos_operators_select ON public.pos_operators;
CREATE POLICY pos_operators_select ON public.pos_operators
  FOR SELECT TO authenticated
  USING (is_platform_admin() OR (has_position_in_entity(legal_entity_id) AND (app_access_level('pos_styring') <> 'none'::access_level)));

REVOKE SELECT (pin_hash) ON public.pos_operators FROM anon, authenticated;

-- 4. negotiation_recipients: revoke sensitive columns from anon/authenticated SELECT
REVOKE SELECT (access_token, password_hash, password_expires_at, failed_attempts)
  ON public.negotiation_recipients FROM anon, authenticated;

-- 5. label-logos storage: require has_app_write_access('varer') for writes
DROP POLICY IF EXISTS label_logos_entity_insert ON storage.objects;
CREATE POLICY label_logos_entity_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'label-logos'
    AND has_position_in_entity(((storage.foldername(name))[1])::uuid)
    AND has_app_write_access('varer')
  );

DROP POLICY IF EXISTS label_logos_entity_update ON storage.objects;
CREATE POLICY label_logos_entity_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'label-logos'
    AND has_position_in_entity(((storage.foldername(name))[1])::uuid)
    AND has_app_write_access('varer')
  )
  WITH CHECK (
    bucket_id = 'label-logos'
    AND has_position_in_entity(((storage.foldername(name))[1])::uuid)
    AND has_app_write_access('varer')
  );

DROP POLICY IF EXISTS label_logos_entity_delete ON storage.objects;
CREATE POLICY label_logos_entity_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'label-logos'
    AND has_position_in_entity(((storage.foldername(name))[1])::uuid)
    AND has_app_write_access('varer')
  );
