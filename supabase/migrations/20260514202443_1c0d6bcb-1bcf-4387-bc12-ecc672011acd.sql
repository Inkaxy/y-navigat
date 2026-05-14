
-- ============================================================
-- 1) STORAGE: invoice-ehf-xml — entity-scoped policies
--    Path-konvensjon: <legal_entity_id>/<filename>
-- ============================================================
DROP POLICY IF EXISTS "invoice_ehf_select" ON storage.objects;
DROP POLICY IF EXISTS "invoice_ehf_insert" ON storage.objects;
DROP POLICY IF EXISTS "invoice_ehf_update" ON storage.objects;
DROP POLICY IF EXISTS "invoice_ehf_delete" ON storage.objects;

CREATE POLICY "invoice_ehf_select_le_scoped"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'invoice-ehf-xml'
  AND public.has_ravarer_invoice_access(((storage.foldername(name))[1])::uuid, 'read')
);

CREATE POLICY "invoice_ehf_insert_le_scoped"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'invoice-ehf-xml'
  AND public.has_ravarer_invoice_access(((storage.foldername(name))[1])::uuid, 'write')
);

CREATE POLICY "invoice_ehf_update_le_scoped"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'invoice-ehf-xml'
  AND public.has_ravarer_invoice_access(((storage.foldername(name))[1])::uuid, 'write')
)
WITH CHECK (
  bucket_id = 'invoice-ehf-xml'
  AND public.has_ravarer_invoice_access(((storage.foldername(name))[1])::uuid, 'write')
);

CREATE POLICY "invoice_ehf_delete_le_scoped"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'invoice-ehf-xml'
  AND public.has_ravarer_invoice_access(((storage.foldername(name))[1])::uuid, 'admin')
);

-- ============================================================
-- 2) STORAGE: declaration-uploads — entity-scoped policies
--    Ny path-konvensjon: <legal_entity_id>/<product_id>/<file>.pdf
-- ============================================================
DROP POLICY IF EXISTS "declaration-uploads varer read" ON storage.objects;
DROP POLICY IF EXISTS "declaration-uploads varer insert" ON storage.objects;
DROP POLICY IF EXISTS "declaration-uploads varer delete" ON storage.objects;

CREATE POLICY "declaration_uploads_select_le_scoped"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'declaration-uploads'
  AND public.has_position_in_entity(((storage.foldername(name))[1])::uuid)
  AND public.has_app_write_access('varer')
);

CREATE POLICY "declaration_uploads_insert_le_scoped"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'declaration-uploads'
  AND public.has_position_in_entity(((storage.foldername(name))[1])::uuid)
  AND public.has_app_write_access('varer')
);

CREATE POLICY "declaration_uploads_delete_le_scoped"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'declaration-uploads'
  AND public.has_position_in_entity(((storage.foldername(name))[1])::uuid)
  AND public.has_app_write_access('varer')
);

-- ============================================================
-- 3) Column-level REVOKE — pos_operators.pin_hash
-- ============================================================
REVOKE SELECT (pin_hash) ON public.pos_operators FROM authenticated;
REVOKE SELECT (pin_hash) ON public.pos_operators FROM anon;

-- ============================================================
-- 4) Column-level REVOKE — tripletex_credentials tokens
-- ============================================================
REVOKE SELECT (consumer_token_encrypted, employee_token_encrypted, session_token)
  ON public.tripletex_credentials FROM authenticated;
REVOKE SELECT (consumer_token_encrypted, employee_token_encrypted, session_token)
  ON public.tripletex_credentials FROM anon;

-- Helper: lar UI sjekke om tokens finnes uten å lese dem
CREATE OR REPLACE FUNCTION public.tripletex_token_status(_legal_entity_id uuid)
RETURNS TABLE (has_consumer_token boolean, has_employee_token boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (consumer_token_encrypted IS NOT NULL AND consumer_token_encrypted <> '') AS has_consumer_token,
    (employee_token_encrypted IS NOT NULL AND employee_token_encrypted <> '') AS has_employee_token
  FROM public.tripletex_credentials
  WHERE legal_entity_id = _legal_entity_id
    AND public.has_ravarer_invoice_access(_legal_entity_id, 'admin')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.tripletex_token_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tripletex_token_status(uuid) TO authenticated;

-- ============================================================
-- 5) Column-level REVOKE — negotiation_recipients credentials
-- ============================================================
REVOKE SELECT (access_token, password_hash)
  ON public.negotiation_recipients FROM authenticated;
REVOKE SELECT (access_token, password_hash)
  ON public.negotiation_recipients FROM anon;
