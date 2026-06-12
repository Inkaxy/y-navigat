DROP POLICY IF EXISTS pos_print_jobs_update ON public.pos_print_jobs;

CREATE POLICY pos_print_jobs_update ON public.pos_print_jobs
FOR UPDATE
USING (
  (EXISTS (
    SELECT 1 FROM pos_printers p
    WHERE p.id = pos_print_jobs.printer_id
      AND ((has_position_in_entity(p.legal_entity_id)
            AND has_app_write_access('pos_styring'::text))
           OR is_platform_admin())
  ))
  OR (is_kiosk_user() AND status IN ('queued','printing'))
)
WITH CHECK (
  (NOT is_kiosk_user()) OR (status IN ('printing','done','failed'))
);