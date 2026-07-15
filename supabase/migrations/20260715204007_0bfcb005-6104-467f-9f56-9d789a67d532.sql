
-- Portal user profiles: metadata per auth-bruker som har tilgang til kundeportalen
CREATE TABLE public.portal_user_profiles (
  user_id uuid PRIMARY KEY,
  display_name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'kunde',
  status text NOT NULL DEFAULT 'invited', -- invited | active | disabled
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_role_valid CHECK (role IN ('kunde','admin')),
  CONSTRAINT portal_status_valid CHECK (status IN ('invited','active','disabled'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_user_profiles TO authenticated;
GRANT ALL ON public.portal_user_profiles TO service_role;

ALTER TABLE public.portal_user_profiles ENABLE ROW LEVEL SECURITY;

-- Alle interne innloggede kan se og administrere portal-brukere (samme mønster som customers-admin)
CREATE POLICY "Internal users can view portal profiles"
  ON public.portal_user_profiles FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Internal users can insert portal profiles"
  ON public.portal_user_profiles FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Internal users can update portal profiles"
  ON public.portal_user_profiles FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Owners can delete portal profiles"
  ON public.portal_user_profiles FOR DELETE
  TO authenticated USING (public.is_platform_owner(auth.uid()));

-- Portal-brukeren selv kan lese egen profil
CREATE POLICY "Portal user can view own profile"
  ON public.portal_user_profiles FOR SELECT
  TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER portal_user_profiles_updated_at
  BEFORE UPDATE ON public.portal_user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- La interne brukere administrere customer_portal_accounts (kobling)
CREATE POLICY "Internal users can view portal account links"
  ON public.customer_portal_accounts FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Internal users can insert portal account links"
  ON public.customer_portal_accounts FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Internal users can update portal account links"
  ON public.customer_portal_accounts FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Internal users can delete portal account links"
  ON public.customer_portal_accounts FOR DELETE
  TO authenticated USING (true);

-- Backfill: opprett profiler for eksisterende portal-brukere
INSERT INTO public.portal_user_profiles (user_id, display_name, email, role, status)
SELECT DISTINCT
  cpa.user_id,
  COALESCE(u.raw_user_meta_data->>'display_name', u.email, 'Portal-bruker'),
  u.email,
  'kunde',
  CASE WHEN u.last_sign_in_at IS NOT NULL THEN 'active' ELSE 'invited' END
FROM public.customer_portal_accounts cpa
JOIN auth.users u ON u.id = cpa.user_id
ON CONFLICT (user_id) DO NOTHING;
