INSERT INTO public.price_list_items (price_list_id, product_id, price, min_quantity, valid_from)
SELECT
  '57064f0e-9597-48d5-afaa-e3a274d3196f'::uuid,
  p.id,
  ROUND( (35 + (abs(hashtext(p.id::text)) % 251))::numeric / 5 ) * 5,
  1,
  CURRENT_DATE
FROM public.products p
WHERE p.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.price_list_items pli
    WHERE pli.price_list_id = '57064f0e-9597-48d5-afaa-e3a274d3196f'::uuid
      AND pli.product_id = p.id
  );