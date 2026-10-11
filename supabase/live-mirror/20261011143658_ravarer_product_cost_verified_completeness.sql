-- Rebased against live product_cost after SHA715e9d; function unchanged from ca9720.
BEGIN;
CREATE OR REPLACE FUNCTION public.recipe_cost_line_grams(q numeric,u text,qg numeric,d numeric,w numeric)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $f$
DECLARE unit text:=lower(btrim(coalesce(u,'')));
BEGIN
 -- Explicit gram-only legacy representation is safe only for a mass/unspecified unit.
 -- Never trust persisted grams for volume (old writers assumed density 1).
 IF q IS NULL THEN
   RETURN CASE WHEN qg>=0 AND unit IN('','g','gram','kg','kilo','kilogram','hg','hekto') THEN qg ELSE NULL END;
 END IF;
 IF unit IN('l','liter','ltr','ml','cl','dl') THEN
   IF d IS NULL OR d<=0 THEN RETURN NULL; END IF;
   RETURN q*(CASE unit WHEN 'ml' THEN 1 WHEN 'cl' THEN 10 WHEN 'dl' THEN 100 ELSE 1000 END)*d;
 ELSIF unit IN('stk','stykk','pcs','st') THEN RETURN CASE WHEN w>0 THEN q*w ELSE NULL END;
 ELSIF unit IN('g','gram') THEN RETURN q;
 ELSIF unit IN('kg','kilo','kilogram') THEN RETURN q*1000;
 ELSIF unit IN('hg','hekto') THEN RETURN q*100;
 END IF;
 RETURN NULL;
END $f$;
CREATE OR REPLACE FUNCTION public.product_cost(p_product_id uuid, p_depth integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p record; r record;
  v_hourly_rate numeric; v_packaging_mode text;
  v_raw numeric := 0; v_labor numeric := 0; v_pack numeric := 0; v_energy numeric := 0;
  v_shrink numeric := 0; v_freight numeric := 0; v_handling numeric := 0; v_storage numeric := 0;
  v_units numeric; v_dough numeric; v_dough_net numeric; v_piece numeric; v_dough_waste numeric;
  v_purchase numeric := 0; v_base numeric; v_cpg numeric;
  v_sub jsonb; v_quality text := 'A'; v_notes text[] := array[]::text[];
  v_type text; v_type_set boolean; v_unknown_weights boolean; v_line record; v_add record; v_item record;
  v_qty numeric; v_g numeric; v_missing boolean := false; v_n_items int := 0; v_recipe_id uuid;
begin
  if p_depth > 6 then
    return jsonb_build_object('ok', false, 'error', 'For dyp kjede av halvfabrikat');
  end if;

  select id, legal_entity_id, display_name, calc_type, calc_source_product_id, calc_factor,
         manual_cost_price, manual_cost_set_at, manual_cost_note,
         shrinkage_pct, freight_value, freight_mode, handling_value, handling_mode,
         storage_value, storage_mode, mva_rate, energy_cost_per_unit
    into p from public.products where id = p_product_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'Varen finnes ikke'); end if;
  perform public._calc_access_guard(p.legal_entity_id);

  select s.hourly_rate, s.packaging_mode into v_hourly_rate, v_packaging_mode
    from public.entity_calc_settings s where s.legal_entity_id = p.legal_entity_id;
  v_hourly_rate    := coalesce(v_hourly_rate, 400);
  v_packaging_mode := coalesce(v_packaging_mode, 'legges_til');

  -- H4: NULL behandles eksplisitt som 'oppskrift'
  v_type_set := p.calc_type is not null;
  v_type     := coalesce(p.calc_type::text, 'oppskrift');
  if not v_type_set then
    v_notes := array_append(v_notes, 'Kalkyletype er ikke satt – beregnet som oppskrift');
  end if;

  -- H4: energi per enhet fra varekortet (alle grener unntatt manuell)
  v_energy := coalesce(p.energy_cost_per_unit, 0);

  if v_type = 'manuell' then
    if p.manual_cost_price is null then
      return jsonb_build_object('ok', true, 'calc_type', v_type, 'calc_type_set', v_type_set, 'has_cost', false,
        'quality', 'C', 'notes', array['Manuell kostpris er ikke satt']);
    end if;
    return jsonb_build_object('ok', true, 'product_id', p_product_id, 'calc_type', v_type, 'calc_type_set', v_type_set,
      'has_cost', true,
      'cost_price', round(p.manual_cost_price, 4), 'raw_cost', round(p.manual_cost_price, 4),
      'labor_cost', 0, 'packaging_cost', 0, 'energy_cost', 0, 'quality', 'B',
      'set_at', p.manual_cost_set_at, 'note', p.manual_cost_note, 'notes', array[]::text[]);
  end if;

  if v_type = 'arvet' then
    if p.calc_source_product_id is null or p.calc_factor is null then
      return jsonb_build_object('ok', true, 'calc_type', v_type, 'calc_type_set', v_type_set, 'has_cost', false,
        'quality', 'C', 'notes', array['Hovedvare eller faktor mangler']);
    end if;
    v_sub := public.product_cost(p.calc_source_product_id, p_depth + 1);
    if not coalesce((v_sub ->> 'has_cost')::boolean, false) then
      return jsonb_build_object('ok', true, 'calc_type', v_type, 'calc_type_set', v_type_set, 'has_cost', false,
        'quality', 'C', 'notes', array['Hovedvaren mangler kalkyle']);
    end if;
    v_raw    := coalesce((v_sub ->> 'raw_cost')::numeric, 0)       * p.calc_factor;
    v_labor  := coalesce((v_sub ->> 'labor_cost')::numeric, 0)     * p.calc_factor;
    v_pack   := coalesce((v_sub ->> 'packaging_cost')::numeric, 0) * p.calc_factor;
    v_energy := coalesce((v_sub ->> 'energy_cost')::numeric, 0)    * p.calc_factor + v_energy;
    v_quality := 'B';

    for v_add in select * from public.product_cost_additions where product_id = p_product_id loop
      if v_add.fixed_cost is not null then
        v_raw := v_raw + v_add.fixed_cost;
      elsif v_add.raw_material_id is not null then
        select public.rm_usable_cost(rm.id) *
          case when rm.base_unit='stk' then case when rm.unit_weight_grams>0 then v_add.quantity_grams/rm.unit_weight_grams end
            else public.recipe_line_base_qty(v_add.quantity_grams,'g',v_add.quantity_grams,rm.base_unit,
              coalesce(rm.density_g_per_ml,case when rm.is_water then 1 end)) end
          into v_base from raw_materials rm where rm.id=v_add.raw_material_id;
        v_raw := v_raw + coalesce(v_base,0);
        if v_base is null then
          v_quality := 'C'; v_missing := true;
          v_notes := array_append(v_notes, format('Tillegg %s mangler kostpris', coalesce(v_add.description, '')));
        end if;
      elsif v_add.sub_product_id is not null then
        v_sub := public.product_cost(v_add.sub_product_id, p_depth + 1);
        if not coalesce((v_sub->>'has_cost')::boolean,false) then v_missing := true; v_notes := array_append(v_notes,'Tillegg mangler kalkyle'); end if;
        v_raw := v_raw + coalesce((v_sub ->> 'cost_price')::numeric, 0) * coalesce(v_add.quantity_grams, 1);
      end if;
    end loop;

  elsif v_type in ('handelsvare', 'bakeoff') then
    select public.rm_usable_cost(rm.id) * rmp.base_units_per_sold_unit, public.rm_usable_cost(rm.id)
      into v_purchase, v_base
      from public.raw_material_products rmp
      join public.raw_materials rm on rm.id = rmp.raw_material_id
     where rmp.product_id = p_product_id
     order by rmp.is_primary desc nulls last limit 1;

    if v_purchase is null then
      return jsonb_build_object('ok', true, 'calc_type', v_type, 'calc_type_set', v_type_set, 'has_cost', false,
        'quality', 'C', 'notes', array['Ikke koblet til råvare, eller råvaren mangler kostpris']);
    end if;

    v_shrink   := v_purchase * coalesce(p.shrinkage_pct, 0) / 100;
    v_freight  := case when p.freight_mode = 'kroner' then coalesce(p.freight_value, 0)
                       else (v_purchase + v_shrink) * coalesce(p.freight_value, 0) / 100 end;
    v_handling := case when p.handling_mode = 'kroner' then coalesce(p.handling_value, 0)
                       else (v_purchase + v_shrink + v_freight) * coalesce(p.handling_value, 0) / 100 end;
    v_storage  := case when p.storage_mode = 'kroner' then coalesce(p.storage_value, 0)
                       else (v_purchase + v_shrink + v_freight) * coalesce(p.storage_value, 0) / 100 end;
    v_raw := v_purchase + v_shrink + v_freight + v_handling + v_storage;

    if p.handling_value is null then
      v_quality := 'B'; v_notes := array_append(v_notes, 'Håndteringspåslag er ikke satt');
    end if;

    if v_type = 'bakeoff' then
      select coalesce(sum(l.hours * coalesce(l.hourly_rate, v_hourly_rate)), 0)
        into v_labor
        from public.recipe_labor_lines l
       where l.recipe_id in (select rc.id from public.recipes rc where rc.product_id = p_product_id
                             union select prl.recipe_id from public.product_recipe_links prl where prl.product_id = p_product_id);
    end if;

  elsif v_type = 'sammensatt' then
    -- H4: pakke = Σ (kost for delvare × antall) fra product_package_items
    for v_item in
      select ppi.contained_product_id, ppi.quantity, cp.display_name
        from public.product_package_items ppi
        join public.products cp on cp.id = ppi.contained_product_id
       where ppi.package_product_id = p_product_id
       order by ppi.sort_order, cp.display_name
    loop
      v_n_items := v_n_items + 1;
      v_sub := public.product_cost(v_item.contained_product_id, p_depth + 1);
      if not coalesce((v_sub ->> 'has_cost')::boolean, false) then
        v_missing := true; v_quality := 'C'; v_missing := true;
        v_notes := array_append(v_notes, format('Delen «%s» mangler kalkyle', v_item.display_name));
      else
        v_raw    := v_raw    + coalesce((v_sub ->> 'raw_cost')::numeric, 0)       * v_item.quantity;
        v_labor  := v_labor  + coalesce((v_sub ->> 'labor_cost')::numeric, 0)     * v_item.quantity;
        v_pack   := v_pack   + coalesce((v_sub ->> 'packaging_cost')::numeric, 0) * v_item.quantity;
        v_energy := v_energy + coalesce((v_sub ->> 'energy_cost')::numeric, 0)    * v_item.quantity;
        if (v_sub ->> 'quality') = 'C' then v_quality := 'C'; v_missing := true;
        elsif (v_sub ->> 'quality') = 'B' and v_quality = 'A' then v_quality := 'B'; end if;
        v_notes := v_notes || coalesce(
          (select array_agg(format('%s: %s', v_item.display_name, x))
             from jsonb_array_elements_text(coalesce(v_sub -> 'notes', '[]'::jsonb)) x),
          array[]::text[]);
      end if;
    end loop;
    if v_n_items = 0 then
      return jsonb_build_object('ok', true, 'calc_type', v_type, 'calc_type_set', v_type_set, 'has_cost', false,
        'quality', 'C', 'notes', array['Pakken har ingen deler (product_package_items)']);
    end if;
    if v_missing then
      return jsonb_build_object('ok', true, 'calc_type', v_type, 'calc_type_set', v_type_set, 'has_cost', false,
        'quality', 'C', 'package_items', v_n_items, 'notes', v_notes);
    end if;

  else
    -- oppskrift / halvfabrikat (og NULL): legacy recipes.product_id først, ellers product_recipe_links (primær først)
    select rc.id, rc.dough_piece_grams, rc.dough_waste_pct, rc.units_per_batch, null::numeric as upb_override
      into r
      from public.recipes rc
     where rc.product_id = p_product_id and rc.valid_to is null
     order by rc.version desc limit 1;
    if r.id is null then
      select rc.id, rc.dough_piece_grams, rc.dough_waste_pct, rc.units_per_batch, prl.units_per_batch_override as upb_override
        into r
        from public.recipes rc
        join public.product_recipe_links prl on prl.recipe_id = rc.id
       where prl.product_id = p_product_id and rc.valid_to is null
       order by prl.is_primary desc, rc.version desc limit 1;
    end if;
    if r.id is null then
      return jsonb_build_object('ok', true, 'calc_type', v_type, 'calc_type_set', v_type_set, 'has_cost', false,
        'quality', 'C', 'notes', v_notes || array['Ingen oppskrift knyttet til varen']);
    end if;
    v_recipe_id := r.id;

    -- H4: samme svinn-definisjon som deklarasjonskjernen (H1): linjemengden er det som veies inn
    -- (og kjøpes); waste_percent er andelen som går tapt → netto deig = Σ gram × (1 − svinn/100).
    select coalesce(sum(x.g),0),coalesce(sum(x.g*(1-coalesce(x.waste_percent,0)/100.0)),0),
           coalesce(bool_or(x.g is null),false)
      into v_dough,v_dough_net,v_unknown_weights
      from (select rl.waste_percent,public.recipe_cost_line_grams(rl.quantity,rl.unit,rl.quantity_grams,
          coalesce(rm.density_g_per_ml,case when rm.is_water then 1 end),rm.unit_weight_grams) g
        from recipe_lines rl left join raw_materials rm on rm.id=rl.raw_material_id where rl.recipe_id=r.id) x;
    if v_unknown_weights then v_missing:=true; v_notes:=array_append(v_notes,'Vekt eller tetthet mangler for oppskriftslinje'); end if;

    v_piece       := case when r.dough_piece_grams > 0 then r.dough_piece_grams end;
    v_dough_waste := r.dough_waste_pct;
    v_units       := coalesce(r.upb_override, r.units_per_batch);
    if (v_units is null or v_units <= 0) and v_piece is not null then
      v_units := v_dough_net * (1 - coalesce(v_dough_waste, 0) / 100) / v_piece;
    end if;
    if v_units is null or v_units <= 0 then
      return jsonb_build_object('ok', true, 'calc_type', v_type, 'calc_type_set', v_type_set, 'has_cost', false,
        'quality', 'C', 'recipe_id', r.id, 'dough_grams', v_dough, 'dough_grams_net', v_dough_net,
        'notes', v_notes || array['Deigemnevekt eller antall per bakst mangler']);
    end if;

    for v_line in
      select rl.quantity, rl.unit, rl.quantity_grams, rl.waste_percent,
             rl.raw_material_id, rl.sub_product_id, rl.ingredient_name,
             public.rm_usable_cost(rm.id) as current_cost_price, rm.cost_basis_status, rm.density_g_per_ml, rm.unit_weight_grams, rm.is_water, rm.name as rm_name, rm.base_unit, rm.package_confirmed_at
        from public.recipe_lines rl
        left join public.raw_materials rm on rm.id = rl.raw_material_id
       where rl.recipe_id = r.id
    loop
      if v_line.sub_product_id is not null then
        v_sub := public.product_cost(v_line.sub_product_id, p_depth + 1);
        v_g := public.recipe_cost_line_grams(v_line.quantity,v_line.unit,v_line.quantity_grams,null,null);
        if coalesce((v_sub ->> 'has_cost')::boolean, false) and v_g is not null
           and nullif(v_sub ->> 'cost_per_gram', '') is not null then
          v_raw := v_raw + v_g * (v_sub ->> 'cost_per_gram')::numeric;
          if (v_sub ->> 'quality') = 'C' then v_quality := 'C'; v_missing := true;
          elsif (v_sub ->> 'quality') = 'B' and v_quality = 'A' then v_quality := 'B'; end if;
        else
          v_quality := 'C'; v_missing := true;
          v_notes := array_append(v_notes, format('Halvfabrikatet «%s» mangler kalkyle',
                       coalesce((select display_name from public.products where id = v_line.sub_product_id), '?')));
        end if;

      elsif v_line.raw_material_id is not null then
        if v_line.current_cost_price is null then
          v_quality := 'C'; v_missing := true;
          v_notes := array_append(v_notes, format('%s mangler kostpris', coalesce(v_line.rm_name, '?')));
        else
          v_qty := public.recipe_line_base_qty(v_line.quantity, v_line.unit, public.recipe_cost_line_grams(v_line.quantity,v_line.unit,v_line.quantity_grams,
             coalesce(v_line.density_g_per_ml,case when v_line.is_water then 1 end),v_line.unit_weight_grams),
             v_line.base_unit, coalesce(v_line.density_g_per_ml,case when v_line.is_water then 1 end));
          if v_qty is null then
            v_quality := 'C'; v_missing := true;
            v_notes := array_append(v_notes,
              format('%s: enheten «%s» kan ikke regnes om til %s',
                     coalesce(v_line.rm_name, '?'), coalesce(v_line.unit, '?'), v_line.base_unit));
          else
            v_raw := v_raw + v_qty * v_line.current_cost_price;
            if v_line.cost_basis_status = 'uverifisert' then
              if v_quality = 'A' then v_quality := 'B'; end if;
              v_notes := array_append(v_notes, format('%s: kostprisen har ingen verifisert kilde', v_line.rm_name));
            end if;
            if v_line.package_confirmed_at is null and v_quality = 'A' then
              v_quality := 'B';
              v_notes := array_append(v_notes, format('%s har ubekreftet pakningsstørrelse', v_line.rm_name));
            end if;
          end if;
        end if;

      else
        v_quality := 'C'; v_missing := true;
        v_notes := array_append(v_notes,
          format('Linjen %s er ikke koblet til en råvare', coalesce(v_line.ingredient_name, '?')));
      end if;
    end loop;

    v_raw := v_raw / v_units;

    select coalesce(sum(l.hours * coalesce(l.hourly_rate, v_hourly_rate)), 0) / v_units
      into v_labor from public.recipe_labor_lines l where l.recipe_id = r.id;

    -- H4: emballasjelinjene gjelder hele baksten → deles på antall enheter
    select coalesce(sum(pl.quantity * coalesce(pl.unit_price_override, public.rm_usable_cost(rm.id), 0)), 0) / v_units
      into v_pack
      from public.recipe_packaging_lines pl
      left join public.raw_materials rm on rm.id = pl.raw_material_id
     where pl.recipe_id = r.id;

    if coalesce(v_dough_waste, 0) = 0 and v_type <> 'halvfabrikat' then
      v_notes := array_append(v_notes, 'Deigsvinn er ikke satt');
    end if;

    if exists(select 1 from public.recipe_packaging_lines pl
       where pl.recipe_id=r.id and pl.unit_price_override is null
         and public.rm_usable_cost(pl.raw_material_id) is null) then
      v_missing:=true; v_notes:=array_append(v_notes,'Emballasje mangler verifisert kostpris');
    end if;
    -- kost per gram ferdig deigemne (til halvfabrikat-linjer): emnevekt, ellers netto deig / enheter
    v_cpg := case when v_piece > 0 then (v_raw + v_labor + v_energy) / v_piece
                  when v_dough_net > 0 then (v_raw + v_labor + v_energy)
                                            / (v_dough_net * (1 - coalesce(v_dough_waste, 0) / 100) / v_units)
             end;
  end if;

  if v_missing then
    return jsonb_build_object('ok',true,'product_id',p_product_id,'calc_type',v_type,
      'calc_type_set',v_type_set,'has_cost',false,'quality','C','recipe_id',v_recipe_id,
      'cost_price',null,'cost_per_gram',null,'notes',v_notes);
  end if;
  return jsonb_build_object(
    'ok', true, 'product_id', p_product_id, 'calc_type', v_type, 'calc_type_set', v_type_set, 'has_cost', true,
    'raw_cost', round(v_raw, 4), 'labor_cost', round(v_labor, 4),
    'packaging_cost', round(v_pack, 4), 'energy_cost', round(v_energy, 4),
    'cost_price', round(v_raw + v_labor + v_energy
                    + case when v_packaging_mode = 'trekkes_fra' then v_pack else 0 end, 4),
    'cost_per_gram', round(v_cpg, 6),
    'units_per_batch', round(v_units, 3),
    'recipe_id', v_recipe_id,
    'dough_grams', v_dough, 'dough_grams_net', v_dough_net, 'dough_waste_pct', v_dough_waste,
    'dough_piece_grams', v_piece,
    'purchase_cost', round(v_purchase, 4), 'shrinkage_cost', round(v_shrink, 4),
    'freight_cost', round(v_freight, 4), 'handling_cost', round(v_handling, 4),
    'storage_cost', round(v_storage, 4),
    'package_items', nullif(v_n_items, 0),
    'packaging_mode', v_packaging_mode, 'hourly_rate', v_hourly_rate,
    'quality', v_quality, 'notes', v_notes);
end;
$function$
;
SELECT h4_mark_cost_stale((SELECT array_agg(id) FROM products));
COMMIT;

