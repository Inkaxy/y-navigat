
-- Tickets: bare brukere med faktisk ordre-tilgang (ikke 'none')
DROP POLICY IF EXISTS "Ordre-users can read tickets" ON public.tickets;
CREATE POLICY "Ordre-users can read tickets"
ON public.tickets
FOR SELECT
USING (app_access_level('ordre'::text) <> 'none'::access_level);

DROP POLICY IF EXISTS "Ordre-users can read attachments" ON public.ticket_attachments;
CREATE POLICY "Ordre-users can read attachments"
ON public.ticket_attachments
FOR SELECT
USING (app_access_level('ordre'::text) <> 'none'::access_level);

-- Negotiation recipients: skjul sensitive kolonner fra klient-roller
REVOKE SELECT (password_hash, access_token) ON public.negotiation_recipients FROM authenticated;
REVOKE SELECT (password_hash, access_token) ON public.negotiation_recipients FROM anon;
