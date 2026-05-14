
-- ========= invoice-ehf-xml: UPDATE + DELETE =========
CREATE POLICY "invoice_ehf_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'invoice-ehf-xml'
  AND EXISTS (
    SELECT 1
    FROM user_positions up
    JOIN position_app_access paa ON paa.position_id = up.position_id
    JOIN apps a ON a.id = paa.app_id
    WHERE up.user_id = auth.uid()
      AND a.code = 'fakturaer'
      AND paa.level = ANY (ARRAY['write'::access_level, 'admin'::access_level])
  )
)
WITH CHECK (
  bucket_id = 'invoice-ehf-xml'
  AND EXISTS (
    SELECT 1
    FROM user_positions up
    JOIN position_app_access paa ON paa.position_id = up.position_id
    JOIN apps a ON a.id = paa.app_id
    WHERE up.user_id = auth.uid()
      AND a.code = 'fakturaer'
      AND paa.level = ANY (ARRAY['write'::access_level, 'admin'::access_level])
  )
);

CREATE POLICY "invoice_ehf_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'invoice-ehf-xml'
  AND EXISTS (
    SELECT 1
    FROM user_positions up
    JOIN position_app_access paa ON paa.position_id = up.position_id
    JOIN apps a ON a.id = paa.app_id
    WHERE up.user_id = auth.uid()
      AND a.code = 'fakturaer'
      AND paa.level = 'admin'::access_level
  )
);

-- ========= ticket-attachments: SELECT + INSERT + DELETE =========
CREATE POLICY "ticket_attachments_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND EXISTS (
    SELECT 1
    FROM user_positions up
    JOIN position_app_access paa ON paa.position_id = up.position_id
    JOIN apps a ON a.id = paa.app_id
    WHERE up.user_id = auth.uid()
      AND a.code = 'ordre'
  )
);

CREATE POLICY "ticket_attachments_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'ticket-attachments'
  AND EXISTS (
    SELECT 1
    FROM user_positions up
    JOIN position_app_access paa ON paa.position_id = up.position_id
    JOIN apps a ON a.id = paa.app_id
    WHERE up.user_id = auth.uid()
      AND a.code = 'ordre'
      AND paa.level = ANY (ARRAY['write'::access_level, 'admin'::access_level])
  )
);

CREATE POLICY "ticket_attachments_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND EXISTS (
    SELECT 1
    FROM user_positions up
    JOIN position_app_access paa ON paa.position_id = up.position_id
    JOIN apps a ON a.id = paa.app_id
    WHERE up.user_id = auth.uid()
      AND a.code = 'ordre'
      AND paa.level = 'admin'::access_level
  )
);
