-- VENTER PÅ ROOT. 20261120_slaa_sammen_varer.del05av07.PENDING.sql – del 5 av 7 av 20261120_slaa_sammen_varer.PENDING.sql (12949 byte tekst).
-- Legger bare teksten i mellomlagringen og kontrollerer md5. Ingen virkning på appen før del 7 («kjør»).
-- Kan kjøres på nytt (overskriver samme del). md5 for delen: 328e40ac1258fd3ed04b6079aca0a4ae

do $g$ begin
  if to_regclass('public._rm_sql_stage') is null then raise exception 'Kjør del 01 først'; end if;
  if not exists (select 1 from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 4) then
    raise exception 'Kjør del 04 først';
  end if;
end $g$;
insert into public._rm_sql_stage (file, part, body) values ('20261120_slaa_sammen_varer', 5, $stage$      'merged_ids', to_jsonb(m.merged_ids), 'counts', '{}'::jsonb, 'conflicts', v_conf);
  end if;
  select coalesce(array_agg((j ->> 'id')::uuid), '{}') into v_hist from jsonb_array_elements(coalesce(v_log -> 'history', '[]')) j;

  begin
    -- Varene som ble slått sammen
    perform set_config('rm.merge_write', 'on', true);
    update public.raw_materials r set is_active = (j ->> 'a')::boolean, merged_into_id = null, merged_at = null, merge_id = null
      from jsonb_array_elements(v_log -> 'dups') j where r.id = (j ->> 'id')::uuid;
    perform set_config('rm.merge_write', '', true);

    -- Beholdt vare: bare felt som fortsatt har verdien sammenslåingen satte
    select to_jsonb(r) into v_cur from public.raw_materials r where r.id = v_keep;
    for v_k in select jsonb_object_keys(coalesce(v_log -> 'keep_before', '{}'::jsonb)) loop
      continue when (v_log -> 'keep_before' -> v_k) is not distinct from (v_log -> 'keep_after' -> v_k);
      if (v_cur -> v_k) is not distinct from (v_log -> 'keep_after' -> v_k) then
        v_restore := v_restore || jsonb_build_object(v_k, v_log -> 'keep_before' -> v_k);
      else
        v_conf := v_conf || public._rm_merge_conf('felt_endret', format('%s på beholdt vare er endret etter sammenslåingen og beholdes.', coalesce(v_label ->> v_k, v_k)), false);
      end if;
    end loop;
    if v_restore <> '{}'::jsonb then
      update public.raw_materials r set
        (name, category, categories, item_type, unit_weight_grams, declaration_name, grain_classification, cereal_type, water_content_pct,
         density_g_per_ml, allergens_reviewed_at, is_composite, components_reviewed_at, primary_supplier_id) =
        (select p.name, p.category, p.categories, p.item_type, p.unit_weight_grams, p.declaration_name, p.grain_classification, p.cereal_type,
                p.water_content_pct, p.density_g_per_ml, p.allergens_reviewed_at, p.is_composite, p.components_reviewed_at, p.primary_supplier_id
           from jsonb_populate_record(null::public.raw_materials, v_cur || v_restore) p)
       where r.id = v_keep;
    end if;

    -- Datablad, allergener, næring
    update public.raw_material_datasheets s set raw_material_id = (j ->> 'd')::uuid, is_current = (j ->> 'c')::boolean
      from jsonb_array_elements(coalesce(v_log -> 'datasheets', '[]')) j where s.id = (j ->> 'id')::uuid and s.raw_material_id = v_keep;
    update public.raw_material_allergens a set raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'allergens', '[]')) j
     where a.id = (j ->> 'id')::uuid and a.raw_material_id = v_keep
       and not exists (select 1 from public.raw_material_allergens z where z.raw_material_id = (j ->> 'd')::uuid and z.allergen = a.allergen);
    for e in select j from jsonb_array_elements(coalesce(v_log -> 'nutrition', '[]')) j loop
      if not exists (select 1 from public.raw_material_nutrition where raw_material_id = (e ->> 'd')::uuid) then
        update public.raw_material_nutrition set raw_material_id = (e ->> 'd')::uuid where raw_material_id = v_keep;
      end if;
    end loop;

    -- Tellemaler, sammensetning, forhandlinger, enheter, handelsvarer
    update public.vt_template_lines t set raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'template_lines', '[]')) j
     where t.id = (j ->> 'id')::uuid and t.raw_material_id = v_keep
       and not exists (select 1 from public.vt_template_lines k where k.template_id = t.template_id and k.raw_material_id = (j ->> 'd')::uuid
                        and coalesce(k.location_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(t.location_id, '00000000-0000-0000-0000-000000000000'::uuid));
    update public.raw_material_components c set parent_raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'components_parent', '[]')) j where c.id = (j ->> 'id')::uuid and c.parent_raw_material_id = v_keep;
    update public.raw_material_components c set component_raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'components_child', '[]')) j where c.id = (j ->> 'id')::uuid and c.component_raw_material_id = v_keep;
    update public.negotiation_items n set raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'negotiation_items', '[]')) j
     where n.id = (j ->> 'id')::uuid and n.raw_material_id = v_keep
       and not exists (select 1 from public.negotiation_items k where k.negotiation_id = n.negotiation_id and k.raw_material_id = (j ->> 'd')::uuid);
    update public.raw_material_units u set raw_material_id = (j ->> 'd')::uuid,
           units_in_base = public._rm_merge_back(u.units_in_base, (j ->> 'b')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty'),
           is_default_purchase = (j ->> 'dp')::boolean, is_default_count = (j ->> 'dc')::boolean, is_sales_unit = (j ->> 'su')::boolean
      from jsonb_array_elements(coalesce(v_log -> 'units', '[]')) j
     where u.id = (j ->> 'id')::uuid and u.raw_material_id = v_keep
       and not exists (select 1 from public.raw_material_units k where k.raw_material_id = (j ->> 'd')::uuid and lower(k.unit_label) = lower(u.unit_label));
    update public.raw_material_products p set raw_material_id = (j ->> 'd')::uuid,
           base_units_per_sold_unit = public._rm_merge_back(p.base_units_per_sold_unit, (j ->> 'b')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty')
      from jsonb_array_elements(coalesce(v_log -> 'products', '[]')) j
     where p.id = (j ->> 'id')::uuid and p.raw_material_id = v_keep
       and not exists (select 1 from public.raw_material_products k where k.raw_material_id = (j ->> 'd')::uuid and k.product_id = p.product_id);

    -- Oppskrifter og kalkyler
    with upd as (
      update public.recipe_lines l set raw_material_id = (j ->> 'd')::uuid
        from jsonb_array_elements(coalesce(v_log -> 'recipe_lines', '[]')) j where l.id = (j ->> 'id')::uuid and l.raw_material_id = v_keep
      returning l.id)
    select count(*) into v_n from upd;
    v_counts := public._rm_merge_add(v_counts, 'oppskriftslinjer', v_n);
    update public.recipe_packaging_lines l set raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'packaging_lines', '[]')) j where l.id = (j ->> 'id')::uuid and l.raw_material_id = v_keep;
    update public.product_cost_additions l set raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'cost_additions', '[]')) j where l.id = (j ->> 'id')::uuid and l.raw_material_id = v_keep;

    -- Leverandørkoblinger: lærte varenumre fjernes, skrivemåter og pakninger flyttes tilbake
    with del as (
      delete from public.raw_material_supplier_aliases
       where id in (select (j #>> '{}')::uuid from jsonb_array_elements(coalesce(v_log -> 'aliases_created', '[]')) j)
      returning id)
    select count(*) into v_n from del;
    v_counts := public._rm_merge_add(v_counts, 'laerte_fjernet', v_n);
    update public.raw_material_supplier_aliases a set status = (j ->> 's')::public.alias_status, confirmed_by = (j ->> 'cb')::uuid, confirmed_at = (j ->> 'ca')::timestamptz
      from jsonb_array_elements(coalesce(v_log -> 'aliases_status', '[]')) j where a.id = (j ->> 'id')::uuid;
    update public.raw_material_supplier_aliases a set raw_material_supplier_id = (j ->> 'from')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'aliases_moved', '[]')) j
     where a.id = (j ->> 'id')::uuid
       and not exists (select 1 from public.raw_material_supplier_aliases z where z.raw_material_supplier_id = (j ->> 'from')::uuid
                        and z.alias_type = a.alias_type and z.alias_value_normalized = a.alias_value_normalized);
    update public.raw_material_supplier_packages p set raw_material_supplier_id = (j ->> 'from')::uuid,
           base_units_per_package = public._rm_merge_back(p.base_units_per_package, (j ->> 'b')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty')
      from jsonb_array_elements(coalesce(v_log -> 'packages_moved', '[]')) j
     where p.id = (j ->> 'id')::uuid
       and not exists (select 1 from public.raw_material_supplier_packages k where k.raw_material_supplier_id = (j ->> 'from')::uuid
             and k.supplier_sku_norm = p.supplier_sku_norm and coalesce(k.package_size, -1) = coalesce(p.package_size, -1)
             and coalesce(lower(k.package_unit), '') = coalesce(lower(p.package_unit), '')
             and k.base_units_per_package = public._rm_merge_back(p.base_units_per_package, (j ->> 'b')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty'));
    update public.raw_material_suppliers s set agreed_price_per_base_unit = (j ->> 'a')::numeric, agreement_valid_from = (j ->> 'vf')::date,
           agreement_valid_to = (j ->> 'vt')::date, agreement_document_url = j ->> 'u'
      from jsonb_array_elements(coalesce(v_log -> 'agreement_copied', '[]')) j
     where s.id = (j ->> 'id')::uuid and s.agreed_price_per_base_unit is not distinct from (j ->> 'na')::numeric;
    update public.raw_material_supplier_packages p
       set base_units_per_package = public._rm_merge_back(p.base_units_per_package, (j ->> 'b')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty')
      from jsonb_array_elements(coalesce(v_log -> 'packages_converted', '[]')) j where p.id = (j ->> 'id')::uuid;
    delete from public.raw_material_supplier_packages
     where id in (select (j #>> '{}')::uuid from jsonb_array_elements(coalesce(v_log -> 'packages_created', '[]')) j);
    for e in select j from jsonb_array_elements(coalesce(v_log -> 'suppliers_moved', '[]')) j loop
      continue when not exists (select 1 from public.raw_material_suppliers where id = (e ->> 'id')::uuid and raw_material_id = v_keep);
      if exists (select 1 from public.raw_material_suppliers z where z.raw_material_id = (e ->> 'd')::uuid
                   and z.supplier_id = (select supplier_id from public.raw_material_suppliers where id = (e ->> 'id')::uuid)) then
        v_conf := v_conf || public._rm_merge_conf('kobling_finnes', 'En leverandørkobling kunne ikke flyttes tilbake fordi varen har fått en ny kobling til samme leverandør.', false);
        continue;
      end if;
      v_ff := (v_f ->> (e ->> 'd'))::numeric;
      if v_ff is null or v_ff = 1 then
        update public.raw_material_suppliers set raw_material_id = (e ->> 'd')::uuid, is_primary = (e ->> 'p')::boolean where id = (e ->> 'id')::uuid;
      else
        select coalesce(array_agg(id), '{}') into v_pkg_before from public.raw_material_supplier_packages where raw_material_supplier_id = (e ->> 'id')::uuid;
        select base_units_per_package into v_bcur from public.raw_material_suppliers where id = (e ->> 'id')::uuid;
        perform set_config('app.rm_start_price_rpc', '1', true);
        update public.raw_material_suppliers s set raw_material_id = (e ->> 'd')::uuid, is_primary = (e ->> 'p')::boolean,
               base_units_per_package = public._rm_merge_back(s.base_units_per_package, (e ->> 'b')::numeric, v_ff, 'qty'),
               agreed_price_per_base_unit = public._rm_merge_back(s.agreed_price_per_base_unit, (e ->> 'a')::numeric, v_ff, 'price'),
               start_price_per_base_unit = public._rm_merge_back(s.start_price_per_base_unit, (e ->> 'sp')::numeric, v_ff, 'price'),
               start_price_base_units_per_package = public._rm_merge_back(s.start_price_base_units_per_package, (e ->> 'spb')::numeric, v_ff, 'qty'),
               start_price_base_unit = case when s.start_price_base_unit is null then null else coalesce(e ->> 'spu', s.start_price_base_unit) end
         where s.id = (e ->> 'id')::uuid;
        perform set_config('app.rm_start_price_rpc', '', true);
        delete from public.raw_material_supplier_packages
         where raw_material_supplier_id = (e ->> 'id')::uuid and id <> all(v_pkg_before) and base_units_per_package = v_bcur;
      end if;
      v_counts := public._rm_merge_add(v_counts, 'leverandorkoblinger', 1);
    end loop;

    -- Lager (før fakturalinjene)
    update public.stock_movements s set raw_material_id = (j ->> 'd')::uuid,
           quantity_base = public._rm_merge_back(s.quantity_base, (j ->> 'q')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty')
      from jsonb_array_elements(coalesce(v_log -> 'movements', '[]')) j
     where s.id = (j ->> 'id')::uuid and s.raw_material_id = v_keep
       and not (s.source_id is not null and exists (select 1 from public.stock_movements k where k.raw_material_id = (j ->> 'd')::uuid
                  and k.source_table is not distinct from s.source_table and k.source_id = s.source_id));
    update public.rm_stock_lots l set raw_material_id = (j ->> 'd')::uuid,
           quantity_base = public._rm_merge_back(l.quantity_base, (j ->> 'q')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty'),
           remaining_base = public._rm_merge_back(l.remaining_base, (j ->> 'rb')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty')
$stage$)
  on conflict (file, part) do update set body = excluded.body, created_at = now();
do $g$ begin
  if (select md5(body) from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 5) <> '328e40ac1258fd3ed04b6079aca0a4ae' then
    raise exception 'Del 05 er ikke skrevet inn riktig (md5 avviker) – skriv den inn på nytt';
  end if;
end $g$;
