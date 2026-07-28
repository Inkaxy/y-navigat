-- 1) attach_vedlegg toggle on invoice_settings
ALTER TABLE public.invoice_settings
  ADD COLUMN IF NOT EXISTS attach_vedlegg boolean NOT NULL DEFAULT true;

-- 2) Aggregated invoiced-count per run, for the Kjøringer list.
CREATE OR REPLACE FUNCTION public.get_run_invoiced_counts(p_legal_entity_id uuid)
RETURNS TABLE(run_id uuid, invoiced_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.run_id, COUNT(*)::bigint AS invoiced_count
  FROM public.invoice_basis b
  JOIN public.invoice_runs r ON r.id = b.run_id
  WHERE r.legal_entity_id = p_legal_entity_id
    AND b.status = 'invoiced'
    AND public.has_position_in_entity(p_legal_entity_id)
  GROUP BY b.run_id;
$$;

REVOKE ALL ON FUNCTION public.get_run_invoiced_counts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_run_invoiced_counts(uuid) TO authenticated;