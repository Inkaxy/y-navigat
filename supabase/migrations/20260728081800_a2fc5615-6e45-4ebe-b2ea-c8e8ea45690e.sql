
-- Admin write policies on invoice_settings (only admin faktura-access can change)
CREATE POLICY invoice_settings_insert ON public.invoice_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    app_access_level('faktura'::text) = 'admin'::access_level
    AND has_position_in_entity(legal_entity_id)
  );

CREATE POLICY invoice_settings_update ON public.invoice_settings
  FOR UPDATE TO authenticated
  USING (
    app_access_level('faktura'::text) = 'admin'::access_level
    AND has_position_in_entity(legal_entity_id)
  )
  WITH CHECK (
    app_access_level('faktura'::text) = 'admin'::access_level
    AND has_position_in_entity(legal_entity_id)
  );

-- Audit trigger for endring av invoice_settings
CREATE OR REPLACE FUNCTION public._invoice_settings_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_log (
    actor_user_id, legal_entity_id, action, entity_type, entity_id, details
  ) VALUES (
    auth.uid(),
    NEW.legal_entity_id,
    CASE WHEN TG_OP = 'INSERT' THEN 'invoice_settings_created' ELSE 'invoice_settings_updated' END,
    'invoice_settings',
    NEW.legal_entity_id,
    jsonb_build_object(
      'default_due_days', NEW.default_due_days,
      'vat_account_map', NEW.vat_account_map,
      'non_transfer_groups', NEW.non_transfer_groups,
      'internal_groups', NEW.internal_groups
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_settings_audit ON public.invoice_settings;
CREATE TRIGGER trg_invoice_settings_audit
  AFTER INSERT OR UPDATE ON public.invoice_settings
  FOR EACH ROW EXECUTE FUNCTION public._invoice_settings_audit();

-- Clear Tripletex meta-cache (admin faktura only)
CREATE OR REPLACE FUNCTION public.clear_invoice_tripletex_meta(p_legal_entity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING errcode = '42501';
  END IF;
  IF app_access_level('faktura'::text) <> 'admin'::access_level
     OR NOT has_position_in_entity(p_legal_entity_id) THEN
    RAISE EXCEPTION 'No admin access to faktura' USING errcode = '42501';
  END IF;

  UPDATE public.invoice_settings
     SET tripletex_meta = '{}'::jsonb,
         updated_at = now()
   WHERE legal_entity_id = p_legal_entity_id;

  INSERT INTO public.audit_log (
    actor_user_id, legal_entity_id, action, entity_type, entity_id, details
  ) VALUES (
    auth.uid(), p_legal_entity_id, 'invoice_tripletex_meta_cleared',
    'invoice_settings', p_legal_entity_id, '{}'::jsonb
  );

  RETURN jsonb_build_object('cleared', true);
END;
$$;

REVOKE ALL ON FUNCTION public.clear_invoice_tripletex_meta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_invoice_tripletex_meta(uuid) TO authenticated;

-- Herding: sikre at ingen fakturaflyt-RPC er tilgjengelig for PUBLIC/anon
REVOKE ALL ON FUNCTION public.create_invoice_run(uuid, date, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_invoice_run(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_invoice_run_preview(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_run(uuid, date, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_invoice_run(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_invoice_run_preview(uuid, date) TO authenticated;
