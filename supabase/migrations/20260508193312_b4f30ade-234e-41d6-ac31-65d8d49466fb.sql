INSERT INTO public.email_templates (template_key, display_name, subject_template, body_html_template, body_text_template, available_variables, is_active)
VALUES
(
  'order_changed',
  'Endring i ordre',
  'Endring i ordre {{ordrenr}} — levering {{leveringsdato}}',
  '<p>Hei {{kunde_navn}},</p>
<p>Vi har gjort en endring på ordre <strong>{{ordrenr}}</strong> til levering <strong>{{leveringsdato}}</strong> ({{leveringstid}}).</p>
<h3>Oppdaterte ordrelinjer</h3>
{{linjer_html}}
<p><strong>Sum inkl. MVA:</strong> {{sum_inkl_mva}}</p>
<p>Ta kontakt om noe ikke stemmer.</p>
<p>Med vennlig hilsen,<br/>Nøtterø Bakeri</p>',
  E'Hei {{kunde_navn}},\n\nVi har gjort en endring på ordre {{ordrenr}} til levering {{leveringsdato}} ({{leveringstid}}).\n\nSum inkl. MVA: {{sum_inkl_mva}}\n\nTa kontakt om noe ikke stemmer.\n\nMed vennlig hilsen,\nNøtterø Bakeri',
  '[
    {"key":"kunde_navn","description":"Kundens display_name","example":"Meny Eiktoppen"},
    {"key":"ordrenr","description":"Ordrenummer","example":"2026-0042"},
    {"key":"leveringsdato","description":"Levering DD.MM.YYYY","example":"08.05.2026"},
    {"key":"leveringstid","description":"Tur-tidsvindu","example":"06:00-09:00"},
    {"key":"linjer_html","description":"Tabell over ordrelinjer (HTML)","example":"<table><tr><th>Vare</th><th>Antall</th></tr></table>"},
    {"key":"sum_inkl_mva","description":"Total inkl. MVA","example":"1 234,50 kr"}
  ]'::jsonb,
  true
),
(
  'delivery_reminder',
  'Påminnelse: Levering i morgen',
  'Påminnelse: Levering i morgen — ordre {{ordrenr}}',
  '<p>Hei {{kunde_navn}},</p>
<p>Bare en vennlig påminnelse om at vi leverer ordre <strong>{{ordrenr}}</strong> i morgen <strong>{{leveringsdato}}</strong> i tidsrommet {{leveringstid}}.</p>
<p>Sum inkl. MVA: <strong>{{sum_inkl_mva}}</strong></p>
<p>Vi gleder oss til å se dere!</p>
<p>Med vennlig hilsen,<br/>Nøtterø Bakeri</p>',
  E'Hei {{kunde_navn}},\n\nBare en vennlig påminnelse om at vi leverer ordre {{ordrenr}} i morgen {{leveringsdato}} i tidsrommet {{leveringstid}}.\n\nSum inkl. MVA: {{sum_inkl_mva}}\n\nMed vennlig hilsen,\nNøtterø Bakeri',
  '[
    {"key":"kunde_navn","description":"Kundens display_name","example":"Meny Eiktoppen"},
    {"key":"ordrenr","description":"Ordrenummer","example":"2026-0042"},
    {"key":"leveringsdato","description":"Levering DD.MM.YYYY","example":"08.05.2026"},
    {"key":"leveringstid","description":"Tur-tidsvindu","example":"06:00-09:00"},
    {"key":"sum_inkl_mva","description":"Total inkl. MVA","example":"1 234,50 kr"}
  ]'::jsonb,
  true
),
(
  'packing_slip',
  'Pakkseddel',
  'Pakkseddel for ordre {{ordrenr}} — {{leveringsdato}}',
  '<p>Hei {{kunde_navn}},</p>
<p>Vedlagt finner dere pakkseddel for ordre <strong>{{ordrenr}}</strong> levert <strong>{{leveringsdato}}</strong>.</p>
<h3>Levert</h3>
{{linjer_html}}
<p><strong>Sum inkl. MVA:</strong> {{sum_inkl_mva}}</p>
<p>Med vennlig hilsen,<br/>Nøtterø Bakeri</p>',
  E'Hei {{kunde_navn}},\n\nVedlagt finner dere pakkseddel for ordre {{ordrenr}} levert {{leveringsdato}}.\n\nSum inkl. MVA: {{sum_inkl_mva}}\n\nMed vennlig hilsen,\nNøtterø Bakeri',
  '[
    {"key":"kunde_navn","description":"Kundens display_name","example":"Meny Eiktoppen"},
    {"key":"ordrenr","description":"Ordrenummer","example":"2026-0042"},
    {"key":"leveringsdato","description":"Levering DD.MM.YYYY","example":"08.05.2026"},
    {"key":"linjer_html","description":"Tabell over ordrelinjer (HTML)","example":"<table><tr><th>Vare</th><th>Antall</th></tr></table>"},
    {"key":"sum_inkl_mva","description":"Total inkl. MVA","example":"1 234,50 kr"}
  ]'::jsonb,
  true
),
(
  'payment_reminder',
  'Betalingspåminnelse',
  'Betalingspåminnelse — ordre {{ordrenr}}',
  '<p>Hei {{kunde_navn}},</p>
<p>Vi minner om at ordre <strong>{{ordrenr}}</strong> levert {{leveringsdato}} står som ubetalt.</p>
<p><strong>Beløp:</strong> {{sum_inkl_mva}}</p>
<p>Hvis betaling allerede er utført, kan du se bort fra denne meldingen.</p>
<p>Med vennlig hilsen,<br/>Nøtterø Bakeri</p>',
  E'Hei {{kunde_navn}},\n\nVi minner om at ordre {{ordrenr}} levert {{leveringsdato}} står som ubetalt.\n\nBeløp: {{sum_inkl_mva}}\n\nHvis betaling allerede er utført, kan du se bort fra denne meldingen.\n\nMed vennlig hilsen,\nNøtterø Bakeri',
  '[
    {"key":"kunde_navn","description":"Kundens display_name","example":"Meny Eiktoppen"},
    {"key":"ordrenr","description":"Ordrenummer","example":"2026-0042"},
    {"key":"leveringsdato","description":"Levering DD.MM.YYYY","example":"08.05.2026"},
    {"key":"sum_inkl_mva","description":"Total inkl. MVA","example":"1 234,50 kr"}
  ]'::jsonb,
  true
)
ON CONFLICT (template_key) DO NOTHING;