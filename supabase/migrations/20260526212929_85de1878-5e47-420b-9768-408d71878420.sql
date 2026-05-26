
CREATE POLICY "Ordre-users can update attachments"
  ON public.ticket_attachments
  FOR UPDATE
  TO authenticated
  USING (app_access_level('ordre') <> 'none'::access_level)
  WITH CHECK (app_access_level('ordre') <> 'none'::access_level);
