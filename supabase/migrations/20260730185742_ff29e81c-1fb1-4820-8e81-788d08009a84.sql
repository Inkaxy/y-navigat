-- 1) Engangs-backfill: kopier product_ids -> allowed_product_ids for available_products
UPDATE public.delivery_rules
SET allowed_product_ids = product_ids,
    product_ids = NULL
WHERE rule_type = 'available_products'
  AND product_ids IS NOT NULL
  AND array_length(product_ids, 1) > 0
  AND (allowed_product_ids IS NULL OR array_length(allowed_product_ids, 1) IS NULL);

UPDATE public.delivery_rules
SET allowed_product_group_ids = product_group_ids,
    product_group_ids = NULL
WHERE rule_type = 'available_products'
  AND product_group_ids IS NOT NULL
  AND array_length(product_group_ids, 1) > 0
  AND (allowed_product_group_ids IS NULL OR array_length(allowed_product_group_ids, 1) IS NULL);
