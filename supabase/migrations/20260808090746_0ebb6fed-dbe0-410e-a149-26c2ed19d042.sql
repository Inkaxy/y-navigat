-- pos_operators: fjern kolonne-tilgang til pin_hash for klientroller
REVOKE SELECT ON public.pos_operators FROM authenticated, anon;
GRANT SELECT (id, legal_entity_id, user_id, operator_code, display_name, status, last_login_at, created_at, updated_at)
  ON public.pos_operators TO authenticated;
GRANT ALL ON public.pos_operators TO service_role;

-- negotiation_recipients: fjern kolonne-tilgang til password_hash og access_token
REVOKE SELECT ON public.negotiation_recipients FROM authenticated, anon;
GRANT SELECT (id, negotiation_id, supplier_id, contact_email, contact_name, password_set_at, password_expires_at, failed_attempts, locked_until, status, invited_at, first_viewed_at, last_viewed_at, responded_at, expires_at, created_at, updated_at)
  ON public.negotiation_recipients TO authenticated;
GRANT ALL ON public.negotiation_recipients TO service_role;