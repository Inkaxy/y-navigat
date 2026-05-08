
-- 1. STORAGE: drop overlapping permissive policies on raw-material-datasheets bucket
DROP POLICY IF EXISTS "rmd_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "rmd_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "rmd_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "rmd_storage_delete" ON storage.objects;

-- 2. email_outbox: restrict SELECT to platform admins only
DROP POLICY IF EXISTS "Authenticated can read email_outbox" ON public.email_outbox;
CREATE POLICY "email_outbox_select_admin"
  ON public.email_outbox
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- 3. product_return_price_overrides: scope through products.legal_entity_id
DROP POLICY IF EXISTS "Authenticated users can view return price overrides" ON public.product_return_price_overrides;
DROP POLICY IF EXISTS "Authenticated users can insert return price overrides" ON public.product_return_price_overrides;
DROP POLICY IF EXISTS "Authenticated users can update return price overrides" ON public.product_return_price_overrides;
DROP POLICY IF EXISTS "Authenticated users can delete return price overrides" ON public.product_return_price_overrides;

CREATE POLICY "prpo_select_entity"
  ON public.product_return_price_overrides
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_return_price_overrides.product_id
        AND public.has_position_in_entity(p.legal_entity_id)
    )
  );

CREATE POLICY "prpo_insert_entity_write"
  ON public.product_return_price_overrides
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_app_write_access('varer')
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_return_price_overrides.product_id
        AND public.has_position_in_entity(p.legal_entity_id)
    )
  );

CREATE POLICY "prpo_update_entity_write"
  ON public.product_return_price_overrides
  FOR UPDATE
  TO authenticated
  USING (
    public.has_app_write_access('varer')
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_return_price_overrides.product_id
        AND public.has_position_in_entity(p.legal_entity_id)
    )
  )
  WITH CHECK (
    public.has_app_write_access('varer')
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_return_price_overrides.product_id
        AND public.has_position_in_entity(p.legal_entity_id)
    )
  );

CREATE POLICY "prpo_delete_entity_write"
  ON public.product_return_price_overrides
  FOR DELETE
  TO authenticated
  USING (
    public.has_app_write_access('varer')
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_return_price_overrides.product_id
        AND public.has_position_in_entity(p.legal_entity_id)
    )
  );

-- 4. cake_compatibility_rules: scope through cake_categories.legal_entity_id
DROP POLICY IF EXISTS "Authenticated kan lese kompatibilitetsregler" ON public.cake_compatibility_rules;
DROP POLICY IF EXISTS "Authenticated kan opprette kompatibilitetsregler" ON public.cake_compatibility_rules;
DROP POLICY IF EXISTS "Authenticated kan oppdatere kompatibilitetsregler" ON public.cake_compatibility_rules;
DROP POLICY IF EXISTS "Authenticated kan slette kompatibilitetsregler" ON public.cake_compatibility_rules;

CREATE POLICY "ccr_select_entity"
  ON public.cake_compatibility_rules
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cake_categories cc
      WHERE cc.id = cake_compatibility_rules.cake_category_id
        AND public.has_position_in_entity(cc.legal_entity_id)
    )
  );

CREATE POLICY "ccr_insert_entity_write"
  ON public.cake_compatibility_rules
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_app_write_access('varer')
    AND EXISTS (
      SELECT 1 FROM public.cake_categories cc
      WHERE cc.id = cake_compatibility_rules.cake_category_id
        AND public.has_position_in_entity(cc.legal_entity_id)
    )
  );

CREATE POLICY "ccr_update_entity_write"
  ON public.cake_compatibility_rules
  FOR UPDATE
  TO authenticated
  USING (
    public.has_app_write_access('varer')
    AND EXISTS (
      SELECT 1 FROM public.cake_categories cc
      WHERE cc.id = cake_compatibility_rules.cake_category_id
        AND public.has_position_in_entity(cc.legal_entity_id)
    )
  )
  WITH CHECK (
    public.has_app_write_access('varer')
    AND EXISTS (
      SELECT 1 FROM public.cake_categories cc
      WHERE cc.id = cake_compatibility_rules.cake_category_id
        AND public.has_position_in_entity(cc.legal_entity_id)
    )
  );

CREATE POLICY "ccr_delete_entity_write"
  ON public.cake_compatibility_rules
  FOR DELETE
  TO authenticated
  USING (
    public.has_app_write_access('varer')
    AND EXISTS (
      SELECT 1 FROM public.cake_categories cc
      WHERE cc.id = cake_compatibility_rules.cake_category_id
        AND public.has_position_in_entity(cc.legal_entity_id)
    )
  );

-- 5. legal_entities: scope SELECT to entities the user is in (or platform admin)
DROP POLICY IF EXISTS "legal_entities_select_authenticated" ON public.legal_entities;
CREATE POLICY "legal_entities_select_member"
  ON public.legal_entities
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR public.has_position_in_entity(id)
  );

-- 6. realtime.messages: only allow employees with at least one active position
DROP POLICY IF EXISTS "Authenticated users can read realtime messages" ON realtime.messages;
DROP POLICY IF EXISTS "Authenticated users can send realtime messages" ON realtime.messages;

CREATE POLICY "realtime_messages_select_employees"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_positions up
      WHERE up.user_id = auth.uid()
        AND up.valid_from <= current_date
        AND (up.valid_to IS NULL OR up.valid_to >= current_date)
    )
  );

CREATE POLICY "realtime_messages_insert_employees"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_positions up
      WHERE up.user_id = auth.uid()
        AND up.valid_from <= current_date
        AND (up.valid_to IS NULL OR up.valid_to >= current_date)
    )
  );
