-- VENTER PÅ ROOT – KJØRES IKKE AV AGENTEN.
-- Rettepakke fakturalesing 13.11.2026, punkt B (e-post til Henrik når lesingen stopper).
-- Kontroll: 20261113_invoice_reading_alert_template.check.sql (bare SELECT).
--
-- Ny e-postmal «invoice_reading_stopped». tripletex-import-invoice-lines legger varselet i den vanlige
-- e-postkøen (email_outbox → process-email-outbox → microsoft-graph-send) når lesingen har feilet på
-- AI-tjenesten to ganger på rad, høyst én per døgn for samme feiltype. Mottaker settes av serveren
-- (henrik@nottero-bakeri.no). Uten malen (før denne filen) legges ingenting i køen – som før.
-- Variabler: feiltype, feilmelding, siste_vellykkede, tidspunkt, lenke.

begin;

insert into public.email_templates (template_key, display_name, subject_template, body_html_template, body_text_template, available_variables, is_active)
values (
  'invoice_reading_stopped',
  'Fakturalesing står stille – varsel til Henrik',
  '[NBhub] Fakturalesingen står stille',
  '<p><strong>Fakturalesingen i NBhub står stille.</strong></p>'
  || '<p>{{feilmelding}}</p>'
  || '<p>Siste vellykkede lesing: {{siste_vellykkede}}<br/>Oppdaget: {{tidspunkt}}</p>'
  || '<p>Nye fakturaer fra Tripletex blir liggende i køen og leses når tjenesten virker igjen. Ingen fakturaer er merket som ferdige.</p>'
  || '<p><a href="{{lenke}}">Åpne AI-tjenester i NBhub</a></p>'
  || '<p style="color:#666">Du får høyst én slik e-post per døgn for samme feil.</p>',
  'Fakturalesingen i NBhub står stille.' || chr(10) || chr(10)
  || '{{feilmelding}}' || chr(10) || chr(10)
  || 'Siste vellykkede lesing: {{siste_vellykkede}}' || chr(10)
  || 'Oppdaget: {{tidspunkt}}' || chr(10) || chr(10)
  || 'Nye fakturaer fra Tripletex blir liggende i køen og leses når tjenesten virker igjen. Ingen fakturaer er merket som ferdige.' || chr(10) || chr(10)
  || 'Åpne AI-tjenester: {{lenke}}' || chr(10) || chr(10)
  || 'Du får høyst én slik e-post per døgn for samme feil.',
  '["feiltype","feilmelding","siste_vellykkede","tidspunkt","lenke"]'::jsonb,
  true
)
on conflict (template_key) do nothing;

commit;
