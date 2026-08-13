CREATE TABLE public.report_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id),
  display_name text NOT NULL,
  report_kind text NOT NULL CHECK (report_kind IN ('statistikk','trender','kunder','sammenligning')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_favorite boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, display_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_definitions TO authenticated;
GRANT ALL ON public.report_definitions TO service_role;

ALTER TABLE public.report_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_definitions_select_in_entity ON public.report_definitions
  FOR SELECT TO authenticated
  USING (has_position_in_entity(legal_entity_id) OR is_platform_admin());

CREATE POLICY report_definitions_insert_write ON public.report_definitions
  FOR INSERT TO authenticated
  WITH CHECK (has_position_in_entity(legal_entity_id) AND has_app_write_access('rapporter'::text));

CREATE POLICY report_definitions_update_write ON public.report_definitions
  FOR UPDATE TO authenticated
  USING (has_position_in_entity(legal_entity_id) AND has_app_write_access('rapporter'::text))
  WITH CHECK (has_position_in_entity(legal_entity_id) AND has_app_write_access('rapporter'::text));

CREATE POLICY report_definitions_delete_write ON public.report_definitions
  FOR DELETE TO authenticated
  USING (has_position_in_entity(legal_entity_id) AND has_app_write_access('rapporter'::text));

CREATE TRIGGER set_report_definitions_updated_at
  BEFORE UPDATE ON public.report_definitions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX report_definitions_entity_idx ON public.report_definitions (legal_entity_id, is_favorite DESC, sort_order, display_name);

CREATE OR REPLACE FUNCTION public.powerbi_sales_extract(
  p_legal_entity_id uuid,
  p_period_start date,
  p_period_end date
)
RETURNS TABLE(
  maned text,
  kundenr text,
  kundenavn text,
  kundeprofil text,
  varenr text,
  varenavn text,
  gtin text,
  statistikkgrupper text,
  belop numeric,
  antall numeric,
  ordrer integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_platform_admin() OR (public.has_position_in_entity(p_legal_entity_id) AND public.app_access_level('rapporter') <> 'none')) THEN
    RAISE EXCEPTION 'Ingen tilgang til rapporter for denne enheten';
  END IF;

  RETURN QUERY
  SELECT
    to_char(date_trunc('month', o.delivery_date), 'YYYY-MM')::text,
    c.customer_number::text,
    c.display_name::text,
    cp.display_name::text,
    pr.display_number::text,
    pr.display_name::text,
    pr.gtin::text,
    (
      SELECT string_agg(g.display_name, ', ' ORDER BY g.display_name)
      FROM public.statistic_group_members m
      JOIN public.statistic_groups g ON g.id = m.group_id
      WHERE m.product_id = pr.id AND g.legal_entity_id = p_legal_entity_id
    )::text,
    SUM(COALESCE(ol.line_subtotal_excl_vat, 0))::numeric,
    SUM(COALESCE(ol.quantity, 0))::numeric,
    COUNT(DISTINCT o.id)::integer
  FROM public.order_lines ol
  JOIN public.orders o ON o.id = ol.order_id
  JOIN public.customers c ON c.id = o.customer_id
  JOIN public.products pr ON pr.id = ol.product_id
  LEFT JOIN public.customer_profiles cp ON cp.id = c.customer_profile_id
  WHERE o.legal_entity_id = p_legal_entity_id
    AND o.delivery_date BETWEEN p_period_start AND p_period_end
    AND o.status IN ('delivered','partial_delivery','invoiced')
  GROUP BY date_trunc('month', o.delivery_date), c.customer_number, c.display_name, cp.display_name,
           pr.id, pr.display_number, pr.display_name, pr.gtin
  ORDER BY 1, 3, 6;
END;
$function$;

REVOKE ALL ON FUNCTION public.powerbi_sales_extract(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.powerbi_sales_extract(uuid, date, date) TO authenticated;