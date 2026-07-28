CREATE OR REPLACE FUNCTION public.get_invoice_run_preview_lines(
  p_legal_entity_id uuid,
  p_run_date date,
  p_groups text[] DEFAULT NULL
)
RETURNS TABLE(
  order_id uuid,
  order_number text,
  customer_number text,
  customer_name text,
  delivery_date date,
  tour_number int,
  invoicing_group text,
  sum_excl_vat numeric,
  sum_incl_vat numeric,
  is_return boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING errcode = '42501';
  END IF;
  IF NOT has_position_in_entity(p_legal_entity_id) THEN
    RAISE EXCEPTION 'No position in entity' USING errcode = '42501';
  END IF;
  IF app_access_level('faktura') = 'none'::access_level THEN
    RAISE EXCEPTION 'No access to faktura' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT
    o.id AS order_id,
    o.order_number::text AS order_number,
    c.customer_number::text AS customer_number,
    COALESCE(c.name, '—') AS customer_name,
    o.delivery_date,
    dt.tour_number AS tour_number,
    NULLIF(COALESCE(c.profile_overrides->>'invoicing_group', cp.invoicing_group), '') AS invoicing_group,
    COALESCE(o.subtotal_excl_vat, 0)::numeric AS sum_excl_vat,
    COALESCE(o.total_incl_vat, 0)::numeric AS sum_incl_vat,
    COALESCE(o.is_return, false) AS is_return
  FROM public.orders o
  LEFT JOIN public.customers c
    ON c.id = COALESCE(o.invoice_recipient_customer_id, o.customer_id)
  LEFT JOIN public.customer_profiles cp
    ON cp.id = c.customer_profile_id
  LEFT JOIN public.delivery_tours dt
    ON dt.id = o.delivery_tour_id
  WHERE o.legal_entity_id = p_legal_entity_id
    AND (
      (COALESCE(o.is_return, false) = false AND o.status = 'delivered')
      OR (COALESCE(o.is_return, false) = true AND o.status IN ('confirmed','delivered'))
    )
    AND o.delivery_date <= p_run_date
    AND NOT EXISTS (SELECT 1 FROM public.invoice_basis_orders ibo WHERE ibo.order_id = o.id)
    AND (
      p_groups IS NULL
      OR array_length(p_groups, 1) IS NULL
      OR COALESCE(NULLIF(COALESCE(c.profile_overrides->>'invoicing_group', cp.invoicing_group), ''), '__none') = ANY(p_groups)
    )
  ORDER BY COALESCE(c.name, '—'), o.delivery_date, o.order_number;
END;
$$;

REVOKE ALL ON FUNCTION public.get_invoice_run_preview_lines(uuid, date, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_run_preview_lines(uuid, date, text[]) TO authenticated, service_role;