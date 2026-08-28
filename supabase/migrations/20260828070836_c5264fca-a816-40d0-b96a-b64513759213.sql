REVOKE SELECT (access_token, password_hash) ON public.negotiation_recipients FROM authenticated, anon;
REVOKE SELECT (pin_hash) ON public.pos_operators FROM authenticated, anon;
GRANT ALL ON public.negotiation_recipients TO service_role;
GRANT ALL ON public.pos_operators TO service_role;