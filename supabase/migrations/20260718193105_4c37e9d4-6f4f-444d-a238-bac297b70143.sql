
-- pakkesystem-api: nøkler + logg
CREATE TABLE public.pakkesystem_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX ON public.pakkesystem_api_keys(legal_entity_id) WHERE revoked_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pakkesystem_api_keys TO authenticated;
GRANT ALL ON public.pakkesystem_api_keys TO service_role;

ALTER TABLE public.pakkesystem_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform owners can manage pakkesystem keys"
  ON public.pakkesystem_api_keys FOR ALL
  TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

CREATE TABLE public.pakkesystem_api_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid REFERENCES public.pakkesystem_api_keys(id) ON DELETE SET NULL,
  legal_entity_id uuid,
  endpoint text NOT NULL,
  query_params jsonb,
  status_code integer NOT NULL,
  row_count integer,
  ip text,
  ua text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.pakkesystem_api_log(api_key_id, created_at DESC);

GRANT SELECT ON public.pakkesystem_api_log TO authenticated;
GRANT ALL ON public.pakkesystem_api_log TO service_role;

ALTER TABLE public.pakkesystem_api_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform owners can read pakkesystem log"
  ON public.pakkesystem_api_log FOR SELECT
  TO authenticated
  USING (public.is_platform_owner(auth.uid()));
