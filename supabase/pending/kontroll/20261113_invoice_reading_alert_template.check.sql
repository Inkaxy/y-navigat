-- KONTROLL – bare SELECT, skriver ingenting. Hører til 20261113_invoice_reading_alert_template.PENDING.sql.

-- 1) Finnes malen? (ingen rad før, én aktiv rad etter)
select template_key, display_name, is_active, available_variables
  from public.email_templates where template_key = 'invoice_reading_stopped';

-- 2) Varsler som er lagt i køen (etter kjøring og første stopp). Høyst én per døgn per feiltype.
select created_at, status, recipient_email, variables->>'feiltype' as feiltype, variables->>'siste_vellykkede' as siste_vellykkede
  from public.email_outbox where template_key = 'invoice_reading_stopped' order by created_at desc limit 20;
