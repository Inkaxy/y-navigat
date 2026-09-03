-- Fjern klientlesing av rene hemmeligheter. Radpolicyene beholdes uendret;
-- kun de sensitive kolonnene blir uleselige for anon/authenticated.
REVOKE SELECT (access_token, password_hash) ON public.negotiation_recipients FROM anon, authenticated;
REVOKE SELECT (pin_hash) ON public.pos_operators FROM anon, authenticated;

-- Edge-funksjoner (service_role) må fortsatt kunne autentisere leverandører og kasserere.
GRANT SELECT ON public.negotiation_recipients TO service_role;
GRANT SELECT ON public.pos_operators TO service_role;