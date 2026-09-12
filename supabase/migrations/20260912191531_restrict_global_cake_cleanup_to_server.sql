-- NBHUB internal launch: global cleanup is a server operation.
-- Keep existing postgres owner and service_role access. No data is deleted.
REVOKE EXECUTE ON FUNCTION public.cleanup_old_printed_cake_images() FROM PUBLIC, anon, authenticated;
