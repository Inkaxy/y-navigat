
CREATE INDEX IF NOT EXISTS idx_products_display_name_trgm
  ON public.products USING gin (display_name gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_products_trgm(
  p_legal_entity_id uuid,
  p_query text,
  p_limit int DEFAULT 10
)
RETURNS TABLE(id uuid, display_name text, display_number text, unit_of_sale text, similarity real)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p.id, p.display_name, p.display_number, p.unit_of_sale,
         similarity(p.display_name, p_query) AS similarity
  FROM public.products p
  WHERE p.legal_entity_id = p_legal_entity_id
    AND p.status = 'active'
    AND p.is_for_sale = true
    AND p.display_name % p_query
  ORDER BY similarity(p.display_name, p_query) DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_products_trgm(uuid, text, int) TO authenticated, service_role;

INSERT INTO public.platform_settings (category, key, value)
SELECT 'ordre_ai', 'mailbox_legal_entity_map',
       '{"ordre@nottero-bakeri.no": "751709bc-04b3-4449-867d-b97faa9ab373"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.platform_settings
  WHERE category='ordre_ai' AND key='mailbox_legal_entity_map'
);
