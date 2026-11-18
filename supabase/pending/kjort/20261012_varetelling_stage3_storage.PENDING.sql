-- FORSLAG — POLICYENE ER IKKE KJØRT. Krever stage3-forslaget (vt_ocr_jobs).
-- Sti: <firma>/<telling>/<liste>/<jobb>/side-N.<pdf|jpg|png> og original-N.webp — bestemt av vt_ocr_create_job (originals[].path).
-- Opplasting bare til sti som tilhører en jobb brukeren selv opprettet og som fortsatt er «opprettet».
-- Ingen oppdatering/sletting fra klient (originalen bevares som bevis). Serveren verifiserer SHA-256/størrelse før lesing.
--
-- BØTTE (opprettet 12.10.2026 med Storage-API-verktøyet, ikke SQL; denne filen inneholder bare policyer):
--   id/name            : vt-count-uploads
--   public             : false (privat)
--   file_size_limit    : 20971520 (20 MiB) — bekreftet i storage.buckets
--   allowed_mime_types : ønsket application/pdf, image/jpeg, image/png, image/webp (WEBP for bevart original).
--                        IKKE satt: verktøyet støtter ikke MIME-liste, og SQL-oppdatering av storage.buckets er
--                        ikke tillatt. Står nå NULL (ingen bøttebegrensning). Filtype håndheves av
--                        vt_ocr_create_job (mime + sti-endelse) og insert-policyen under (eksakt jobbsti).
--                        Root kan sette listen i Supabase-dashbordet (Storage › vt-count-uploads › Edit).


CREATE POLICY vt_uploads_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'vt-count-uploads' AND EXISTS (
  SELECT 1 FROM public.vt_ocr_jobs j
   WHERE j.created_by = auth.uid() AND j.status = 'opprettet'
     AND j.originals @> jsonb_build_array(jsonb_build_object('path', storage.objects.name))
     AND public.has_ravarer_access(auth.uid(), j.legal_entity_id, 'write')));

CREATE POLICY vt_uploads_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'vt-count-uploads' AND EXISTS (
  SELECT 1 FROM public.vt_ocr_jobs j
   WHERE j.originals @> jsonb_build_array(jsonb_build_object('path', storage.objects.name))
     AND public.has_ravarer_access(auth.uid(), j.legal_entity_id, 'read')));
