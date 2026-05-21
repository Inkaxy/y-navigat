CREATE OR REPLACE FUNCTION public.get_label_products_for_date(p_date date, p_legal_entity_id uuid, p_tour_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(product_id uuid, display_number bigint, display_name text, label_mode text, label_print_model text, department_ids uuid[], total_labels integer, order_line_ids uuid[], unique_notes text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH eligible_lines AS (
    SELECT
      ol.id AS order_line_id,
      ol.order_id,
      ol.product_id,
      ol.quantity,
      ol.notes,
      p.display_number,
      p.display_name,
      p.label_mode,
      p.label_print_model
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    JOIN public.products p ON p.id = ol.product_id
    WHERE o.legal_entity_id = p_legal_entity_id
      AND o.delivery_date = p_date
      AND o.status NOT IN ('cancelled','draft')
      AND p.label_mode <> 'none'
      AND (p_tour_ids IS NULL OR o.delivery_tour_id = ANY(p_tour_ids))
  ),
  per_product AS (
    SELECT
      el.product_id,
      MAX(el.display_number) AS display_number,
      MAX(el.display_name) AS display_name,
      MAX(el.label_mode) AS label_mode,
      MAX(el.label_print_model) AS label_print_model,
      array_agg(DISTINCT el.order_line_id) AS order_line_ids,
      array_remove(array_agg(DISTINCT NULLIF(trim(el.notes), '')), NULL) AS unique_notes,
      CASE MAX(el.label_mode)
        WHEN 'per_unit' THEN COALESCE(SUM(CEIL(el.quantity)), 0)::INTEGER
        WHEN 'per_order_or_note' THEN COUNT(DISTINCT el.order_id)::INTEGER
          + COUNT(DISTINCT NULLIF(trim(el.notes), ''))::INTEGER
        WHEN 'per_note' THEN COUNT(DISTINCT NULLIF(trim(el.notes), ''))::INTEGER
        WHEN 'per_order' THEN COUNT(DISTINCT el.order_id)::INTEGER
        ELSE 0
      END AS total_labels
    FROM eligible_lines el
    GROUP BY el.product_id
  )
  SELECT
    pp.product_id,
    pp.display_number,
    pp.display_name,
    pp.label_mode,
    pp.label_print_model,
    COALESCE(
      (SELECT array_agg(pld.department_id ORDER BY pld.department_id)
       FROM public.product_label_departments pld
       WHERE pld.product_id = pp.product_id),
      ARRAY[]::UUID[]
    ) AS department_ids,
    pp.total_labels,
    pp.order_line_ids,
    pp.unique_notes
  FROM per_product pp
  ORDER BY pp.display_number;
END;
$function$;