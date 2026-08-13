CREATE TABLE public.statistic_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id),
  display_name text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  is_report_bound boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, display_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.statistic_groups TO authenticated;
GRANT ALL ON public.statistic_groups TO service_role;
ALTER TABLE public.statistic_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY statistic_groups_select_in_entity ON public.statistic_groups
  FOR SELECT TO authenticated
  USING (has_position_in_entity(legal_entity_id) OR is_platform_admin());

CREATE POLICY statistic_groups_insert_write ON public.statistic_groups
  FOR INSERT TO authenticated
  WITH CHECK (has_position_in_entity(legal_entity_id) AND has_app_write_access('rapporter'));

CREATE POLICY statistic_groups_update_write ON public.statistic_groups
  FOR UPDATE TO authenticated
  USING (has_position_in_entity(legal_entity_id) AND has_app_write_access('rapporter'))
  WITH CHECK (has_position_in_entity(legal_entity_id) AND has_app_write_access('rapporter'));

CREATE POLICY statistic_groups_delete_write ON public.statistic_groups
  FOR DELETE TO authenticated
  USING (has_position_in_entity(legal_entity_id) AND has_app_write_access('rapporter'));

CREATE TRIGGER trg_statistic_groups_updated_at
  BEFORE UPDATE ON public.statistic_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.protect_report_bound_statistic_groups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_report_bound THEN
    RAISE EXCEPTION 'Statistikkgruppen «%» styrer en rapport og kan ikke slettes', OLD.display_name;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_report_bound THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'active' THEN
      RAISE EXCEPTION 'Statistikkgruppen «%» styrer en rapport og må alltid være aktiv', OLD.display_name;
    END IF;
    IF NEW.is_report_bound IS DISTINCT FROM OLD.is_report_bound THEN
      RAISE EXCEPTION 'Kan ikke fjerne rapportbindingen på statistikkgruppen «%»', OLD.display_name;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_protect_report_bound_statistic_groups
  BEFORE UPDATE OR DELETE ON public.statistic_groups
  FOR EACH ROW EXECUTE FUNCTION public.protect_report_bound_statistic_groups();

CREATE TABLE public.statistic_group_members (
  group_id uuid NOT NULL REFERENCES public.statistic_groups(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid DEFAULT auth.uid(),
  PRIMARY KEY (group_id, product_id)
);

CREATE INDEX idx_statistic_group_members_product ON public.statistic_group_members(product_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.statistic_group_members TO authenticated;
GRANT ALL ON public.statistic_group_members TO service_role;
ALTER TABLE public.statistic_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY sgm_select_in_entity ON public.statistic_group_members
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.statistic_groups g
    WHERE g.id = statistic_group_members.group_id
      AND (has_position_in_entity(g.legal_entity_id) OR is_platform_admin())
  ));

CREATE POLICY sgm_insert_write ON public.statistic_group_members
  FOR INSERT TO authenticated
  WITH CHECK (has_app_write_access('rapporter') AND EXISTS (
    SELECT 1 FROM public.statistic_groups g
    WHERE g.id = statistic_group_members.group_id
      AND has_position_in_entity(g.legal_entity_id)
  ));

CREATE POLICY sgm_update_write ON public.statistic_group_members
  FOR UPDATE TO authenticated
  USING (has_app_write_access('rapporter') AND EXISTS (
    SELECT 1 FROM public.statistic_groups g
    WHERE g.id = statistic_group_members.group_id
      AND has_position_in_entity(g.legal_entity_id)
  ))
  WITH CHECK (has_app_write_access('rapporter') AND EXISTS (
    SELECT 1 FROM public.statistic_groups g
    WHERE g.id = statistic_group_members.group_id
      AND has_position_in_entity(g.legal_entity_id)
  ));

CREATE POLICY sgm_delete_write ON public.statistic_group_members
  FOR DELETE TO authenticated
  USING (has_app_write_access('rapporter') AND EXISTS (
    SELECT 1 FROM public.statistic_groups g
    WHERE g.id = statistic_group_members.group_id
      AND has_position_in_entity(g.legal_entity_id)
  ));

INSERT INTO public.statistic_groups (legal_entity_id, display_name, description, sort_order, is_report_bound)
VALUES ('751709bc-04b3-4449-867d-b97faa9ab373', 'NG-sortiment', 'Styrer vareutvalget i NG DirekteLevert-eksporten til NorgesGruppen', 0, true);