
INSERT INTO storage.buckets (id, name, public) VALUES ('raw-material-datasheets', 'raw-material-datasheets', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.raw_material_datasheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  version int NOT NULL DEFAULT 1,
  file_path text NOT NULL,
  file_name text,
  file_hash text,
  supplier_name text,
  sku text,
  package_size_value numeric,
  package_size_unit text,
  ai_extracted jsonb,
  ai_model text,
  ai_confidence numeric,
  raw_ai_response jsonb,
  is_current boolean NOT NULL DEFAULT true,
  replaced_by uuid,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'
);
ALTER TABLE public.raw_material_datasheets
  ADD CONSTRAINT rmd_replaced_by_fk FOREIGN KEY (replaced_by) REFERENCES public.raw_material_datasheets(id) ON DELETE SET NULL;
CREATE INDEX idx_rmd_raw_material ON public.raw_material_datasheets(raw_material_id);
CREATE INDEX idx_rmd_legal_entity ON public.raw_material_datasheets(legal_entity_id);
ALTER TABLE public.raw_material_datasheets ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.datasheet_upload_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL,
  uploaded_by uuid,
  total_files int NOT NULL DEFAULT 0,
  processed int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.datasheet_upload_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.raw_material_datasheets ADD COLUMN batch_id uuid REFERENCES public.datasheet_upload_batches(id) ON DELETE SET NULL;

CREATE TABLE public.raw_material_changelog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  datasheet_id uuid REFERENCES public.raw_material_datasheets(id) ON DELETE SET NULL,
  change_type text NOT NULL,
  field text,
  old_value jsonb,
  new_value jsonb,
  severity text NOT NULL DEFAULT 'low',
  affected_recipes_count int NOT NULL DEFAULT 0,
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rmc_raw_material ON public.raw_material_changelog(raw_material_id);
CREATE INDEX idx_rmc_legal_entity ON public.raw_material_changelog(legal_entity_id);
CREATE INDEX idx_rmc_unack ON public.raw_material_changelog(legal_entity_id, acknowledged) WHERE acknowledged = false;
ALTER TABLE public.raw_material_changelog ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS declaration_needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS declaration_review_reason text;

ALTER TABLE public.raw_material_components ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE public.raw_material_components ADD COLUMN IF NOT EXISTS suggested_by_ai boolean NOT NULL DEFAULT false;

-- RLS using has_ravarer_access pattern
CREATE POLICY "rmd_select" ON public.raw_material_datasheets FOR SELECT
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'::access_level));
CREATE POLICY "rmd_insert" ON public.raw_material_datasheets FOR INSERT
  WITH CHECK (public.has_ravarer_access(auth.uid(), legal_entity_id, 'write'::access_level));
CREATE POLICY "rmd_update" ON public.raw_material_datasheets FOR UPDATE
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'write'::access_level));
CREATE POLICY "rmd_delete" ON public.raw_material_datasheets FOR DELETE
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'admin'::access_level));

CREATE POLICY "rmc_select" ON public.raw_material_changelog FOR SELECT
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'::access_level));
CREATE POLICY "rmc_insert" ON public.raw_material_changelog FOR INSERT
  WITH CHECK (public.has_ravarer_access(auth.uid(), legal_entity_id, 'write'::access_level));
CREATE POLICY "rmc_update" ON public.raw_material_changelog FOR UPDATE
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'write'::access_level));

CREATE POLICY "dub_select" ON public.datasheet_upload_batches FOR SELECT
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'::access_level));
CREATE POLICY "dub_insert" ON public.datasheet_upload_batches FOR INSERT
  WITH CHECK (public.has_ravarer_access(auth.uid(), legal_entity_id, 'write'::access_level));
CREATE POLICY "dub_update" ON public.datasheet_upload_batches FOR UPDATE
  USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'write'::access_level));

CREATE POLICY "rmd_storage_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'raw-material-datasheets' AND auth.uid() IS NOT NULL);
CREATE POLICY "rmd_storage_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'raw-material-datasheets' AND auth.uid() IS NOT NULL);
CREATE POLICY "rmd_storage_update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'raw-material-datasheets' AND auth.uid() IS NOT NULL);
CREATE POLICY "rmd_storage_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'raw-material-datasheets' AND auth.uid() IS NOT NULL);
