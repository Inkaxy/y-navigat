select cron.schedule(
  'tripletex-sync-trigger-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://xpgoztaraqdvliitkkfv.supabase.co/functions/v1/tripletex-sync-trigger',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwZ296dGFyYXFkdmxpaXRra2Z2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MzMzMDAsImV4cCI6MjA5MjAwOTMwMH0.XUZsUhdvjyskPHksVw16Sk39EnwfmMC4-QhxNdgouvs"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);