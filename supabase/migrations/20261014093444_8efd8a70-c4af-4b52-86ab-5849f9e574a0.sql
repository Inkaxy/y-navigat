create or replace function public.rm_correct_raw_material_type_unit(
  p_raw_material_id uuid, p_item_type text, p_base_unit text, p_reason text, p_expected_updated_at text, p_op_id uuid, p_dry_run boolean default false
) returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid(); v_rm raw_materials%rowtype; v_reason text := btrim(coalesce(p_reason, ''));
  v_unit_changes boolean; v_type_changes boolean; v_postings int := 0; v_lots int := 0; v_stock boolean := false;
  v_bad_recipes jsonb; v_ok_recipes int := 0; v_rms jsonb; v_variants jsonb; v_hist int := 0;
  v_open_invoices uuid[]; v_blockers jsonb := '[]'::jsonb; v_prev jsonb;
begin
  if v_uid is null then raise exception 'ikke_innlogget' using errcode = '42501'; end if;
  if p_item_type not in ('ravare','emballasje','videresalg') then return jsonb_build_object('ok', false, 'error', 'ugyldig_varetype'); end if;
  if p_base_unit not in ('kg','l','stk') then return jsonb_build_object('ok', false, 'error', 'ugyldig_grunnenhet'); end if;
  select * into v_rm from raw_materials where id = p_raw_material_id for update;
  if not found or not public.has_ravarer_access(v_uid, v_rm.legal_entity_id, 'write') or not public.has_ravarer_invoice_access(v_rm.legal_entity_id, 'write') then
    raise exception 'ingen_tilgang' using errcode = '42501';
  end if;
  if not p_dry_run and p_op_id is not null then
    select changes into v_prev from audit_log where entity_type = 'raw_material' and entity_id = v_rm.id and action = 'raw_material.type_unit_corrected' and changes->>'op_id' = p_op_id::text limit 1;
    if found then
      return jsonb_build_object('ok', true, 'already', true, 'raw_material_id', v_rm.id, 'updated_at', to_jsonb(v_rm.updated_at)#>>'{}', 'item_type', v_rm.item_type, 'base_unit', v_rm.base_unit, 'receipt', v_prev);
    end if;
  end if;
  v_unit_changes := v_rm.base_unit is distinct from p_base_unit;
  v_type_changes := v_rm.item_type is distinct from p_item_type;
  select count(*) into v_postings from invoice_line_cost_postings cp join invoice_lines l on l.id = cp.invoice_line_id where l.raw_material_id = v_rm.id and cp.revoked_at is null;
  select count(*) into v_lots from rm_stock_lots where raw_material_id = v_rm.id and coalesce(remaining_base, 0) <> 0;
  v_stock := coalesce(v_rm.current_stock, 0) <> 0;
  select count(*) into v_hist from raw_material_price_history where raw_material_id = v_rm.id and superseded_at is null;
  select jsonb_agg(jsonb_build_object('recipe_line_id', rl.id, 'recipe_id', rl.recipe_id, 'unit', rl.unit, 'entry_mode', rl.entry_mode)) into v_bad_recipes
    from recipe_lines rl where rl.raw_material_id = v_rm.id and v_unit_changes
     and not ((p_base_unit = 'kg' and coalesce(rl.entry_mode, '') = 'grams' and lower(coalesce(rl.unit, '')) in ('g','kg'))
       or (p_base_unit = 'l' and lower(coalesce(rl.unit, '')) in ('ml','dl','l')) or (p_base_unit = 'stk' and lower(coalesce(rl.unit, '')) = 'stk'));
  select count(*) into v_ok_recipes from recipe_lines rl where rl.raw_material_id = v_rm.id;
  v_ok_recipes := v_ok_recipes - coalesce(jsonb_array_length(v_bad_recipes), 0);
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'supplier_id', s.supplier_id, 'supplier_sku', s.supplier_sku, 'package_size', s.package_size, 'package_unit', s.package_unit, 'base_units_per_package', s.base_units_per_package, 'package_confirmed_at', to_jsonb(s.package_confirmed_at)#>>'{}', 'package_confirmed_by', s.package_confirmed_by)), '[]'::jsonb)
    into v_rms from raw_material_suppliers s where s.raw_material_id = v_rm.id and v_unit_changes and s.package_confirmed_at is not null;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'raw_material_supplier_id', p.raw_material_supplier_id, 'package_size', p.package_size, 'package_unit', p.package_unit, 'base_units_per_package', p.base_units_per_package, 'confirmed_at', to_jsonb(p.confirmed_at)#>>'{}', 'confirmed_by', p.confirmed_by)), '[]'::jsonb)
    into v_variants from raw_material_supplier_packages p join raw_material_suppliers s on s.id = p.raw_material_supplier_id where s.raw_material_id = v_rm.id and v_unit_changes and p.confirmed_at is not null;
  select array_agg(distinct l.invoice_id) into v_open_invoices from invoice_lines l join invoices i on i.id = l.invoice_id where l.raw_material_id = v_rm.id and l.excluded_at is null and coalesce(i.status, '') not in ('reconciled','excluded');
  if v_unit_changes and v_postings > 0 then v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'kost_fort', 'count', v_postings)); end if;
  if v_unit_changes and (v_lots > 0 or v_stock) then v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'lager_finnes', 'count', v_lots)); end if;
  if v_bad_recipes is not null then v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'oppskrift_krever_mapping', 'lines', v_bad_recipes)); end if;
  if p_dry_run then
    return jsonb_build_object('ok', true, 'dry_run', true, 'raw_material_id', v_rm.id, 'updated_at', to_jsonb(v_rm.updated_at)#>>'{}', 'from', jsonb_build_object('item_type', v_rm.item_type, 'base_unit', v_rm.base_unit), 'to', jsonb_build_object('item_type', p_item_type, 'base_unit', p_base_unit), 'unit_changes', v_unit_changes, 'type_changes', v_type_changes, 'blockers', v_blockers, 'compatible_recipe_lines', v_ok_recipes, 'price_history_to_supersede', case when v_unit_changes then v_hist else 0 end, 'package_confirmations_to_reset', jsonb_array_length(v_rms) + jsonb_array_length(v_variants), 'open_invoices', coalesce(array_length(v_open_invoices, 1), 0));
  end if;
  if p_op_id is null then return jsonb_build_object('ok', false, 'error', 'op_mangler'); end if;
  if length(v_reason) < 5 or length(v_reason) > 500 then return jsonb_build_object('ok', false, 'error', 'begrunnelse_mangler'); end if;
  if v_rm.updated_at is distinct from nullif(p_expected_updated_at, '')::timestamptz then return jsonb_build_object('ok', false, 'error', 'versjon_endret'); end if;
  if not v_unit_changes and not v_type_changes then return jsonb_build_object('ok', false, 'error', 'ingen_endring'); end if;
  if jsonb_array_length(v_blockers) > 0 then return jsonb_build_object('ok', false, 'error', 'sperret', 'blockers', v_blockers); end if;
  -- Enhetsbytte: eksisterende trigger markerer gamle prisobservasjoner som erstattet (snapshot beholdes) og logger byttet.
  update raw_materials set item_type = p_item_type, base_unit = p_base_unit,
         base_units_per_package = case when v_unit_changes then null else base_units_per_package end,
         package_confirmed_at = case when v_unit_changes then null else package_confirmed_at end,
         package_confirmed_by = case when v_unit_changes then null else package_confirmed_by end
   where id = v_rm.id;
  if v_unit_changes then
    -- Pakningsfaktor i gammel enhet gjelder ikke: 1 stk blir aldri 1 kg. Leverandørraden først (triggeren arkiverer
    -- gammel bekreftelse som variant), deretter oppheves alle variantbekreftelser. Ingenting slettes.
    update raw_material_suppliers set package_confirmed_at = null, package_confirmed_by = null, base_units_per_package = null where raw_material_id = v_rm.id and package_confirmed_at is not null;
    update raw_material_supplier_packages p set confirmed_at = null, confirmed_by = null from raw_material_suppliers s where s.id = p.raw_material_supplier_id and s.raw_material_id = v_rm.id and p.confirmed_at is not null;
  end if;
  insert into audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'raw_material.type_unit_corrected', 'raw_material', v_rm.id, v_rm.name, v_rm.legal_entity_id,
          jsonb_build_object('op_id', p_op_id, 'from', jsonb_build_object('item_type', v_rm.item_type, 'base_unit', v_rm.base_unit, 'base_units_per_package', v_rm.base_units_per_package, 'package_confirmed_at', to_jsonb(v_rm.package_confirmed_at)#>>'{}'), 'to', jsonb_build_object('item_type', p_item_type, 'base_unit', p_base_unit), 'reset_supplier_confirmations', v_rms, 'reset_variant_confirmations', v_variants, 'price_history_superseded', case when v_unit_changes then v_hist else 0 end),
          v_reason, 'ravarer');
  if v_unit_changes and v_open_invoices is not null then
    perform public.rm_rematch_invoices(v_rm.legal_entity_id, 500, v_open_invoices, true);
  end if;
  select * into v_rm from raw_materials where id = v_rm.id;
  return jsonb_build_object('ok', true, 'already', false, 'raw_material_id', v_rm.id, 'updated_at', to_jsonb(v_rm.updated_at)#>>'{}', 'item_type', v_rm.item_type, 'base_unit', v_rm.base_unit, 'package_confirmations_reset', jsonb_array_length(v_rms) + jsonb_array_length(v_variants), 'price_history_superseded', case when v_unit_changes then v_hist else 0 end, 'open_invoices_requeued', case when v_unit_changes then coalesce(array_length(v_open_invoices, 1), 0) else 0 end);
end;
$function$;
revoke all on function public.rm_correct_raw_material_type_unit(uuid, text, text, text, text, uuid, boolean) from public, anon;
grant execute on function public.rm_correct_raw_material_type_unit(uuid, text, text, text, text, uuid, boolean) to authenticated;