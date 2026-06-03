CREATE OR REPLACE FUNCTION public.get_email_m365_status()
RETURNS TABLE (
  connected boolean,
  account_email text,
  scope text,
  tenant_id text,
  expires_at timestamptz,
  connected_at timestamptz,
  last_refresh_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_platform_owner(auth.uid())) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    TRUE AS connected,
    t.account_email,
    t.scope,
    t.tenant_id,
    t.expires_at,
    t.created_at AS connected_at,
    t.last_refresh_at
  FROM public.microsoft_oauth_tokens t
  ORDER BY t.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_email_m365_status() TO authenticated;