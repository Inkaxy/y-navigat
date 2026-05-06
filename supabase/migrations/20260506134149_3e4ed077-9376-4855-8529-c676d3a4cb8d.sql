DROP POLICY IF EXISTS invoice_pdfs_insert ON storage.objects;
DROP POLICY IF EXISTS invoice_pdfs_select ON storage.objects;

CREATE POLICY invoice_pdfs_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'invoice-pdfs'
  AND public.has_ravarer_invoice_access(((storage.foldername(name))[1])::uuid, 'write')
);

CREATE POLICY invoice_pdfs_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'invoice-pdfs'
  AND public.has_ravarer_invoice_access(((storage.foldername(name))[1])::uuid, 'read')
);