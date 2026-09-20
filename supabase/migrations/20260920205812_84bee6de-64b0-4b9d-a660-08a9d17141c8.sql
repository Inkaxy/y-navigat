create or replace function public.rm_start_price_to_agreement(p_rms_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare s record; v_entity uuid;
begin
  if auth.uid() is null then raise exception 'Krever pålogging'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Begrunnelse er påkrevd'; end if;

  select rms.*, rm2.legal_entity_id, rm2.base_unit as current_base_unit into s
    from public.raw_material_suppliers rms
    join public.raw_materials rm2 on rm2.id = rms.raw_material_id
   where rms.id = p_rms_id
     for update of rms;
  if not found then raise exception 'Leverandørkoblingen finnes ikke'; end if;
  v_entity := s.legal_entity_id;
  if not public.has_ravarer_invoice_access(v_entity, 'approve') then
    raise exception 'Krever godkjennerrettighet for fakturaer i dette selskapet';
  end if;
  if s.start_price_per_base_unit is null then
    raise exception 'Det finnes ingen startpris å gjøre om til avtalepris';
  end if;
  if s.start_price_base_unit is distinct from s.current_base_unit then
    raise exception 'Grunnenheten er endret etter at startprisen ble bekreftet — startprisen må bekreftes på nytt';
  end if;

  -- Avtalen gjelder FRA I DAG. En avtaleperiode skal aldri tilbakedateres til
  -- fakturadatoen: det ville gjort eldre fakturaer til avtalebrudd i ettertid.
  update public.raw_material_suppliers
     set agreed_price_per_base_unit = s.start_price_per_base_unit,
         agreed_price_set_by = auth.uid(),
         agreed_price_set_at = now(),
         agreement_valid_from = coalesce(s.agreement_valid_from, (now() at time zone 'Europe/Oslo')::date),
         updated_at = now()
   where id = p_rms_id;

  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (auth.uid(), 'start_price_set_as_agreement', 'raw_material_supplier', p_rms_id, v_entity,
          jsonb_build_object(
            'old', jsonb_build_object('agreed_price_per_base_unit', s.agreed_price_per_base_unit,
                                      'agreement_valid_from', s.agreement_valid_from),
            'new', jsonb_build_object('agreed_price_per_base_unit', s.start_price_per_base_unit,
                                      'agreement_valid_from',
                                      coalesce(s.agreement_valid_from, (now() at time zone 'Europe/Oslo')::date),
                                      'from_start_price', true)),
          p_reason, 'fakturaer');

  return jsonb_build_object('updated', true, 'agreed_price_per_base_unit', s.start_price_per_base_unit);
end;
$function$;

revoke all on function public.rm_start_price_to_agreement(uuid, text) from public, anon;
grant execute on function public.rm_start_price_to_agreement(uuid, text) to authenticated, service_role;