CREATE OR REPLACE FUNCTION public.get_invoice_run_preview_customers(
  p_legal_entity_id uuid,
  p_run_date date,
  p_groups text[] DEFAULT NULL
)
RETURNS TABLE(
  recipient_id uuid,
  customer_name text,
  invoicing_group text,
  order_count bigint,
  sum_incl_vat numeric
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
  WITH candidate_orders AS (
    SELECT
      o.id AS order_id,
      COALESCE(o.invoice_recipient_customer_id, o.customer_id) AS rid,
      o.total_incl_vat
    FROM public.orders o
    WHERE o.legal_entity_id = p_legal_entity_id
      AND (
        (COALESCE(o.is_return, false) = false AND o.status = 'delivered')
        OR (COALESCE(o.is_return, false) = true AND o.status IN ('confirmed','delivered'))
      )
      AND o.delivery_date <= p_run_date
      AND NOT EXISTS (SELECT 1 FROM public.invoice_basis_orders ibo WHERE ibo.order_id = o.id)
  ),
  with_group AS (
    SELECT
      co.rid,
      co.order_id,
      co.total_incl_vat,
      c.name AS customer_name,
      NULLIF(COALESCE(c.profile_overrides->>'invoicing_group', cp.invoicing_group), '') AS invoicing_group
    FROM candidate_orders co
    LEFT JOIN public.customers c ON c.id = co.rid
    LEFT JOIN public.customer_profiles cp ON cp.id = c.customer_profile_id
  )
  SELECT
    wg.rid AS recipient_id,
    COALESCE(wg.customer_name, '—') AS customer_name,
    wg.invoicing_group,
    COUNT(*)::bigint AS order_count,
    COALESCE(SUM(wg.total_incl_vat), 0)::numeric AS sum_incl_vat
  FROM with_group wg
  WHERE p_groups IS NULL
     OR array_length(p_groups, 1) IS NULL
     OR COALESCE(wg.invoicing_group, '__none') = ANY(p_groups)
  GROUP BY wg.rid, wg.customer_name, wg.invoicing_group
  ORDER BY customer_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_invoice_run_preview_customers(uuid, date, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_run_preview_customers(uuid, date, text[]) TO authenticated, service_role;