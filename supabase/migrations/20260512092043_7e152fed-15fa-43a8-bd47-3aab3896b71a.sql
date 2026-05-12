-- Cleanup: ved hver insert i production_plan_snapshots, slett de som er eldre enn 2 dager
CREATE OR REPLACE FUNCTION public.cleanup_old_production_plan_snapshots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.production_plan_snapshots
  WHERE created_at < (now() - interval '2 days');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pps_cleanup ON public.production_plan_snapshots;
CREATE TRIGGER trg_pps_cleanup
  AFTER INSERT ON public.production_plan_snapshots
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.cleanup_old_production_plan_snapshots();