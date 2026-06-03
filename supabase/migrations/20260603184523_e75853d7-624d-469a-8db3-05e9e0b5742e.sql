-- 1. Tabell
CREATE TABLE public.legal_entity_app_access (
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (legal_entity_id, app_id)
);

-- 2. Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_entity_app_access TO authenticated;
GRANT ALL ON public.legal_entity_app_access TO service_role;

-- 3. RLS
ALTER TABLE public.legal_entity_app_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read entity app access"
  ON public.legal_entity_app_access
  FOR SELECT
  TO authenticated
  USING (
    legal_entity_id IN (SELECT public.current_user_entity_ids())
    OR public.is_platform_owner(auth.uid())
  );

CREATE POLICY "Platform owners manage entity app access"
  ON public.legal_entity_app_access
  FOR ALL
  TO authenticated
  USING (public.is_platform_owner(auth.uid()))
  WITH CHECK (public.is_platform_owner(auth.uid()));

-- 4. updated_at trigger
CREATE TRIGGER set_legal_entity_app_access_updated_at
  BEFORE UPDATE ON public.legal_entity_app_access
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Ny RPC som filtrerer på selskap
CREATE OR REPLACE FUNCTION public.get_apps_for_entity(entity_id uuid)
RETURNS TABLE (
  id uuid,
  slug text,
  display_name text,
  category text,
  deploy_url text,
  start_path text,
  icon_name text,
  sort_order integer,
  status text,
  color_hex text,
  access_level public.access_level
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (a.id)
    a.id,
    a.code AS slug,
    a.display_name,
    a.category,
    a.deploy_url,
    a.start_path,
    a.icon AS icon_name,
    a.sort_order,
    a.status,
    a.color_hex,
    paa.level AS access_level
  FROM public.apps a
  JOIN public.position_app_access paa ON paa.app_id = a.id
  JOIN public.user_positions up ON up.position_id = paa.position_id
  WHERE up.user_id = auth.uid()
    AND paa.level <> 'none'::public.access_level
    AND a.status IN ('active', 'beta')
    AND NOT EXISTS (
      SELECT 1 FROM public.legal_entity_app_access lea
      WHERE lea.app_id = a.id
        AND lea.legal_entity_id = entity_id
        AND lea.enabled = false
    )
  ORDER BY a.id, paa.level DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_apps_for_entity(uuid) TO authenticated;