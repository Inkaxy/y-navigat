
-- ============================================================
-- B.0 Innstillinger-grunnmur (Ordre)
-- ============================================================

-- 1) Hjelpefunksjon: tilgang for Ordrekontor + Daglig leder
CREATE OR REPLACE FUNCTION public.has_ordre_settings_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_active_position('ordrekontor')
    OR public.has_active_position('daglig_leder')
    OR public.is_platform_admin();
$$;

-- 2) email_templates
CREATE TABLE IF NOT EXISTS public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  subject_template text NOT NULL,
  body_html_template text NOT NULL,
  body_text_template text,
  available_variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_templates_select_ordre" ON public.email_templates
  FOR SELECT TO authenticated
  USING (public.has_ordre_settings_access());

CREATE POLICY "email_templates_insert_ordre" ON public.email_templates
  FOR INSERT TO authenticated
  WITH CHECK (public.has_ordre_settings_access());

CREATE POLICY "email_templates_update_ordre" ON public.email_templates
  FOR UPDATE TO authenticated
  USING (public.has_ordre_settings_access())
  WITH CHECK (public.has_ordre_settings_access());

CREATE POLICY "email_templates_delete_ordre" ON public.email_templates
  FOR DELETE TO authenticated
  USING (public.has_ordre_settings_access());

-- updated_at trigger (gjenbruker eksisterende update_updated_at_column hvis tilstede)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='update_updated_at_column' AND pronamespace='public'::regnamespace) THEN
    EXECUTE 'CREATE TRIGGER trg_email_templates_updated_at
             BEFORE UPDATE ON public.email_templates
             FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;
END $$;

-- 3) microsoft_oauth_tokens (service_role-only)
CREATE TABLE IF NOT EXISTS public.microsoft_oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_email text NOT NULL UNIQUE,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  expires_at timestamptz NOT NULL,
  scope text NOT NULL,
  tenant_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_refresh_at timestamptz
);

ALTER TABLE public.microsoft_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Ingen policy for authenticated/anon → default deny.
-- service_role bypasser RLS automatisk; ingen eksplisitt policy nødvendig,
-- men vi legger en eksplisitt for tydelighet.
CREATE POLICY "msft_tokens_service_role_only" ON public.microsoft_oauth_tokens
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='update_updated_at_column' AND pronamespace='public'::regnamespace) THEN
    EXECUTE 'CREATE TRIGGER trg_msft_tokens_updated_at
             BEFORE UPDATE ON public.microsoft_oauth_tokens
             FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()';
  END IF;
END $$;

-- 4) platform_settings — utvid tilgang for Ordrekontor/Daglig leder
--    bare for kategori 'ordre_email'. Beholder eksisterende admin-policies.
CREATE POLICY "platform_settings_select_ordre_email" ON public.platform_settings
  FOR SELECT TO authenticated
  USING (category = 'ordre_email' AND public.has_ordre_settings_access());

CREATE POLICY "platform_settings_insert_ordre_email" ON public.platform_settings
  FOR INSERT TO authenticated
  WITH CHECK (category = 'ordre_email' AND public.has_ordre_settings_access());

CREATE POLICY "platform_settings_update_ordre_email" ON public.platform_settings
  FOR UPDATE TO authenticated
  USING (category = 'ordre_email' AND public.has_ordre_settings_access())
  WITH CHECK (category = 'ordre_email' AND public.has_ordre_settings_access());

-- 5) Seed: order_confirmation test-mal
INSERT INTO public.email_templates (template_key, display_name, subject_template, body_html_template, body_text_template, available_variables)
VALUES (
  'order_confirmation',
  'Ordrebekreftelse',
  'Ordrebekreftelse {{ordrenr}} — levering {{leveringsdato}}',
  E'<p>Hei {{kunde_navn}},</p>\n<p>Vi har mottatt din bestilling <strong>{{ordrenr}}</strong> til levering <strong>{{leveringsdato}}</strong> ({{leveringstid}}).</p>\n<h3>Ordrelinjer</h3>\n{{linjer_html}}\n<p><strong>Sum inkl. MVA:</strong> {{sum_inkl_mva}}</p>\n<p>Med vennlig hilsen,<br/>Nøtterø Bakeri</p>',
  E'Hei {{kunde_navn}},\n\nVi har mottatt din bestilling {{ordrenr}} til levering {{leveringsdato}} ({{leveringstid}}).\n\nSum inkl. MVA: {{sum_inkl_mva}}\n\nMed vennlig hilsen,\nNøtterø Bakeri',
  '[
    {"key":"kunde_navn","description":"Kundens display_name","example":"Meny Eiktoppen"},
    {"key":"ordrenr","description":"Ordrenummer","example":"2026-0042"},
    {"key":"leveringsdato","description":"Levering DD.MM.YYYY","example":"08.05.2026"},
    {"key":"leveringstid","description":"Tur-tidsvindu","example":"06:00-09:00"},
    {"key":"linjer_html","description":"Tabell over ordrelinjer (HTML)","example":"<table>...</table>"},
    {"key":"sum_inkl_mva","description":"Total inkl. MVA","example":"1 234,50 kr"}
  ]'::jsonb
)
ON CONFLICT (template_key) DO NOTHING;
