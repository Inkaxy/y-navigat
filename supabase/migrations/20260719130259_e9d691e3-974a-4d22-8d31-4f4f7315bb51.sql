CREATE OR REPLACE FUNCTION public.portal_list_products()
 RETURNS TABLE(product_id uuid, display_number bigint, display_name text, description text, image_url text, unit_of_sale text, mva_rate numeric, is_divisible boolean, pieces_per_unit numeric, lead_time_days integer, pause_delivery_from date, pause_delivery_to date, product_category text, price numeric, prices_include_mva boolean, min_quantity numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (p.id)
    p.id,
    p.display_number,
    p.display_name,
    p.description,
    p.image_url,
    p.unit_of_sale,
    p.mva_rate,
    p.is_divisible,
    p.pieces_per_unit,
    p.lead_time_days,
    p.pause_delivery_from,
    p.pause_delivery_to,
    p.product_category,
    pli.price,
    pl.prices_include_mva,
    pli.min_quantity
  FROM public.customer_portal_accounts cpa
  JOIN public.customers c ON c.id = cpa.customer_id
  JOIN public.price_lists pl ON pl.id = c.default_price_list_id
  JOIN public.price_list_items pli
    ON pli.price_list_id = pl.id
   AND pli.valid_from <= CURRENT_DATE
   AND (pli.valid_to IS NULL OR pli.valid_to >= CURRENT_DATE)
   AND pli.price > 0.1
  JOIN public.products p ON p.id = pli.product_id
  WHERE cpa.user_id = auth.uid()
    AND cpa.is_active = true
    AND p.status <> 'discontinued'
    AND p.is_for_sale = true
  ORDER BY p.id, pli.valid_from DESC, pli.price ASC
$function$;