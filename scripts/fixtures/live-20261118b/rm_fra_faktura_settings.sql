CREATE OR REPLACE FUNCTION public.rm_fra_faktura_settings(p_legal_entity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record;
begin
  if auth.uid() is null or not public.has_ravarer_invoice_access(p_legal_entity_id, 'read') then
    raise exception 'Mangler tilgang til fakturaer' using errcode = '42501';
  end if;
  select price_jump_pct, fra_faktura_quiet_prices, fra_faktura_invoice_package into s
    from public.invoice_match_settings where legal_entity_id = p_legal_entity_id;
  return jsonb_build_object(
    'ok', true,
    'price_jump_pct', coalesce(s.price_jump_pct, 20),
    'price_jump_is_default', s.price_jump_pct is null,
    'quiet_prices', coalesce(s.fra_faktura_quiet_prices, false),
    'invoice_package', coalesce(s.fra_faktura_invoice_package, false),
    'can_edit', coalesce(public.has_ravarer_invoice_approve(p_legal_entity_id), false));
end $function$
