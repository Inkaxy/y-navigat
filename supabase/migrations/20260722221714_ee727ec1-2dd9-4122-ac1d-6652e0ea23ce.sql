
-- Fjern eventuelle brede grants og gi kolonnenivå-SELECT som utelater hemmeligheter.
REVOKE SELECT ON public.negotiation_recipients FROM anon, authenticated, PUBLIC;

GRANT SELECT (
  id, negotiation_id, supplier_id, contact_email, contact_name,
  password_set_at, password_expires_at, failed_attempts, locked_until,
  status, invited_at, first_viewed_at, last_viewed_at, responded_at,
  expires_at, created_at, updated_at
) ON public.negotiation_recipients TO authenticated;

-- Skriveprivilegier beholdes (RLS-policyen styrer hvem)
GRANT INSERT, UPDATE, DELETE ON public.negotiation_recipients TO authenticated;
GRANT ALL ON public.negotiation_recipients TO service_role;
