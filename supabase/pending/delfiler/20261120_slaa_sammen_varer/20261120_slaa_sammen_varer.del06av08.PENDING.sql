-- VENTER PÅ ROOT. 20261120_slaa_sammen_varer.del06av08.PENDING.sql – del 6 av 8 av 20261120_slaa_sammen_varer.PENDING.sql (12964 byte tekst).
-- Legger bare teksten i mellomlagringen og kontrollerer md5. Ingen virkning på appen før del 8 («kjør»).
-- Kan kjøres på nytt (overskriver samme del). md5 for delen: 56a916303d903ef2cc3b2bead10ca7c7

do $g$ begin
  if to_regclass('public._rm_sql_stage') is null then raise exception 'Kjør del 01 først'; end if;
  if not exists (select 1 from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 5) then
    raise exception 'Kjør del 05 først';
  end if;
end $g$;
insert into public._rm_sql_stage (file, part, body) values ('20261120_slaa_sammen_varer', 6, replace(replace(replace($stage$      from jsonb_array_elements(coalesce(v_log -> 'lots', '[]')) j where l.id = (j ->> 'id')::uuid and l.raw_material_id = v_keep;
    update public.rm_goods_receipts g set raw_material_id = (j ->> 'd')::uuid,
           quantity_base = public._rm_merge_back(g.quantity_base, (j ->> 'q')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty')
      from jsonb_array_elements(coalesce(v_log -> 'receipts', '[]')) j where g.id = (j ->> 'id')::uuid and g.raw_material_id = v_keep;

    -- Prishistorikk (før linjene): rader laget etter sammenslåingen for linjene som går tilbake avsluttes, originalene gjenopprettes
    update public.raw_material_price_history set superseded_at = v_now, superseded_reason = 'sammenslaing_angret'
     where invoice_line_id = any(v_back) and superseded_at is null and id <> all(v_hist);
    with upd as (
      update public.raw_material_price_history h set raw_material_id = (j ->> 'd')::uuid,
             superseded_at = case when h.invoice_line_id is null or h.invoice_line_id = any(v_back) then (j ->> 's')::timestamptz else h.superseded_at end,
             superseded_reason = case when h.invoice_line_id is null or h.invoice_line_id = any(v_back) then j ->> 'r' else h.superseded_reason end
        from jsonb_array_elements(coalesce(v_log -> 'history', '[]')) j where h.id = (j ->> 'id')::uuid and h.raw_material_id = v_keep
      returning h.id)
    select count(*) into v_n from upd;
    v_counts := public._rm_merge_add(v_counts, 'prishistorikk', v_n);

    -- Fakturalinjer
    perform set_config('rm.exclusion_write', 'on', true);
    perform set_config('rm.defer_stats', 'on', true);
    with upd as (
      update public.invoice_lines il set raw_material_id = (j ->> 'd')::uuid,
             base_quantity = public._rm_merge_back(il.base_quantity, (j ->> 'bq')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty'),
             price_per_base_unit = public._rm_merge_back(il.price_per_base_unit, (j ->> 'pp')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'price'),
             package_source_rms_id = case
               when il.package_source_rms_id is not distinct from coalesce((v_log -> 'rms_map' ->> (j ->> 'ps'))::uuid, (j ->> 'ps')::uuid) then (j ->> 'ps')::uuid
               else il.package_source_rms_id end
        from jsonb_array_elements(coalesce(v_log -> 'lines', '[]')) j where il.id = (j ->> 'id')::uuid and il.id = any(v_back)
      returning il.id)
    select count(*) into v_n from upd;
    v_counts := public._rm_merge_add(v_counts, 'fakturalinjer', v_n);
    update public.invoice_lines il set
           excluded_raw_material_id = case when il.excluded_raw_material_id = v_keep and (j ->> 'e') is not null then (j ->> 'e')::uuid else il.excluded_raw_material_id end,
           exclusion_prev = case when il.exclusion_prev ->> 'raw_material_id' = v_keep::text and (j -> 'ep') is not null and jsonb_typeof(j -> 'ep') = 'object' then j -> 'ep' else il.exclusion_prev end
      from jsonb_array_elements(coalesce(v_log -> 'lines_excluded', '[]')) j where il.id = (j ->> 'id')::uuid;
    perform set_config('rm.exclusion_write', '', true);
    update public.raw_material_purchases p set raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'purchases', '[]')) j where p.id = (j ->> 'id')::uuid and p.raw_material_id = v_keep;

    -- Koblingsforslag
    update public.invoice_line_match_suggestions s set raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'suggestions_moved', '[]')) j
     where s.id = (j ->> 'id')::uuid and s.raw_material_id = v_keep
       and not exists (select 1 from public.invoice_line_match_suggestions k where k.invoice_line_id = s.invoice_line_id and k.raw_material_id = (j ->> 'd')::uuid);
    insert into public.invoice_line_match_suggestions
    select s.* from jsonb_populate_recordset(null::public.invoice_line_match_suggestions, coalesce(v_log -> 'suggestions_deleted', '[]')) s
     where exists (select 1 from public.invoice_lines l where l.id = s.invoice_line_id)
    on conflict do nothing;

    perform public.rm_apply_derived_cost_price(v_keep);
    foreach v_d in array v_dups loop perform public.rm_apply_derived_cost_price(v_d); end loop;
    perform set_config('rm.defer_stats', '', true);
    perform public.refresh_purchase_stats();

    v_result := jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'can_apply', not v_blocking, 'merge_id', m.id,
      'keep_id', v_keep, 'merged_ids', to_jsonb(v_dups), 'counts', v_counts, 'conflicts', v_conf);
    update public.rm_material_merges set undone_at = v_now, undone_by = coalesce(p_uid, '00000000-0000-0000-0000-000000000000'::uuid),
           undo_result = v_result, undo_op_id = p_op_id
     where id = m.id;
    insert into public.audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
    select p_uid, 'raw_material.merge_undone', 'raw_material', rm.id, rm.name, m.legal_entity_id,
           jsonb_build_object('merge_id', m.id, 'keep_id', v_keep, 'merged_ids', to_jsonb(v_dups), 'counts', v_counts),
           'Sammenslåing angret', 'ravarer'
      from public.raw_materials rm where rm.id = v_keep or rm.id = any(v_dups);

    if p_dry_run then raise exception using errcode = 'RMDRY', message = 'dry_run'; end if;
  exception when sqlstate 'RMDRY' then
    null;
  end;
  return v_result;
end $$;

-- ---------- 5. Klientinnganger ----------
create or replace function public.rm_merge_raw_materials(
  p_keep uuid, p_dups uuid[], p_grams_per_piece jsonb default null, p_fields jsonb default null,
  p_reason text default null, p_dry_run boolean default true, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'ikke_innlogget'); end if;
  return public._rm_merge_core(auth.uid(), p_keep, p_dups, p_grams_per_piece, p_fields, p_reason, coalesce(p_dry_run, true),
    coalesce(p_op_id, case when coalesce(p_dry_run, true) then gen_random_uuid() end));
end $$;

create or replace function public.rm_undo_material_merge(p_merge_id uuid, p_dry_run boolean default true, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'ikke_innlogget'); end if;
  return public._rm_merge_undo_core(auth.uid(), p_merge_id, coalesce(p_dry_run, true),
    coalesce(p_op_id, case when coalesce(p_dry_run, true) then gen_random_uuid() end));
end $$;

-- Fakta side om side for dialogen (lesing).
create or replace function public.rm_merge_facts(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_le uuid; v_out jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'ikke_innlogget'); end if;
  if p_ids is null or cardinality(p_ids) < 1 or cardinality(p_ids) > 11 then return jsonb_build_object('ok', false, 'code', 'ugyldig_utvalg'); end if;
  if (select count(distinct legal_entity_id) from public.raw_materials where id = any(p_ids)) <> 1 then
    return jsonb_build_object('ok', false, 'code', 'annet_selskap');
  end if;
  select legal_entity_id into v_le from public.raw_materials where id = any(p_ids) limit 1;
  if not public.has_ravarer_access(auth.uid(), v_le, 'read'::public.access_level) then return jsonb_build_object('ok', false, 'code', 'ingen_tilgang'); end if;
  select jsonb_agg(jsonb_build_object(
      'id', rm.id, 'name', rm.name, 'sku', rm.sku, 'item_type', rm.item_type, 'category', rm.category, 'base_unit', rm.base_unit,
      'cost', rm.current_cost_price, 'cost_status', rm.cost_basis_status, 'created_at', rm.created_at, 'is_active', rm.is_active,
      'unit_weight_grams', rm.unit_weight_grams, 'merged_into_id', rm.merged_into_id, 'merge_id', rm.merge_id,
      'declaration_name', rm.declaration_name, 'current_stock', rm.current_stock, 'stock_tracking', rm.stock_tracking,
      'suppliers', (select coalesce(jsonb_agg(jsonb_build_object(
            'supplier_id', s.supplier_id, 'supplier_name', su.name, 'sku', s.supplier_sku, 'product_name', s.supplier_product_name,
            'package_size', s.package_size, 'package_unit', s.package_unit, 'base_units_per_package', s.base_units_per_package,
            'package_confirmed', s.package_confirmed_at is not null,
            'sku_aliases', (select coalesce(jsonb_agg(distinct a.alias_value), '[]') from public.raw_material_supplier_aliases a
                             where a.raw_material_supplier_id = s.id and a.alias_type = 'supplier_sku' and a.status = 'confirmed'))
            order by su.name), '[]')
          from public.raw_material_suppliers s join public.suppliers su on su.id = s.supplier_id where s.raw_material_id = rm.id),
      'invoice_lines', (select count(*) from public.invoice_lines where raw_material_id = rm.id),
      'recipes', (select count(distinct q.recipe_id) from (select recipe_id from public.recipe_lines where raw_material_id = rm.id
                   union select recipe_id from public.recipe_packaging_lines where raw_material_id = rm.id) q),
      'calc_additions', (select count(*) from public.product_cost_additions where raw_material_id = rm.id),
      'products', (select count(*) from public.raw_material_products where raw_material_id = rm.id),
      'price_lists', (select count(distinct pli.price_list_id) from public.raw_material_products p join public.price_list_items pli on pli.product_id = p.product_id where p.raw_material_id = rm.id),
      'stock_movements', (select count(*) from public.stock_movements where raw_material_id = rm.id),
      'count_templates', (select count(*) from public.vt_template_lines where raw_material_id = rm.id),
      'has_nutrition', exists (select 1 from public.raw_material_nutrition where raw_material_id = rm.id),
      'allergens', (select count(*) from public.raw_material_allergens where raw_material_id = rm.id),
      'datasheets', (select count(*) from public.raw_material_datasheets where raw_material_id = rm.id),
      'cost_posted_lines', (select count(*) from public.invoice_lines il where il.raw_material_id = rm.id
                             and exists (select 1 from public.invoice_line_cost_postings p where p.invoice_line_id = il.id and p.revoked_at is null)))
    order by array_position(p_ids, rm.id)) into v_out
  from public.raw_materials rm where rm.id = any(p_ids);
  return jsonb_build_object('ok', true, 'items', coalesce(v_out, '[]'::jsonb));
end $$;

create or replace function public.rm_cap_slaa_sammen_v1() returns boolean language sql stable set search_path = public as $$ select true $$;

-- ---------- 6. Eldre sammenslåing: én vei ----------
CREATE OR REPLACE FUNCTION public.merge_raw_materials(p_keep uuid, p_dup uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
BEGIN
  -- Erstattet 20.11.2026: delegerer til rm_merge_raw_materials (godkjenner/admin, inaktiv i stedet for sletting, kan angres).
  v := public.rm_merge_raw_materials(p_keep, ARRAY[p_dup], NULL, NULL, 'Slått sammen (eldre kall)', false, gen_random_uuid());
  IF coalesce((v->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Sammenslåing avvist: %', coalesce(v->>'code', 'ukjent') USING ERRCODE = 'P0001';
  END IF;
END;
$function$;

-- ---------- 7. Rettigheter ----------
revoke all on function public._rm_merge_core(uuid, uuid, uuid[], jsonb, jsonb, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public._rm_merge_undo_core(uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public._rm_merge_core(uuid, uuid, uuid[], jsonb, jsonb, text, boolean, uuid) to service_role;
grant execute on function public._rm_merge_undo_core(uuid, uuid, boolean, uuid) to service_role;
revoke all on function public.rm_merge_raw_materials(uuid, uuid[], jsonb, jsonb, text, boolean, uuid) from public, anon;
revoke all on function public.rm_undo_material_merge(uuid, boolean, uuid) from public, anon;
revoke all on function public.rm_merge_facts(uuid[]) from public, anon;
revoke all on function public.rm_cap_slaa_sammen_v1() from public, anon;
grant execute on function public.rm_merge_raw_materials(uuid, uuid[], jsonb, jsonb, text, boolean, uuid) to authenticated, service_role;
grant execute on function public.rm_undo_material_merge(uuid, boolean, uuid) to authenticated, service_role;
grant execute on function public.rm_merge_facts(uuid[]) to authenticated, service_role;
grant execute on function public.rm_cap_slaa_sammen_v1() to authenticated, service_role;
revoke all on function public._rm_merge_fields_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';
-- Linjeskift: limes filen inn med Windows-linjeskift (CR+LF), får funksjonene over et usynlig CR-tegn i kroppen.
$stage$, chr(13), ''), chr(160), ' '), chr(9), ' '))
  on conflict (file, part) do update set body = excluded.body, created_at = now();
do $g$ begin
  if (select md5(body) from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 6) <> '56a916303d903ef2cc3b2bead10ca7c7' then
    raise exception 'Del 06 er ikke skrevet inn riktig (md5 avviker) – skriv den inn på nytt';
  end if;
end $g$;
