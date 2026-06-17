
CREATE TABLE IF NOT EXISTS public.cake_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL,
  delivery_date date NOT NULL DEFAULT CURRENT_DATE,
  title text NOT NULL DEFAULT 'Kakebilde',
  customer_name text,
  order_ref text,
  notes text,
  source text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','demo','email','ticket')),
  original_path text NOT NULL,
  edited_path text,
  editor_state jsonb,
  status text NOT NULL DEFAULT 'venter' CHECK (status IN ('venter','ferdig_redigert','skrevet_ut')),
  printed_at timestamptz,
  print_count int NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cake_images_le_date_idx
  ON public.cake_images (legal_entity_id, delivery_date, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cake_images TO authenticated;
GRANT ALL ON public.cake_images TO service_role;

ALTER TABLE public.cake_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cake_images_select"
  ON public.cake_images FOR SELECT TO authenticated
  USING (public.user_has_legal_entity_access(legal_entity_id));

CREATE POLICY "cake_images_insert"
  ON public.cake_images FOR INSERT TO authenticated
  WITH CHECK (public.user_has_legal_entity_access(legal_entity_id) AND created_by = auth.uid());

CREATE POLICY "cake_images_update"
  ON public.cake_images FOR UPDATE TO authenticated
  USING (public.user_has_legal_entity_access(legal_entity_id))
  WITH CHECK (public.user_has_legal_entity_access(legal_entity_id));

CREATE POLICY "cake_images_delete"
  ON public.cake_images FOR DELETE TO authenticated
  USING (public.user_has_legal_entity_access(legal_entity_id));

DROP TRIGGER IF EXISTS cake_images_set_updated_at ON public.cake_images;
CREATE TRIGGER cake_images_set_updated_at
  BEFORE UPDATE ON public.cake_images
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.cake_images;

-- Storage RLS for cake-images bøtte (bøtte opprettes manuelt i dashboard)
DROP POLICY IF EXISTS "cake_images_storage_select" ON storage.objects;
CREATE POLICY "cake_images_storage_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'cake-images'
    AND public.user_has_legal_entity_access((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "cake_images_storage_insert" ON storage.objects;
CREATE POLICY "cake_images_storage_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cake-images'
    AND public.user_has_legal_entity_access((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "cake_images_storage_update" ON storage.objects;
CREATE POLICY "cake_images_storage_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'cake-images'
    AND public.user_has_legal_entity_access((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "cake_images_storage_delete" ON storage.objects;
CREATE POLICY "cake_images_storage_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'cake-images'
    AND public.user_has_legal_entity_access((storage.foldername(name))[1]::uuid)
  );
