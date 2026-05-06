
DROP POLICY IF EXISTS "supplier_agreements_select" ON storage.objects;
DROP POLICY IF EXISTS "supplier_agreements_insert" ON storage.objects;
DROP POLICY IF EXISTS "supplier_agreements_update" ON storage.objects;
DROP POLICY IF EXISTS "supplier_agreements_delete" ON storage.objects;

CREATE POLICY "supplier_agreements_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'supplier-agreements'
    AND public.has_ravarer_access(auth.uid(), ((storage.foldername(name))[1])::uuid, 'read'::public.access_level)
  );

CREATE POLICY "supplier_agreements_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'supplier-agreements'
    AND public.has_ravarer_access(auth.uid(), ((storage.foldername(name))[1])::uuid, 'write'::public.access_level)
  );

CREATE POLICY "supplier_agreements_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'supplier-agreements'
    AND public.has_ravarer_access(auth.uid(), ((storage.foldername(name))[1])::uuid, 'write'::public.access_level)
  );

CREATE POLICY "supplier_agreements_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'supplier-agreements'
    AND public.has_ravarer_access(auth.uid(), ((storage.foldername(name))[1])::uuid, 'write'::public.access_level)
  );
