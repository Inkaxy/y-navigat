revoke execute on function public.rm_price_reference(uuid, uuid, uuid, date) from public, anon;
revoke execute on function public.rm_price_summary(uuid, uuid, date) from public, anon;
revoke execute on function public.rm_supplier_link_candidates(uuid) from public, anon;
revoke execute on function public.rm_apply_supplier_link_lines(uuid, uuid[], timestamptz) from public, anon;
grant execute on function public.rm_price_reference(uuid, uuid, uuid, date) to authenticated, service_role;
grant execute on function public.rm_price_summary(uuid, uuid, date) to authenticated, service_role;
grant execute on function public.rm_supplier_link_candidates(uuid) to authenticated, service_role;
grant execute on function public.rm_apply_supplier_link_lines(uuid, uuid[], timestamptz) to authenticated, service_role;