-- Idempotent replacement of actual live rm_link_supplier_item; existing EXECUTE ACL preserved.
CREATE OR REPLACE FUNCTION public.rm_link_supplier_item(p_legal_entity_id uuid, p_supplier_id uuid, p_item_key text, p_raw_material_id uuid DEFAULT NULL::uuid, p_new_raw_material jsonb DEFAULT NULL::jsonb, p_package jsonb DEFAULT NULL::jsonb, p_set_primary boolean DEFAULT false, p_not_raw_material boolean DEFAULT false, p_reason text DEFAULT NULL::text, p_line_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_guard_invoice_ids uuid[] := '{}'; v_guard_line_ids uuid[] := '{}';
  v_scoped boolean := p_line_ids is not null;
  v_uid uuid := auth.uid(); v_rm_id uuid := p_raw_material_id; v_created boolean := false;
  v_sku text; v_name text; v_base text; v_sup record; v_rms_id uuid;
  v_pkg_size numeric; v_pkg_unit text; v_bupp numeric; v_confirm boolean;
  v_line_ids uuid[] := '{}'; v_invoice_ids uuid[] := '{}'; v_failures jsonb := '[]'::jsonb;
  r record; v_first uuid; v_rest uuid[]; v_res jsonb; v_last_desc text; v_last_sku text; v_now timestamptz := now();
  v_excl_type text; v_excl_value text; v_updated int := 0; v_item_sku text; v_set_primary boolean := coalesce(p_set_primary, false);
begin
  if v_uid is null then raise exception 'Krever pålogging' using errcode = '28000'; end if;
  if not public.has_ravarer_invoice_access(p_legal_entity_id, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer' using errcode = '42501';
  end if;
  select * into v_sup from public.suppliers where id = p_supplier_id and legal_entity_id = p_legal_entity_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'leverandor_finnes_ikke'); end if;
  if p_item_key is null or p_item_key !~ '^(sku|name):' then return jsonb_build_object('ok', false, 'reason', 'ugyldig_varenokkel'); end if;

  -- Freeze the candidate set in the database transaction. Approval and cost posting
  -- also lock invoice -> lines; acquire in deterministic order before eligibility checks.
  if v_scoped and coalesce(cardinality(p_line_ids),0)=0 then
    raise exception 'tomt_linjeutvalg' using errcode='22023';
  end if;
  for r in
    select i.id from public.invoices i
    where i.legal_entity_id=p_legal_entity_id and i.supplier_id=p_supplier_id
      and exists(select 1 from public.invoice_lines il where il.invoice_id=i.id
        and (p_line_ids is null or il.id=any(p_line_ids))
        and (case when public.rm_sku_norm(il.supplier_sku)<>'' then 'sku:'||public.rm_sku_norm(il.supplier_sku)
                  else 'name:'||public.rm_match_key(il.description) end)=p_item_key)
    order by i.id for update of i
  loop
    v_guard_invoice_ids:=array_append(v_guard_invoice_ids,r.id);
  end loop;
  perform il.id from public.invoice_lines il
    where il.invoice_id=any(v_guard_invoice_ids)
      and (p_line_ids is null or il.id=any(p_line_ids))
      and (case when public.rm_sku_norm(il.supplier_sku)<>'' then 'sku:'||public.rm_sku_norm(il.supplier_sku)
                else 'name:'||public.rm_match_key(il.description) end)=p_item_key
    order by il.id for update of il;
  -- Fresh command snapshot after lock acquisition: discard solved, approved, posted or closed rows.
  select coalesce(array_agg(il.id order by il.id),'{}'::uuid[]) into v_guard_line_ids
    from public.invoice_lines il join public.invoices i on i.id=il.invoice_id
    where i.id=any(v_guard_invoice_ids)
      and i.legal_entity_id=p_legal_entity_id and i.supplier_id=p_supplier_id
      and (p_line_ids is null or il.id=any(p_line_ids))
      and (not v_scoped or il.requires_review is true)
      and i.status in ('imported','needs_review','ready') and i.flagged_at is null
      and coalesce(il.match_confidence,'')<>'not_applicable'
      and (case when public.rm_sku_norm(il.supplier_sku)<>'' then 'sku:'||public.rm_sku_norm(il.supplier_sku)
                else 'name:'||public.rm_match_key(il.description) end)=p_item_key
      and not exists(select 1 from public.invoice_internal_approvals a where a.invoice_id=i.id and a.status='approved')
      and not exists(select 1 from public.invoice_line_cost_postings p where p.invoice_line_id=il.id and p.revoked_at is null);
  if v_scoped and cardinality(v_guard_line_ids)=0 then
    return jsonb_build_object('ok',true,'mode',case when p_not_raw_material then 'ikke_vare' else 'koblet' end,
      'raw_material_id',null,'raw_material_supplier_id',null,'created_raw_material',false,
      'line_ids','[]'::jsonb,'invoice_ids','[]'::jsonb,'lines_updated',0,'failures','[]'::jsonb);
  end if;
  -- No rows arriving after the locks may enter the operation. Null legacy callers retain
  -- their intentional ability to update supplier memory with zero eligible invoice rows.
  p_line_ids:=v_guard_line_ids;

  select il.description, il.supplier_sku into v_last_desc, v_last_sku
    from public.invoice_lines il join public.invoices i on i.id = il.invoice_id
   where i.legal_entity_id = p_legal_entity_id and i.supplier_id = p_supplier_id
     and (case when public.rm_sku_norm(il.supplier_sku) <> '' then 'sku:' || public.rm_sku_norm(il.supplier_sku)
               else 'name:' || public.rm_match_key(il.description) end) = p_item_key
   order by i.invoice_date desc, il.created_at desc limit 1;
  v_item_sku := case when p_item_key like 'sku:%' then v_last_sku end;

  -- A) «Ikke vare»
  if p_not_raw_material then
    if v_item_sku is not null then v_excl_type := 'exact_sku'; v_excl_value := v_item_sku;
    else v_excl_type := 'exact_description'; v_excl_value := coalesce(v_last_desc, ''); end if;
    if v_excl_value <> '' and not exists (
      select 1 from public.invoice_line_exclusion_patterns e
       where e.legal_entity_id = p_legal_entity_id and e.supplier_id is not distinct from p_supplier_id
         and e.pattern_type = v_excl_type and lower(btrim(e.pattern_value)) = lower(btrim(v_excl_value))) then
      insert into public.invoice_line_exclusion_patterns (legal_entity_id, supplier_id, pattern_type, pattern_value, reason, created_by)
      values (p_legal_entity_id, p_supplier_id, v_excl_type, v_excl_value, coalesce(nullif(btrim(p_reason),''), 'Ikke vare'), v_uid);
    end if;
    with upd as (
      update public.invoice_lines il
         set match_confidence = 'not_applicable', raw_material_id = null, requires_review = false, review_reason = null,
             price_per_base_unit = null, base_quantity = null, expected_price_per_base_unit = null, price_variance_pct = null, variance_status = null,
             resolution_note = 'Ikke vare: ' || coalesce(nullif(btrim(p_reason),''), 'markert manuelt'),
             resolved_by = v_uid, resolved_at = v_now, updated_at = v_now
        from public.invoices i
       where i.id = il.invoice_id and i.legal_entity_id = p_legal_entity_id and i.supplier_id = p_supplier_id
         and i.status in ('imported','needs_review','ready') and i.flagged_at is null
         and (p_line_ids is null or il.id = any(p_line_ids))
         and (case when public.rm_sku_norm(il.supplier_sku) <> '' then 'sku:' || public.rm_sku_norm(il.supplier_sku)
                   else 'name:' || public.rm_match_key(il.description) end) = p_item_key
         and coalesce(il.match_confidence,'') <> 'not_applicable'
         and not exists (select 1 from public.invoice_line_cost_postings p where p.invoice_line_id = il.id and p.revoked_at is null)
      returning il.id, il.invoice_id)
    select coalesce(array_agg(id), '{}'), coalesce(array_agg(distinct invoice_id), '{}') into v_line_ids, v_invoice_ids from upd;
    insert into public.audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
    values (v_uid, 'supplier_item.excluded', 'supplier', p_supplier_id, coalesce(v_item_sku, v_last_desc), p_legal_entity_id,
            jsonb_build_object('item_key', p_item_key, 'line_ids', to_jsonb(v_line_ids), 'pattern_type', v_excl_type, 'pattern_value', v_excl_value),
            coalesce(p_reason, 'Ikke vare'), 'ravarer');
    return jsonb_build_object('ok', true, 'mode', 'ikke_vare', 'line_ids', to_jsonb(v_line_ids), 'invoice_ids', to_jsonb(v_invoice_ids), 'lines_updated', coalesce(array_length(v_line_ids,1),0));
  end if;

  -- B) Pakning
  v_pkg_size := nullif(p_package->>'package_size','')::numeric;
  v_pkg_unit := nullif(btrim(coalesce(p_package->>'package_unit','')),'');
  v_bupp := nullif(p_package->>'base_units_per_package','')::numeric;
  v_confirm := coalesce((p_package->>'confirm')::boolean, false) and v_bupp is not null and v_bupp > 0;

  -- C) Ny råvare
  if v_rm_id is null and p_new_raw_material is not null then
    v_name := btrim(coalesce(p_new_raw_material->>'name', ''));
    v_base := lower(btrim(coalesce(p_new_raw_material->>'base_unit', '')));
    if v_name = '' or v_base = '' then return jsonb_build_object('ok', false, 'reason', 'ny_vare_mangler_navn_eller_grunnenhet'); end if;
    v_sku := nullif(btrim(coalesce(p_new_raw_material->>'sku','')), '');
    if v_sku is null and v_item_sku is not null and not exists (select 1 from public.raw_materials where legal_entity_id = p_legal_entity_id and sku = v_item_sku) then
      v_sku := v_item_sku;
    end if;
    if v_sku is null then
      v_sku := left(regexp_replace(lower(translate(v_name, 'æøåÆØÅ', 'aoaAOA')), '[^a-z0-9]+', '-', 'g'), 40) || '-' || substr(md5(gen_random_uuid()::text), 1, 4);
    end if;
    if exists (select 1 from public.raw_materials where legal_entity_id = p_legal_entity_id and sku = v_sku) then
      v_sku := v_sku || '-' || substr(md5(gen_random_uuid()::text), 1, 4);
    end if;
    insert into public.raw_materials (legal_entity_id, sku, name, category, base_unit, item_type, declaration_name,
                                      package_size, package_unit, base_units_per_package,
                                      package_confirmed_at, package_confirmed_by,
                                      primary_supplier_id, is_active, created_by, price_source)
    values (p_legal_entity_id, v_sku, v_name,
            coalesce(nullif(btrim(p_new_raw_material->>'category'),''), 'Importert – ikke kategorisert'),
            v_base, coalesce(nullif(p_new_raw_material->>'item_type',''), 'ravare'),
            nullif(btrim(coalesce(p_new_raw_material->>'declaration_name','')),''),
            v_pkg_size, v_pkg_unit, case when v_confirm then v_bupp end,
            case when v_confirm then v_now end, case when v_confirm then v_uid end,
            p_supplier_id, true, v_uid, 'invoice')
    returning id into v_rm_id;
    v_created := true;
    v_set_primary := true;
  end if;
  if v_rm_id is null then return jsonb_build_object('ok', false, 'reason', 'mangler_ravare'); end if;
  if not exists (select 1 from public.raw_materials where id = v_rm_id and legal_entity_id = p_legal_entity_id) then
    return jsonb_build_object('ok', false, 'reason', 'ravare_i_annet_selskap');
  end if;

  -- D) Åpne linjer per faktura → rm_confirm_line_match
  for r in
    select i.id invoice_id, array_agg(il.id order by il.line_number, il.created_at) ids
      from public.invoice_lines il join public.invoices i on i.id = il.invoice_id
     where i.legal_entity_id = p_legal_entity_id and i.supplier_id = p_supplier_id
       and i.status in ('imported','needs_review','ready') and i.flagged_at is null
       and (p_line_ids is null or il.id = any(p_line_ids))
       and (case when public.rm_sku_norm(il.supplier_sku) <> '' then 'sku:' || public.rm_sku_norm(il.supplier_sku)
                 else 'name:' || public.rm_match_key(il.description) end) = p_item_key
       and coalesce(il.match_confidence,'') <> 'not_applicable'
       and not exists (select 1 from public.invoice_line_cost_postings p where p.invoice_line_id = il.id and p.revoked_at is null)
     group by i.id
  loop
    v_first := r.ids[1];
    v_rest := case when array_length(r.ids,1) > 1 then r.ids[2:array_length(r.ids,1)] else null end;
    begin
      v_res := public.rm_confirm_line_match(v_first, v_rm_id, v_pkg_size, v_pkg_unit, v_bupp, v_confirm, null,
                                            v_set_primary, v_rest, false);
      if (v_res->>'ok')::boolean then
        v_line_ids := v_line_ids || r.ids;
        v_invoice_ids := array_append(v_invoice_ids, r.invoice_id);
        v_rms_id := coalesce(v_rms_id, (v_res->>'raw_material_supplier_id')::uuid);
        v_set_primary := false;
      else
        v_failures := v_failures || jsonb_build_object('invoice_id', r.invoice_id, 'reason', v_res->>'reason');
      end if;
    exception when others then
      v_failures := v_failures || jsonb_build_object('invoice_id', r.invoice_id, 'reason', sqlerrm);
    end;
  end loop;

  -- E) Leverandørkobling finnes alltid etterpå
  if v_rms_id is null then
    select id into v_rms_id from public.raw_material_suppliers where raw_material_id = v_rm_id and supplier_id = p_supplier_id;
    if v_rms_id is null then
      insert into public.raw_material_suppliers (raw_material_id, supplier_id, supplier_sku, supplier_product_name,
        package_size, package_unit, base_units_per_package, package_confirmed_at, package_confirmed_by, is_primary)
      values (v_rm_id, p_supplier_id, v_item_sku, v_last_desc, v_pkg_size, v_pkg_unit,
        case when v_confirm then v_bupp end, case when v_confirm then v_now end, case when v_confirm then v_uid end,
        v_set_primary and not exists (select 1 from public.raw_material_suppliers where raw_material_id = v_rm_id and is_primary))
      returning id into v_rms_id;
    elsif v_confirm then
      update public.raw_material_suppliers
         set package_size = coalesce(v_pkg_size, package_size), package_unit = coalesce(v_pkg_unit, package_unit),
             base_units_per_package = v_bupp, package_confirmed_at = v_now, package_confirmed_by = v_uid, updated_at = v_now
       where id = v_rms_id;
    end if;
  end if;
  update public.raw_material_suppliers
     set supplier_sku = coalesce(supplier_sku, v_item_sku),
         supplier_product_name = coalesce(supplier_product_name, v_last_desc),
         updated_at = v_now
   where id = v_rms_id;

  -- F) Alias
  if v_item_sku is not null then
    insert into public.raw_material_supplier_aliases (raw_material_supplier_id, alias_type, alias_value, status, confirmed_by, confirmed_at, match_count, last_seen_at)
    values (v_rms_id, 'supplier_sku', v_item_sku, 'confirmed', v_uid, v_now, 1, v_now)
    on conflict (alias_type, alias_value_normalized, raw_material_supplier_id)
    do update set status = 'confirmed', confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at, rejected_at = null, rejected_by = null, rejected_reason = null;
    update public.raw_material_supplier_aliases a
       set status = 'superseded'
      from public.raw_material_suppliers s
     where a.raw_material_supplier_id = s.id and s.supplier_id = p_supplier_id and s.id <> v_rms_id
       and a.alias_type = 'supplier_sku' and public.rm_sku_norm(a.alias_value) = public.rm_sku_norm(v_item_sku)
       and a.status in ('confirmed','pending');
  end if;
  if v_last_desc is not null and btrim(v_last_desc) <> '' then
    insert into public.raw_material_supplier_aliases (raw_material_supplier_id, alias_type, alias_value, status, confirmed_by, confirmed_at, match_count, last_seen_at)
    values (v_rms_id, 'product_name', v_last_desc, 'confirmed', v_uid, v_now, 1, v_now)
    on conflict (alias_type, alias_value_normalized, raw_material_supplier_id)
    do update set status = 'confirmed', confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at, rejected_at = null, rejected_by = null, rejected_reason = null;
  end if;

  v_updated := coalesce(array_length(v_line_ids, 1), 0);
  insert into public.audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'supplier_item.linked', 'raw_material_supplier', v_rms_id, coalesce(v_item_sku, v_last_desc), p_legal_entity_id,
          jsonb_build_object('item_key', p_item_key, 'raw_material_id', v_rm_id, 'created_raw_material', v_created,
                             'package', p_package, 'line_ids', to_jsonb(v_line_ids), 'invoice_ids', to_jsonb(v_invoice_ids), 'failures', v_failures),
          coalesce(p_reason, 'Leverandørvare koblet'), 'ravarer');

  return jsonb_build_object('ok', true, 'mode', 'koblet', 'raw_material_id', v_rm_id, 'created_raw_material', v_created,
                            'raw_material_supplier_id', v_rms_id, 'line_ids', to_jsonb(v_line_ids),
                            'invoice_ids', to_jsonb(v_invoice_ids), 'lines_updated', v_updated, 'failures', v_failures);
end;
$function$
;


