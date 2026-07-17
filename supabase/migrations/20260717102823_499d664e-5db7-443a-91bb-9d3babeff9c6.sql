
-- 1. Tripletex credentials: revoke SELECT on sensitive token columns
REVOKE SELECT ON public.tripletex_credentials FROM authenticated;
GRANT SELECT (
  legal_entity_id, mode, sync_enabled, sync_frequency_minutes,
  last_synced_at, last_sync_status, last_sync_error,
  last_synced_voucher_date, session_expires_at, created_at, updated_at
) ON public.tripletex_credentials TO authenticated;

-- 2. Storage: ticket_attachments_select requires access_level <> 'none'
DROP POLICY IF EXISTS "ticket_attachments_select" ON storage.objects;
CREATE POLICY "ticket_attachments_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND EXISTS (
    SELECT 1
    FROM user_positions up
    JOIN position_app_access paa ON paa.position_id = up.position_id
    JOIN apps a ON a.id = paa.app_id
    WHERE up.user_id = auth.uid()
      AND a.code = 'ordre'
      AND paa.level <> 'none'::access_level
  )
);

-- 3. Helper: is_internal_user (has any user_positions row)
CREATE OR REPLACE FUNCTION public.is_internal_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_positions WHERE user_id = auth.uid()
  );
$$;

-- 4. portal_user_profiles: tighten "always true" policies
DROP POLICY IF EXISTS "Internal users can insert portal profiles" ON public.portal_user_profiles;
DROP POLICY IF EXISTS "Internal users can update portal profiles" ON public.portal_user_profiles;
DROP POLICY IF EXISTS "Internal users can view portal profiles" ON public.portal_user_profiles;

CREATE POLICY "Internal users can view portal profiles"
ON public.portal_user_profiles FOR SELECT TO authenticated
USING (public.is_internal_user());

CREATE POLICY "Internal users can insert portal profiles"
ON public.portal_user_profiles FOR INSERT TO authenticated
WITH CHECK (public.is_internal_user());

CREATE POLICY "Internal users can update portal profiles"
ON public.portal_user_profiles FOR UPDATE TO authenticated
USING (public.is_internal_user())
WITH CHECK (public.is_internal_user());

-- 5. customer_portal_accounts: tighten "always true" policies
DROP POLICY IF EXISTS "Internal users can insert portal account links" ON public.customer_portal_accounts;
DROP POLICY IF EXISTS "Internal users can update portal account links" ON public.customer_portal_accounts;
DROP POLICY IF EXISTS "Internal users can delete portal account links" ON public.customer_portal_accounts;
DROP POLICY IF EXISTS "Internal users can view portal account links" ON public.customer_portal_accounts;

CREATE POLICY "Internal users can view portal account links"
ON public.customer_portal_accounts FOR SELECT TO authenticated
USING (public.is_internal_user());

CREATE POLICY "Internal users can insert portal account links"
ON public.customer_portal_accounts FOR INSERT TO authenticated
WITH CHECK (public.is_internal_user());

CREATE POLICY "Internal users can update portal account links"
ON public.customer_portal_accounts FOR UPDATE TO authenticated
USING (public.is_internal_user())
WITH CHECK (public.is_internal_user());

CREATE POLICY "Internal users can delete portal account links"
ON public.customer_portal_accounts FOR DELETE TO authenticated
USING (public.is_internal_user());

-- 6. notifications: tighten INSERT to internal users only
DROP POLICY IF EXISTS "authenticated notifications insert" ON public.notifications;
CREATE POLICY "authenticated notifications insert"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (public.is_internal_user());

-- 7. microsoft_oauth_tokens: drop redundant always-true policy (service_role bypasses RLS)
DROP POLICY IF EXISTS "msft_tokens_service_role_only" ON public.microsoft_oauth_tokens;
