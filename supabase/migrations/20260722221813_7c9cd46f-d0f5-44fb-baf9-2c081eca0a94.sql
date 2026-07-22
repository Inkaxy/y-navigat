REVOKE SELECT ON public.pos_operators FROM anon, authenticated, public;
GRANT SELECT (id, legal_entity_id, user_id, operator_code, display_name, status, last_login_at, created_at, updated_at) ON public.pos_operators TO authenticated;
GRANT ALL ON public.pos_operators TO service_role;