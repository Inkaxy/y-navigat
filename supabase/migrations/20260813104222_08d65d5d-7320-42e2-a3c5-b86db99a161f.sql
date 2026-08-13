CREATE OR REPLACE FUNCTION public.sales_aggregate(
  p_legal_entity_id uuid,
  p_period_start date,
  p_period_end date,
  p_dimension text DEFAULT 'product',
  p_granularity text DEFAULT 'total',
  p_customer_id uuid DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_statistic_group_id uuid DEFAULT NULL,
  p_customer_profile_id uuid DEFAULT NULL
)
RETURNS TABLE(
  bucket date,
  dim_id uuid,
  dim_code text,
  dim_label text,
  amount numeric,
  quantity numeric,
  line_count bigint,
  order_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_platform_admin() OR (public.has_position_in_entity(p_legal_entity_id) AND public.app_access_level('rapporter') <> 'none')) THEN
    RAISE EXCEPTION 'Ingen tilgang til rapporter for denne enheten';
  END IF;

  IF p_dimension NOT IN ('product','customer','main_category','sub_category','statistic_group','customer_profile') THEN
    RAISE EXCEPTION 'Ugyldig dimensjon: %', p_dimension;
  END IF;
  IF p_granularity NOT IN ('total','day','week','month') THEN
    RAISE EXCEPTION 'Ugyldig granularitet: %', p_granularity;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      o.id AS order_id,
      o.delivery_date,
      ol.id AS line_id,
      COALESCE(ol.line_subtotal_excl_vat, 0)::numeric AS amount,
      COALESCE(ol.quantity, 0)::numeric AS quantity,
      pr.id AS product_id,
      pr.display_number::text AS product_code,
      pr.display_name::text AS product_name,
      c.id AS customer_id,
      c.customer_number::text AS customer_code,
      c.display_name::text AS customer_name,
      pr.main_category_id,
      pr.sub_category_id,
      c.customer_profile_id
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    JOIN public.customers c ON c.id = o.customer_id
    JOIN public.products pr ON pr.id = ol.product_id
    WHERE o.legal_entity_id = p_legal_entity_id
      AND o.delivery_date BETWEEN p_period_start AND p_period_end
      AND o.status IN ('delivered','partial_delivery','invoiced')
      AND (p_customer_id IS NULL OR c.id = p_customer_id)
      AND (p_product_id IS NULL OR pr.id = p_product_id)
      AND (p_customer_profile_id IS NULL OR c.customer_profile_id = p_customer_profile_id)
      AND (
        p_statistic_group_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.statistic_group_members m
          WHERE m.product_id = pr.id AND m.group_id = p_statistic_group_id
        )
      )
  ),
  bucketed AS (
    SELECT
      CASE p_granularity
        WHEN 'day' THEN b.delivery_date
        WHEN 'week' THEN (date_trunc('week', b.delivery_date))::date
        WHEN 'month' THEN (date_trunc('month', b.delivery_date))::date
        ELSE NULL::date
      END AS bucket,
      CASE p_dimension
        WHEN 'product' THEN b.product_id
        WHEN 'customer' THEN b.customer_id
        WHEN 'main_category' THEN b.main_category_id
        WHEN 'sub_category' THEN b.sub_category_id
        WHEN 'customer_profile' THEN b.customer_profile_id
        ELSE sg.id
      END AS dim_id,
      CASE p_dimension
        WHEN 'product' THEN b.product_code
        WHEN 'customer' THEN b.customer_code
        WHEN 'main_category' THEN mc.code::text
        WHEN 'sub_category' THEN sc.code::text
        WHEN 'customer_profile' THEN cp.code::text
        ELSE NULL::text
      END AS dim_code,
      CASE p_dimension
        WHEN 'product' THEN b.product_name
        WHEN 'customer' THEN b.customer_name
        WHEN 'main_category' THEN COALESCE(mc.display_name::text, '(uten hovedkategori)')
        WHEN 'sub_category' THEN COALESCE(sc.display_name::text, '(uten underkategori)')
        WHEN 'customer_profile' THEN COALESCE(cp.display_name::text, '(uten kundeprofil)')
        ELSE COALESCE(sg.display_name::text, '(uten statistikkgruppe)')
      END AS dim_label,
      b.amount,
      b.quantity,
      b.line_id,
      b.order_id
    FROM base b
    LEFT JOIN public.product_main_categories mc ON mc.id = b.main_category_id
    LEFT JOIN public.product_sub_categories sc ON sc.id = b.sub_category_id
    LEFT JOIN public.customer_profiles cp ON cp.id = b.customer_profile_id
    LEFT JOIN LATERAL (
      SELECT g.id, g.display_name
      FROM public.statistic_group_members m
      JOIN public.statistic_groups g ON g.id = m.group_id
      WHERE m.product_id = b.product_id
        AND g.legal_entity_id = p_legal_entity_id
      ORDER BY g.sort_order NULLS LAST, g.display_name
      LIMIT 1
    ) sg ON p_dimension = 'statistic_group'
  )
  SELECT
    bk.bucket,
    bk.dim_id,
    MAX(bk.dim_code) AS dim_code,
    bk.dim_label,
    SUM(bk.amount)::numeric AS amount,
    SUM(bk.quantity)::numeric AS quantity,
    COUNT(bk.line_id)::bigint AS line_count,
    COUNT(DISTINCT bk.order_id)::bigint AS order_count
  FROM bucketed bk
  GROUP BY bk.bucket, bk.dim_id, bk.dim_label
  ORDER BY bk.bucket NULLS FIRST, SUM(bk.amount) DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.sales_aggregate(uuid,date,date,text,text,uuid,uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_aggregate(uuid,date,date,text,text,uuid,uuid,uuid,uuid) TO authenticated;