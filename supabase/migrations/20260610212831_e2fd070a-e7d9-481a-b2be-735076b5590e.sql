REVOKE EXECUTE ON FUNCTION public.pos_sync_customer(uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_customer(uuid, boolean) TO authenticated;