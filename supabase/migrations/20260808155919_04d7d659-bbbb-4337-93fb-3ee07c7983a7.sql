CREATE POLICY "label_marks_entity_read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'label-marks' AND has_position_in_entity(((storage.foldername(name))[1])::uuid));

CREATE POLICY "label_marks_entity_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'label-marks' AND has_position_in_entity(((storage.foldername(name))[1])::uuid) AND has_app_write_access('varer'));

CREATE POLICY "label_marks_entity_update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'label-marks' AND has_position_in_entity(((storage.foldername(name))[1])::uuid) AND has_app_write_access('varer'))
WITH CHECK (bucket_id = 'label-marks' AND has_position_in_entity(((storage.foldername(name))[1])::uuid) AND has_app_write_access('varer'));

CREATE POLICY "label_marks_entity_delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'label-marks' AND has_position_in_entity(((storage.foldername(name))[1])::uuid) AND has_app_write_access('varer'));