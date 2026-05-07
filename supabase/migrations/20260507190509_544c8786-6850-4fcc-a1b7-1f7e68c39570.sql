UPDATE public.email_templates
SET available_variables = jsonb_set(
  available_variables,
  '{4,example}',
  to_jsonb('<table style="width:100%;border-collapse:collapse;"><tr style="background:#f0f0f0;"><th align="left">Vare</th><th align="right">Antall</th><th align="right">Sum</th></tr><tr><td>Rundstekt Helkorn</td><td align="right">5</td><td align="right">75,00 kr</td></tr><tr><td>Hvasser</td><td align="right">10</td><td align="right">145,00 kr</td></tr></table>'::text)
)
WHERE template_key = 'order_confirmation'
  AND available_variables->4->>'key' = 'linjer_html';