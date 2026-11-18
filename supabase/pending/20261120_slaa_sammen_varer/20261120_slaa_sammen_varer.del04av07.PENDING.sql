-- VENTER PÅ ROOT. 20261120_slaa_sammen_varer.del04av07.PENDING.sql – del 4 av 7 av 20261120_slaa_sammen_varer.PENDING.sql (12914 byte tekst).
-- Legger bare teksten i mellomlagringen og kontrollerer md5. Ingen virkning på appen før del 7 («kjør»).
-- Kan kjøres på nytt (overskriver samme del). md5 for delen: 8ab670c0bf53f07efdcf50acbe773489

do $g$ begin
  if to_regclass('public._rm_sql_stage') is null then raise exception 'Kjør del 01 først'; end if;
  if not exists (select 1 from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 3) then
    raise exception 'Kjør del 03 først';
  end if;
end $g$;
insert into public._rm_sql_stage (file, part, body) values ('20261120_slaa_sammen_varer', 4, $stage$      -- Næring, allergener, datablad: bare der beholdt vare mangler det
      if exists (select 1 from public.raw_material_nutrition where raw_material_id = v_d) then
        if not exists (select 1 from public.raw_material_nutrition where raw_material_id = p_keep) then
          update public.raw_material_nutrition set raw_material_id = p_keep where raw_material_id = v_d;
          v_log := public._rm_merge_push(v_log, 'nutrition', jsonb_build_array(jsonb_build_object('d', v_d)));
          v_counts := public._rm_merge_add(v_counts, 'naering', 1);
        else
          v_conf := v_conf || public._rm_merge_conf('naering_finnes', format('Begge varene har næringsinnhold. «%s» beholder sitt.', v_keep.name), false);
        end if;
      end if;
      if exists (select 1 from public.raw_material_allergens where raw_material_id = v_d) or v_dup.allergens_reviewed_at is not null then
        if not exists (select 1 from public.raw_material_allergens where raw_material_id = p_keep)
           and (select allergens_reviewed_at from public.raw_materials where id = p_keep) is null and not v_allergens_moved then
          with upd as (update public.raw_material_allergens set raw_material_id = p_keep where raw_material_id = v_d returning id)
          select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]'), count(*) into v_j, v_n from upd;
          v_log := public._rm_merge_push(v_log, 'allergens', v_j); v_counts := public._rm_merge_add(v_counts, 'allergener', v_n);
          v_allergens_moved := true;
        elsif exists (
          (select allergen::text, presence::text from public.raw_material_allergens where raw_material_id = v_d
           except select allergen::text, presence::text from public.raw_material_allergens where raw_material_id = p_keep)
          union
          (select allergen::text, presence::text from public.raw_material_allergens where raw_material_id = p_keep
           except select allergen::text, presence::text from public.raw_material_allergens where raw_material_id = v_d)) then
          v_conf := v_conf || public._rm_merge_conf('allergener_ulike', format('Allergenene er ulike på «%s» og «%s». «%s» beholder sine – kontroller dem.', v_dup.name, v_keep.name, v_keep.name), false);
        end if;
      end if;
      with upd as (
        update public.raw_material_datasheets s
           set raw_material_id = p_keep,
               is_current = o.is_current and not exists (select 1 from public.raw_material_datasheets k where k.raw_material_id = p_keep and k.is_current)
          from public.raw_material_datasheets o where o.id = s.id and s.raw_material_id = v_d
        returning s.id, o.is_current c)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'c', c)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'datasheets', v_j); v_counts := public._rm_merge_add(v_counts, 'datablad', v_n);
    end loop;

    -- Beholdt vare: valgt navn/kategori/type, stykkvekt, og felt som bare mangler fylles fra varene som slås sammen
    v_before := jsonb_build_object('name', v_keep.name, 'category', v_keep.category, 'categories', to_jsonb(v_keep.categories),
      'item_type', v_keep.item_type, 'unit_weight_grams', v_keep.unit_weight_grams, 'declaration_name', v_keep.declaration_name,
      'grain_classification', v_keep.grain_classification, 'cereal_type', v_keep.cereal_type, 'water_content_pct', v_keep.water_content_pct,
      'density_g_per_ml', v_keep.density_g_per_ml, 'allergens_reviewed_at', v_keep.allergens_reviewed_at, 'is_composite', v_keep.is_composite,
      'components_reviewed_at', v_keep.components_reviewed_at, 'primary_supplier_id', v_keep.primary_supplier_id);
    select name into v_name from public.raw_materials where id = coalesce((p_fields ->> 'name')::uuid, p_keep);
    select category, categories into v_cat, v_cats from public.raw_materials where id = coalesce((p_fields ->> 'category')::uuid, p_keep);
    select item_type into v_type from public.raw_materials where id = coalesce((p_fields ->> 'item_type')::uuid, p_keep);
    update public.raw_materials k set
      name = v_name, category = v_cat, categories = v_cats, item_type = v_type,
      unit_weight_grams = coalesce(v_gpp_used, k.unit_weight_grams),
      declaration_name = coalesce(k.declaration_name, (select d.declaration_name from public.raw_materials d where d.id = any(v_dups) and d.declaration_name is not null order by d.id limit 1)),
      grain_classification = coalesce(k.grain_classification, (select d.grain_classification from public.raw_materials d where d.id = any(v_dups) and d.grain_classification is not null order by d.id limit 1)),
      cereal_type = coalesce(k.cereal_type, (select d.cereal_type from public.raw_materials d where d.id = any(v_dups) and d.cereal_type is not null order by d.id limit 1)),
      water_content_pct = coalesce(k.water_content_pct, (select d.water_content_pct from public.raw_materials d where d.id = any(v_dups) and d.water_content_pct is not null order by d.id limit 1)),
      density_g_per_ml = coalesce(k.density_g_per_ml, (select d.density_g_per_ml from public.raw_materials d where d.id = any(v_dups) and d.density_g_per_ml is not null order by d.id limit 1)),
      allergens_reviewed_at = case when v_allergens_moved then coalesce(k.allergens_reviewed_at, (select max(d.allergens_reviewed_at) from public.raw_materials d where d.id = any(v_dups))) else k.allergens_reviewed_at end,
      is_composite = k.is_composite or v_parent_moved,
      components_reviewed_at = case when v_parent_moved then coalesce(k.components_reviewed_at, (select max(d.components_reviewed_at) from public.raw_materials d where d.id = any(v_dups))) else k.components_reviewed_at end,
      primary_supplier_id = coalesce(k.primary_supplier_id, (select d.primary_supplier_id from public.raw_materials d where d.id = any(v_dups) and d.primary_supplier_id is not null order by d.id limit 1))
    where k.id = p_keep
    returning jsonb_build_object('name', k.name, 'category', k.category, 'categories', to_jsonb(k.categories),
      'item_type', k.item_type, 'unit_weight_grams', k.unit_weight_grams, 'declaration_name', k.declaration_name,
      'grain_classification', k.grain_classification, 'cereal_type', k.cereal_type, 'water_content_pct', k.water_content_pct,
      'density_g_per_ml', k.density_g_per_ml, 'allergens_reviewed_at', k.allergens_reviewed_at, 'is_composite', k.is_composite,
      'components_reviewed_at', k.components_reviewed_at, 'primary_supplier_id', k.primary_supplier_id) into v_after;

    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'a', is_active)), '[]') into v_j from public.raw_materials where id = any(v_dups);
    v_log := public._rm_merge_push(v_log, 'dups', v_j)
      || jsonb_build_object('keep_before', v_before, 'keep_after', v_after, 'factors', v_factor, 'grams_per_piece', v_gpp_used, 'rms_map', v_rms_map);

    -- Kostpris etter gjeldende regel
    perform public.rm_apply_derived_cost_price(p_keep);
    foreach v_d in array v_dups loop perform public.rm_apply_derived_cost_price(v_d); end loop;
    perform set_config('rm.defer_stats', '', true);
    perform public.refresh_purchase_stats();
    select jsonb_build_object('price', current_cost_price, 'status', cost_basis_status, 'unit', base_unit) into v_cost_after
      from public.raw_materials where id = p_keep;

    v_result := jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'can_apply', not v_blocking,
      'merge_id', case when p_dry_run then null else v_merge_id end, 'keep_id', p_keep, 'merged_ids', to_jsonb(v_dups),
      'counts', v_counts, 'conflicts', v_conf, 'cost', jsonb_build_object('before', v_cost_before, 'after', v_cost_after),
      'factors', v_factor, 'grams_per_piece', v_gpp_used);

    insert into public.rm_material_merges (id, legal_entity_id, keep_id, merged_ids, op_id, request, result, undo_log, created_by)
    values (v_merge_id, v_le, p_keep, v_dups, p_op_id,
            jsonb_build_object('grams_per_piece', p_grams_per_piece, 'fields', p_fields, 'reason', v_reason), v_result, v_log,
            coalesce(p_uid, '00000000-0000-0000-0000-000000000000'::uuid));
    perform set_config('rm.merge_write', 'on', true);
    update public.raw_materials set is_active = false, merged_into_id = p_keep, merged_at = v_now, merge_id = v_merge_id where id = any(v_dups);
    perform set_config('rm.merge_write', '', true);

    insert into public.audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
    select p_uid, case when rm.id = p_keep then 'raw_material.merged' else 'raw_material.merged_into' end, 'raw_material', rm.id, rm.name, v_le,
           jsonb_build_object('merge_id', v_merge_id, 'keep_id', p_keep, 'merged_ids', to_jsonb(v_dups), 'counts', v_counts,
                              'factors', v_factor, 'grams_per_piece', v_gpp_used, 'cost', v_result -> 'cost'),
           v_reason, 'ravarer'
      from public.raw_materials rm where rm.id = p_keep or rm.id = any(v_dups);

    if p_dry_run then raise exception using errcode = 'RMDRY', message = 'dry_run'; end if;
  exception when sqlstate 'RMDRY' then
    null;
  end;
  return v_result;
end $$;

-- ---------- 4. Angre ----------
create or replace function public._rm_merge_undo_core(p_uid uuid, p_merge_id uuid, p_dry_run boolean, p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.rm_material_merges%rowtype;
  v_keep uuid; v_dups uuid[]; v_log jsonb; v_f jsonb; v_d uuid;
  v_counts jsonb := '{}'::jsonb; v_conf jsonb := '[]'::jsonb; v_n bigint;
  v_lines uuid[]; v_back uuid[]; v_hist uuid[]; v_result jsonb; v_now timestamptz := now();
  v_cur jsonb; v_restore jsonb := '{}'::jsonb; v_k text; v_pkg_before uuid[]; v_bcur numeric; v_blocking boolean;
  v_label jsonb := '{"name":"Navn","category":"Kategori","categories":"Kategorier","item_type":"Varetype","unit_weight_grams":"Stykkvekt","declaration_name":"Deklarasjonsnavn","grain_classification":"Grovhet","cereal_type":"Korntype","water_content_pct":"Vanninnhold","density_g_per_ml":"Tetthet","allergens_reviewed_at":"Allergenvurdering","is_composite":"Sammensatt","components_reviewed_at":"Sammensetning vurdert","primary_supplier_id":"Primærleverandør"}'::jsonb;
  x record; e jsonb; v_ff numeric;
begin
  if p_op_id is null then return jsonb_build_object('ok', false, 'code', 'op_id_mangler'); end if;
  select * into m from public.rm_material_merges where id = p_merge_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'finnes_ikke'); end if;
  if p_uid is null then
    if not p_dry_run then return jsonb_build_object('ok', false, 'code', 'ikke_innlogget'); end if;
  elsif not public.has_ravarer_access(p_uid, m.legal_entity_id, 'approve'::public.access_level) then
    return jsonb_build_object('ok', false, 'code', 'ingen_tilgang');
  end if;
  if m.undone_at is not null then
    if not p_dry_run and m.undo_op_id = p_op_id then return m.undo_result || jsonb_build_object('replay', true); end if;
    return jsonb_build_object('ok', false, 'code', 'allerede_angret');
  end if;
  v_keep := m.keep_id; v_dups := m.merged_ids; v_log := m.undo_log; v_f := coalesce(v_log -> 'factors', '{}'::jsonb);
  perform 1 from public.raw_materials where id = v_keep or id = any(v_dups) order by id for update;
  if exists (select 1 from unnest(v_dups) d where not exists (
        select 1 from public.raw_materials r where r.id = d and r.merged_into_id = v_keep and r.merge_id = m.id)) then
    return jsonb_build_object('ok', false, 'code', 'endret_siden');
  end if;

  select coalesce(array_agg((j ->> 'id')::uuid), '{}') into v_lines from jsonb_array_elements(coalesce(v_log -> 'lines', '[]')) j;
  select coalesce(array_agg(id), '{}') into v_back from public.invoice_lines where id = any(v_lines) and raw_material_id = v_keep;
  select count(*) into v_n from public.invoice_line_cost_postings p where p.invoice_line_id = any(v_back) and p.revoked_at is null;
  if v_n > 0 then
    v_conf := v_conf || public._rm_merge_conf('kostpris_fort_etterpa', format('%s flyttede fakturalinjer har fått ført kostpris etter sammenslåingen. Angring er sperret.', v_n), true);
  end if;
  if cardinality(v_back) < cardinality(v_lines) then
    v_conf := v_conf || public._rm_merge_conf('linjer_endret', format('%s fakturalinjer er koblet om etter sammenslåingen og blir der de er.', cardinality(v_lines) - cardinality(v_back)), false);
  end if;
  v_blocking := exists (select 1 from jsonb_array_elements(v_conf) c where (c ->> 'blocking')::boolean);
  if v_blocking then
    if not p_dry_run then return jsonb_build_object('ok', false, 'code', 'konflikt', 'conflicts', v_conf); end if;
    return jsonb_build_object('ok', true, 'dry_run', true, 'can_apply', false, 'merge_id', m.id, 'keep_id', m.keep_id,
$stage$)
  on conflict (file, part) do update set body = excluded.body, created_at = now();
do $g$ begin
  if (select md5(body) from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 4) <> '8ab670c0bf53f07efdcf50acbe773489' then
    raise exception 'Del 04 er ikke skrevet inn riktig (md5 avviker) – skriv den inn på nytt';
  end if;
end $g$;
