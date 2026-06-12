DROP POLICY IF EXISTS pos_print_jobs_update ON public.pos_print_jobs;

CREATE POLICY pos_print_jobs_update ON public.pos_print_jobs
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.pos_printers p
    WHERE p.id = pos_print_jobs.printer_id
      AND (
        (has_position_in_entity(p.legal_entity_id) AND has_app_write_access('pos_styring'))
        OR is_platform_admin()
        OR is_kiosk_user()
      )
  )
)
WITH CHECK (
  status IN ('pending','printing','done','error')
);