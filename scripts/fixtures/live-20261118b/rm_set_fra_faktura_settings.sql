CREATE OR REPLACE FUNCTION public.rm_set_fra_faktura_settings(p_legal_entity_id uuid, p_price_jump_pct numeric, p_quiet_prices boolean DEFAULT NULL::boolean, p_invoice_package boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_old jsonb;
begin
  if v_uid is null then raise exception 'Krever pålogging' using errcode = '28000'; end if;
  if not coalesce(public.has_ravarer_invoice_approve(p_legal_entity_id), false) then
    raise exception 'Krever godkjennerrettighet' using errcode = '42501';
  end if;
  if p_price_jump_pct is not null and (p_price_jump_pct < 1 or p_price_jump_pct > 1000) then
    raise exception 'Grensen må være mellom 1 og 1000 %%' using errcode = '22023';
  end if;
  select to_jsonb(s) into v_old from public.invoice_match_settings s where legal_entity_id = p_legal_entity_id for update;
  if v_old is null then
    insert into public.invoice_match_settings (legal_entity_id, price_jump_pct, fra_faktura_quiet_prices, fra_faktura_invoice_package, updated_by, updated_at)
    values (p_legal_entity_id, p_price_jump_pct, p_quiet_prices, p_invoice_package, v_uid, now());
  else
    update public.invoice_match_settings
       set price_jump_pct = p_price_jump_pct,
           fra_faktura_quiet_prices = coalesce(p_quiet_prices, fra_faktura_quiet_prices),
           fra_faktura_invoice_package = coalesce(p_invoice_package, fra_faktura_invoice_package),
           updated_by = v_uid, updated_at = now()
     where legal_entity_id = p_legal_entity_id;
  end if;
  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'fra_faktura.settings_changed', 'legal_entity', p_legal_entity_id, p_legal_entity_id,
          jsonb_build_object('before', v_old -> 'price_jump_pct', 'price_jump_pct', p_price_jump_pct,
                             'quiet_prices', p_quiet_prices, 'invoice_package', p_invoice_package),
          'Fra faktura: innstillinger', 'ravarer');
  return public.rm_fra_faktura_settings(p_legal_entity_id);
end $function$
