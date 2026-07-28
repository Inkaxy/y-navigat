
-- 1) Columns on invoice_basis
ALTER TABLE public.invoice_basis
  ADD COLUMN IF NOT EXISTS attachment_path text,
  ADD COLUMN IF NOT EXISTS attachment_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS attachment_error text,
  ADD COLUMN IF NOT EXISTS attachment_uploaded_at timestamptz;

-- 2) Storage policies (bucket already created via storage_create_bucket tool)
-- SELECT: authenticated with faktura app access + position in the entity whose UUID is the first path segment.
DROP POLICY IF EXISTS invoice_attachments_select ON storage.objects;
CREATE POLICY invoice_attachments_select
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'invoice-attachments'
    AND public.app_access_level('faktura') <> 'none'::public.access_level
    AND public.has_position_in_entity(((storage.foldername(name))[1])::uuid)
  );

-- INSERT/UPDATE/DELETE: no authenticated policy → only service_role (which bypasses RLS) can write.
DROP POLICY IF EXISTS invoice_attachments_insert ON storage.objects;
DROP POLICY IF EXISTS invoice_attachments_update ON storage.objects;
DROP POLICY IF EXISTS invoice_attachments_delete ON storage.objects;
