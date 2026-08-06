-- pos_operators: hide pin_hash from clients via column-level privileges
REVOKE SELECT ON public.pos_operators FROM authenticated, anon;
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT column_name FROM information_schema.columns
           WHERE table_schema='public' AND table_name='pos_operators' AND column_name <> 'pin_hash'
  LOOP
    EXECUTE format('GRANT SELECT (%I) ON public.pos_operators TO authenticated', c);
  END LOOP;
END $$;
GRANT ALL ON public.pos_operators TO service_role;

-- negotiation_recipients: hide access_token / password_hash from clients
REVOKE SELECT ON public.negotiation_recipients FROM authenticated, anon;
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT column_name FROM information_schema.columns
           WHERE table_schema='public' AND table_name='negotiation_recipients'
             AND column_name NOT IN ('access_token','password_hash')
  LOOP
    EXECUTE format('GRANT SELECT (%I) ON public.negotiation_recipients TO authenticated', c);
  END LOOP;
END $$;
GRANT ALL ON public.negotiation_recipients TO service_role;