-- FORSLAG — IKKE KJØRT. Privat bøtte for originale tellelister. Krever stage3-forslaget.
-- Sti: <firma>/<telling>/<liste>/<jobb>/original.<ext> | side.pdf — bestemt av vt_ocr_create_job.
-- Opplasting bare til sti som tilhører en jobb brukeren selv opprettet og som fortsatt er «opprettet».
-- Ingen oppdatering/sletting fra klient (originalen bevares som bevis).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vt-count-uploads', 'vt-count-uploads', false, 20971520, ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY vt_uploads_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'vt-count-uploads' AND EXISTS (
  SELECT 1 FROM public.vt_ocr_jobs j
   WHERE j.created_by = auth.uid() AND j.status = 'opprettet'
     AND (storage.objects.name = j.original_path OR storage.objects.name = j.pdf_path)
     AND public.has_ravarer_access(auth.uid(), j.legal_entity_id, 'write')));

CREATE POLICY vt_uploads_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'vt-count-uploads' AND EXISTS (
  SELECT 1 FROM public.vt_ocr_jobs j
   WHERE (storage.objects.name = j.original_path OR storage.objects.name = j.pdf_path)
     AND public.has_ravarer_access(auth.uid(), j.legal_entity_id, 'read')));
