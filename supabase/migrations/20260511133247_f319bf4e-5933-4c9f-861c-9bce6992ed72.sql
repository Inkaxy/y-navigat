
-- 1) Allow 'deleted' status on public.users
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'onboarding'::text, 'terminated'::text, 'deleted'::text]));

-- 2) Convert all NO ACTION FKs to auth.users into ON DELETE SET NULL
DO $$
DECLARE
  r record;
  cols text;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema, c.relname AS table_name, con.conname AS conname,
           pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class fc ON fc.oid = con.confrelid
    JOIN pg_namespace fn ON fn.oid = fc.relnamespace
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE fn.nspname = 'auth' AND fc.relname = 'users'
      AND con.confdeltype = 'a'
      AND n.nspname = 'public'
  LOOP
    -- Extract column list from "FOREIGN KEY (col) REFERENCES auth.users(id)"
    cols := substring(r.def from 'FOREIGN KEY \(([^)]+)\)');
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema, r.table_name, r.conname);
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES auth.users(id) ON DELETE SET NULL',
      r.schema, r.table_name, r.conname, cols
    );
  END LOOP;
END $$;
