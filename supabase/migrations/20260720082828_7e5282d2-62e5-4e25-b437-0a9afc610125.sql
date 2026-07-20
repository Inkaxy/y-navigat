DROP FUNCTION IF EXISTS public.portal_list_bakeable_products();
CREATE OR REPLACE FUNCTION public.portal_list_bakeable_products()
 RETURNS TABLE(id uuid, display_number integer, code text, display_name text, unit_of_sale text, baked_product_id uuid, baked_display_name text, pieces_per_tray integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cust AS (
    SELECT c.id, c.default_price_list_id AS price_list_id, c.bakes_own_products
    FROM customers c WHERE c.id = public.current_portal_customer_id()
  )
  SELECT DISTINCT ON (p.id)
    p.id, p.display_number::int, p.code, p.display_name, p.unit_of_sale,
    p.baked_product_id, bp.display_name, p.pieces_per_tray::int
  FROM cust
  JOIN price_list_items pli
    ON pli.price_list_id = cust.price_list_id
   AND pli.price > 0.10
   AND pli.valid_from <= CURRENT_DATE
   AND (pli.valid_to IS NULL OR pli.valid_to >= CURRENT_DATE)
  JOIN products p
    ON p.id = pli.product_id
   AND p.is_bakeable_raw = true
   AND p.status <> 'discontinued'
  LEFT JOIN products bp ON bp.id = p.baked_product_id
  WHERE cust.bakes_own_products = true
  ORDER BY p.id, p.display_number DESC;
$function$;
GRANT EXECUTE ON FUNCTION public.portal_list_bakeable_products() TO authenticated;