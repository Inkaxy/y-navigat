INSERT INTO public.email_templates (
  template_key, display_name, subject_template, body_html_template, available_variables, is_active
) VALUES (
  'ticket_reply',
  'Svar på henvendelse (ticket)',
  'Re: {{original_emne}}',
  '<p>Hei {{kunde_navn}},</p>
<p>Takk for henvendelsen din.</p>
<p>{{svar_tekst}}</p>
<p>Ta gjerne kontakt om du har flere spørsmål.</p>
<p>Med vennlig hilsen,<br/>Nøtterø Bakeri</p>',
  '[
    {"key":"kunde_navn","description":"Avsenderens navn (eller e-post hvis ukjent)","example":"Meny Eiktoppen"},
    {"key":"kunde_epost","description":"Avsenderens e-postadresse","example":"kunde@eksempel.no"},
    {"key":"original_emne","description":"Emne fra opprinnelig e-post","example":"Spørsmål om levering"},
    {"key":"original_melding","description":"Utdrag av opprinnelig melding","example":"Hei, lurte på ..."},
    {"key":"ticket_nr","description":"Saksnummer","example":"TCK-1042"},
    {"key":"svar_tekst","description":"Selve svartesten (fritt felt)","example":"Vi leverer på torsdag som vanlig."}
  ]'::jsonb,
  true
)
ON CONFLICT (template_key) DO NOTHING;