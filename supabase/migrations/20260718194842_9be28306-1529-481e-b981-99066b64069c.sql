
ALTER TABLE public.pakkesystem_api_keys
  ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT ARRAY['read:orders']::text[],
  ADD COLUMN IF NOT EXISTS note text;

CREATE TABLE IF NOT EXISTS public.pakkesystem_push_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  http_method text NOT NULL DEFAULT 'POST' CHECK (http_method IN ('POST','PUT')),
  auth_header text,
  extra_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  push_time time NOT NULL DEFAULT '04:00',
  target_offset_days integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  last_pushed_at timestamptz,
  last_status_code integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pakkesystem_push_destinations TO authenticated;
GRANT ALL ON public.pakkesystem_push_destinations TO service_role;

ALTER TABLE public.pakkesystem_push_destinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read push dests for entity" ON public.pakkesystem_push_destinations
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "platform owners manage push dests" ON public.pakkesystem_push_destinations
  FOR ALL TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

CREATE OR REPLACE FUNCTION public.pakkesystem_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pakkesystem_push_updated_at ON public.pakkesystem_push_destinations;
CREATE TRIGGER trg_pakkesystem_push_updated_at
  BEFORE UPDATE ON public.pakkesystem_push_destinations
  FOR EACH ROW EXECUTE FUNCTION public.pakkesystem_touch_updated_at();

-- Hjelpefunksjon: hash en API-nøkkel med samme algoritme som ved opprettelse (SHA-256 hex).
CREATE OR REPLACE FUNCTION public.pakkesystem_hash_key(p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(extensions.digest(p_key, 'sha256'), 'hex')
$$;
