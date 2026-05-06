CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Fjern eventuell tidligere jobb med samme navn
DO $$
DECLARE jid integer;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'refresh-purchase-stats-nightly';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

SELECT cron.schedule(
  'refresh-purchase-stats-nightly',
  '30 2 * * *',
  $$ SELECT public.refresh_purchase_stats(); $$
);