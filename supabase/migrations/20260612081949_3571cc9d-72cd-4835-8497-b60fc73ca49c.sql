
REVOKE EXECUTE ON FUNCTION public.pos_set_product_station(uuid, uuid) FROM anon, service_role;
REVOKE EXECUTE ON FUNCTION public.pos_set_product_name(uuid, text) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.pos_set_product_station(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pos_set_product_name(uuid, text) TO authenticated;
