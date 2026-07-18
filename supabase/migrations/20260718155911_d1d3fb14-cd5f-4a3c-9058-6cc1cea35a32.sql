INSERT INTO public.widget_registry (code, display_name, description, required_app_code, default_size, status)
SELECT 'pos_helse', 'Kasse-helse', 'Rød journal-status og manglende Z-rapporter for POS-terminaler.', 'pos_styring', 'small', 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.widget_registry WHERE code = 'pos_helse');