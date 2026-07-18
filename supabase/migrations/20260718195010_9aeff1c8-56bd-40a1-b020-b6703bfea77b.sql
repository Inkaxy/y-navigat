
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Fjern eventuell tidligere schedule med samme navn
DO $$
BEGIN
  PERFORM cron.unschedule('pakkesystem-push-every-10min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pakkesystem-push-every-10min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'pakkesystem-push-every-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://xpgoztaraqdvliitkkfv.supabase.co/functions/v1/pakkesystem-push-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
