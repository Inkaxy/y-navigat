create or replace function public.rm_confirm_line_match(
  p_invoice_line_id uuid,
  p_raw_material_id uuid,
  p_package_size numeric default null,
  p_package_unit text default null,
  p_base_units_per_package numeric default null,
  p_confirm_package boolean default false,
  p_agreed_price_per_base_unit numeric default null,
  p_set_primary boolean default false,
  p_apply_line_ids uuid[] default null,
  p_offer_start_price boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  l record;
  i record;
  rm record;
  s record;
  v_entity uuid;
  v_supplier uuid;
  v_rms_id uuid;
  v_line_ids uuid[];
  v_now timestamptz := now();
  v_pkg_size numeric;
  v_pkg_unit text;
  v_bupp numeric;
  v_bupp_conf numeric;
  v_agreed numeric;
  v_any_primary boolean;
  v_has_link boolean;
  v_settings record;
  v_start jsonb;
  v_agreement_valid boolean := false;
  v_keep constant text[] := array['extraction_unresolved', 'unsupported_currency', 'missing_base_unit'];
  v_preserved jsonb := '{}'::jsonb;
  v_target_keep text[];
  v_arr text[];
  r record;
begin
  if auth.uid() is null then
    raise exception 'Krever pålogging';
  end if;

  select il.* into l from public.invoice_lines il where il.id = p_invoice_line_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'linjen_finnes_ikke');
  end if;

  select inv.* into i from public.invoices inv where inv.id = l.invoice_id for share;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'fakturaen_finnes_ikke');
  end if;

  v_entity := i.legal_entity_id;
  v_supplier := i.supplier_id;
  if v_entity is null then
    return jsonb_build_object('ok', false, 'reason', 'fakturaen_mangler_selskap');
  end if;
  if not public.has_ravarer_invoice_access(v_entity, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer for dette selskapet';
  end if;
  if i.flagged_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'fakturaen_er_flagget');
  end if;
  if v_supplier is null then
    return jsonb_build_object('ok', false, 'reason', 'fakturaen_mangler_leverandor');
  end if;

  select r2.* into rm from public.raw_materials r2 where r2.id = p_raw_material_id for share;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'varen_finnes_ikke');
  end if;
  if rm.legal_entity_id is distinct from v_entity then
    return jsonb_build_object('ok', false, 'reason', 'faktura_og_vare_i_ulike_selskap');
  end if;
  if not exists (
    select 1 from public.suppliers sup
     where sup.id = v_supplier and sup.legal_entity_id = v_entity
  ) then
    return jsonb_build_object('ok', false, 'reason', 'leverandor_i_annet_selskap');
  end if;

  select coalesce(array_agg(distinct il.id), array[]::uuid[]) into v_line_ids
    from public.invoice_lines il
   where il.invoice_id = l.invoice_id
     and (il.id = p_invoice_line_id
          or (p_apply_line_ids is not null and il.id = any(p_apply_line_ids)));

  select coalesce(jsonb_object_agg(x.id::text, to_jsonb(x.keep)), '{}'::jsonb) into v_preserved
    from (
      select il.id,
             coalesce((
               select array_agg(distinct btrim(t))
                 from unnest(string_to_array(coalesce(il.review_reason, ''), ',')) t
                where btrim(t) = any (v_keep)
             ), '{}'::text[]) as keep
        from public.invoice_lines il
       where il.id = any (v_line_ids)
    ) x;

  v_target_keep := coalesce(
    (select array_agg(v) from jsonb_array_elements_text(v_preserved -> p_invoice_line_id::text) v),
    '{}'::text[]);

  v_pkg_size := case when p_package_size is not null and public.rm_is_finite(p_package_size) and p_package_size > 0
                     then p_package_size end;
  v_pkg_unit := nullif(btrim(coalesce(p_package_unit, '')), '');
  v_bupp := case when p_base_units_per_package is not null and public.rm_is_finite(p_base_units_per_package)
                      and p_base_units_per_package > 0
                 then p_base_units_per_package end;
  v_agreed := case when p_agreed_price_per_base_unit is not null
                        and public.rm_is_finite(p_agreed_price_per_base_unit)
                        and p_agreed_price_per_base_unit > 0
                   then p_agreed_price_per_base_unit end;

  select exists (
    select 1 from public.raw_material_suppliers
     where raw_material_id = p_raw_material_id and is_primary
  ) into v_any_primary;

  select * into s from public.raw_material_suppliers
   where raw_material_id = p_raw_material_id and supplier_id = v_supplier
   for update;
  v_has_link := found;

  if not v_has_link then
    insert into public.raw_material_suppliers (
      raw_material_id, supplier_id, supplier_sku, supplier_product_name,
      package_size, package_unit, base_units_per_package,
      package_confirmed_at, package_confirmed_by,
      agreed_price_per_base_unit, is_primary
    ) values (
      p_raw_material_id, v_supplier, l.supplier_sku, l.description,
      v_pkg_size, v_pkg_unit,
      case when p_confirm_package then v_bupp end,
      case when p_confirm_package and v_bupp is not null then v_now end,
      case when p_confirm_package and v_bupp is not null then auth.uid() end,
      v_agreed,
      p_set_primary and not v_any_primary
    )
    returning * into s;
  else
    update public.raw_material_suppliers
       set package_size = coalesce(v_pkg_size, package_size),
           package_unit = coalesce(v_pkg_unit, package_unit),
           base_units_per_package = case when p_confirm_package and v_bupp is not null
                                         then v_bupp else base_units_per_package end,
           package_confirmed_at = case when p_confirm_package and v_bupp is not null
                                       then v_now else package_confirmed_at end,
           package_confirmed_by = case when p_confirm_package and v_bupp is not null
                                       then auth.uid() else package_confirmed_by end,
           agreed_price_per_base_unit = coalesce(v_agreed, agreed_price_per_base_unit),
           updated_at = v_now
     where id = s.id
    returning * into s;
  end if;
  v_rms_id := s.id;

  if p_set_primary and not v_any_primary then
    update public.raw_material_suppliers set is_primary = false, updated_at = v_now
     where raw_material_id = p_raw_material_id and id <> v_rms_id;
    update public.raw_material_suppliers set is_primary = true, updated_at = v_now where id = v_rms_id;
    update public.raw_materials set primary_supplier_id = v_supplier where id = p_raw_material_id;
  end if;

  v_bupp_conf := case when s.package_confirmed_at is not null then s.base_units_per_package end;

  update public.invoice_lines il
     set raw_material_id = p_raw_material_id,
         match_confidence = 'manual',
         requires_review = false,
         review_reason = null,
         base_quantity = case
           when (public.rm_expected_base_quantity(il.quantity, il.unit, rm.base_unit, v_bupp_conf)->>'status') = 'ok'
             then (public.rm_expected_base_quantity(il.quantity, il.unit, rm.base_unit, v_bupp_conf)->>'expected')::numeric
           else null end,
         price_per_base_unit = case
           when (public.rm_expected_base_quantity(il.quantity, il.unit, rm.base_unit, v_bupp_conf)->>'status') = 'ok'
             and il.total_amount is not null and public.rm_is_finite(il.total_amount) and il.total_amount > 0
             then il.total_amount
                  / (public.rm_expected_base_quantity(il.quantity, il.unit, rm.base_unit, v_bupp_conf)->>'expected')::numeric
           else null end,
         resolved_by = auth.uid(),
         resolved_at = v_now
   where il.id = any(v_line_ids);

  select * into v_settings from public.invoice_match_settings where legal_entity_id = v_entity;

  v_agreement_valid := s.agreed_price_per_base_unit is not null
    and (s.agreement_valid_from is null or i.invoice_date is null or s.agreement_valid_from <= i.invoice_date)
    and (s.agreement_valid_to is null or i.invoice_date is null or s.agreement_valid_to >= i.invoice_date);

  if not coalesce(p_offer_start_price, true) then
    v_start := jsonb_build_object('attempted', false, 'created', false, 'reason', 'ikke_forespurt');
  elsif coalesce(v_settings.use_first_confirmed_price_as_start, false) is not true then
    v_start := jsonb_build_object('attempted', false, 'created', false, 'reason', 'ikke_slatt_pa');
  elsif array_length(v_target_keep, 1) is not null then
    v_start := jsonb_build_object('attempted', false, 'created', false,
                                  'reason', 'uavklart_gjennomgangsarsak',
                                  'blockers', to_jsonb(v_target_keep));
  elsif v_agreement_valid then
    v_start := jsonb_build_object('attempted', false, 'created', false, 'reason', 'avtalepris_finnes');
  elsif s.start_price_per_base_unit is not null then
    v_start := jsonb_build_object('attempted', false, 'created', false, 'reason', 'startpris_finnes_allerede',
                                  'start_price', s.start_price_per_base_unit);
  else
    v_start := public.rm_confirm_start_price(p_invoice_line_id, null) || jsonb_build_object('attempted', true);
  end if;

  for r in select unnest(v_line_ids) as id loop
    v_arr := coalesce(
      (select array_agg(v) from jsonb_array_elements_text(v_preserved -> r.id::text) v),
      '{}'::text[]);
    v_arr := array_append(v_arr, 'recalculation_pending');
    update public.invoice_lines
       set requires_review = true,
           review_reason = array_to_string(v_arr, ',')
     where id = r.id;
  end loop;

  insert into public.audit_log (user_id, action, entity_type, entity_id, entity_display_reference,
                                legal_entity_id, changes, source_app)
  values (auth.uid(), 'invoice_line_match_confirmed', 'invoice_line', p_invoice_line_id,
          coalesce(rm.name, '') || ' / ' || coalesce(i.invoice_number, ''),
          v_entity,
          jsonb_build_object(
            'raw_material_id', p_raw_material_id,
            'raw_material_supplier_id', v_rms_id,
            'line_ids', to_jsonb(v_line_ids),
            'package_confirmed', p_confirm_package,
            'preserved_review_reasons', v_preserved,
            'start_price', v_start),
          'nbhub');

  return jsonb_build_object(
    'ok', true,
    'line_ids', to_jsonb(v_line_ids),
    'raw_material_supplier_id', v_rms_id,
    'preserved_review_reasons', v_preserved,
    'recalculation_pending', true,
    'start_price', v_start);
end;
$function$;

revoke all on function public.rm_confirm_line_match(uuid, uuid, numeric, text, numeric, boolean, numeric, boolean, uuid[], boolean) from public, anon;
grant execute on function public.rm_confirm_line_match(uuid, uuid, numeric, text, numeric, boolean, numeric, boolean, uuid[], boolean) to authenticated, service_role;