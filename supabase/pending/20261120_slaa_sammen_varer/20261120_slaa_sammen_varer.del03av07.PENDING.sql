-- VENTER PÅ ROOT. 20261120_slaa_sammen_varer.del03av07.PENDING.sql – del 3 av 7 av 20261120_slaa_sammen_varer.PENDING.sql (12976 byte tekst).
-- Legger bare teksten i mellomlagringen og kontrollerer md5. Ingen virkning på appen før del 7 («kjør»).
-- Kan kjøres på nytt (overskriver samme del). md5 for delen: 024e58e5d9b7ba5cc92484f04182bb22

do $g$ begin
  if to_regclass('public._rm_sql_stage') is null then raise exception 'Kjør del 01 først'; end if;
  if not exists (select 1 from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 2) then
    raise exception 'Kjør del 02 først';
  end if;
end $g$;
insert into public._rm_sql_stage (file, part, body) values ('20261120_slaa_sammen_varer', 3, $stage$                format('%s «%s» er avvist på «%s» hos denne leverandøren og læres ikke.', case when x.t = 'supplier_sku' then 'Varenummeret' else 'Varenavnet' end, x.v, v_keep.name), false);
            elsif v_st in ('pending', 'superseded') then
              update public.raw_material_supplier_aliases set status = 'confirmed', confirmed_by = p_uid, confirmed_at = v_now where id = v_src;
              v_log := public._rm_merge_push(v_log, 'aliases_status', jsonb_build_array(jsonb_build_object('id', v_src, 's', v_st, 'cb', v_cb, 'ca', v_ca)));
              v_counts := public._rm_merge_add(v_counts, case when x.t = 'supplier_sku' then 'varenumre_laert' else 'skrivemater' end, 1);
            end if;
          end loop;
          with upd as (
            update public.raw_material_supplier_packages p set raw_material_supplier_id = kr.id, base_units_per_package = o.base_units_per_package * v_f
              from public.raw_material_supplier_packages o
             where o.id = p.id and p.raw_material_supplier_id = r.id
               and not exists (select 1 from public.raw_material_supplier_packages k where k.raw_material_supplier_id = kr.id
                     and k.supplier_sku_norm = o.supplier_sku_norm and coalesce(k.package_size, -1) = coalesce(o.package_size, -1)
                     and coalesce(lower(k.package_unit), '') = coalesce(lower(o.package_unit), '') and k.base_units_per_package = o.base_units_per_package * v_f)
            returning p.id, o.base_units_per_package b)
          select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'from', r.id, 'b', b)), '[]'), count(*) into v_j, v_n from upd;
          v_log := public._rm_merge_push(v_log, 'packages_moved', v_j); v_counts := public._rm_merge_add(v_counts, 'pakninger', v_n);
          if r.agreed_price_per_base_unit is not null then
            if kr.agreed_price_per_base_unit is null then
              update public.raw_material_suppliers set agreed_price_per_base_unit = r.agreed_price_per_base_unit / v_f,
                     agreement_valid_from = r.agreement_valid_from, agreement_valid_to = r.agreement_valid_to,
                     agreement_document_url = coalesce(agreement_document_url, r.agreement_document_url)
               where id = kr.id;
              v_log := public._rm_merge_push(v_log, 'agreement_copied', jsonb_build_array(jsonb_build_object(
                'id', kr.id, 'a', kr.agreed_price_per_base_unit, 'vf', kr.agreement_valid_from, 'vt', kr.agreement_valid_to,
                'u', kr.agreement_document_url, 'na', r.agreed_price_per_base_unit / v_f)));
              v_counts := public._rm_merge_add(v_counts, 'avtalepriser', 1);
            else
              v_conf := v_conf || public._rm_merge_conf('avtalepris_finnes', format('Begge varene har avtalepris hos samme leverandør. «%s» beholder sin.', v_keep.name), false);
            end if;
          end if;
          v_conf := v_conf || public._rm_merge_conf('samme_leverandor',
            format('«%s» og «%s» har samme leverandør. Varenummer og varenavn læres på beholdt vare; den gamle koblingen blir stående på varen som slås sammen.', v_dup.name, v_keep.name), false);
        end if;
      end loop;

      -- Fakturalinjer (grunnmengde og pris per grunnenhet regnes om ved ulik enhet; trykte tall endres ikke)
      perform set_config('rm.exclusion_write', 'on', true);
      perform set_config('rm.defer_stats', 'on', true);
      with o as (select id, base_quantity, price_per_base_unit, package_source_rms_id from public.invoice_lines where raw_material_id = v_d),
      upd as (
        update public.invoice_lines il set raw_material_id = p_keep,
               base_quantity = case when v_f <> 1 then o.base_quantity * v_f else il.base_quantity end,
               price_per_base_unit = case when v_f <> 1 then o.price_per_base_unit / v_f else il.price_per_base_unit end,
               package_source_rms_id = coalesce((v_rms_map ->> o.package_source_rms_id::text)::uuid, il.package_source_rms_id)
          from o where il.id = o.id
        returning il.id, o.base_quantity bq, o.price_per_base_unit pp, o.package_source_rms_id ps)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'bq', bq, 'pp', pp, 'ps', ps)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'lines', v_j); v_counts := public._rm_merge_add(v_counts, 'fakturalinjer', v_n);
      with o as (select id, excluded_raw_material_id e, exclusion_prev ep from public.invoice_lines
                  where excluded_raw_material_id = v_d or exclusion_prev ->> 'raw_material_id' = v_d::text),
      upd as (
        update public.invoice_lines il set
               excluded_raw_material_id = case when o.e = v_d then p_keep else il.excluded_raw_material_id end,
               exclusion_prev = case when o.ep ->> 'raw_material_id' = v_d::text then jsonb_set(o.ep, '{raw_material_id}', to_jsonb(p_keep)) else il.exclusion_prev end
          from o where il.id = o.id
        returning il.id, o.e, o.ep)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'e', e, 'ep', ep)), '[]') into v_j from upd;
      v_log := public._rm_merge_push(v_log, 'lines_excluded', v_j);
      perform set_config('rm.exclusion_write', '', true);
      if v_f <> 1 then
        select count(*) into v_n from public.invoice_lines where raw_material_id = p_keep and price_acceptance is not null
           and id in (select (e ->> 'id')::uuid from jsonb_array_elements(v_log -> 'lines') e where e ->> 'd' = v_d::text);
        if v_n > 0 then
          v_conf := v_conf || public._rm_merge_conf('godtatt_pris_annen_enhet', format('%s fakturalinjer har godtatt pris i gammel enhet. Prisvarsel kan komme tilbake.', v_n), false);
        end if;
      end if;
      with upd as (update public.raw_material_purchases set raw_material_id = p_keep where raw_material_id = v_d returning id)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]') into v_j from upd;
      v_log := public._rm_merge_push(v_log, 'purchases', v_j);

      -- Bruk i oppskrifter og kalkyler
      with upd as (update public.recipe_lines set raw_material_id = p_keep where raw_material_id = v_d returning id, recipe_id)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]'), count(*), count(distinct recipe_id) into v_j, v_n, v_n2 from upd;
      v_log := public._rm_merge_push(v_log, 'recipe_lines', v_j);
      v_counts := public._rm_merge_add(public._rm_merge_add(v_counts, 'oppskriftslinjer', v_n), 'oppskrifter', v_n2);
      with upd as (update public.recipe_packaging_lines set raw_material_id = p_keep where raw_material_id = v_d returning id)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'packaging_lines', v_j); v_counts := public._rm_merge_add(v_counts, 'emballasjelinjer', v_n);
      with upd as (update public.product_cost_additions set raw_material_id = p_keep where raw_material_id = v_d returning id)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'cost_additions', v_j); v_counts := public._rm_merge_add(v_counts, 'kalkyletillegg', v_n);

      -- Handelsvare-kobling (påslag og prislister følger produktet)
      with upd as (
        update public.raw_material_products p set raw_material_id = p_keep, base_units_per_sold_unit = o.base_units_per_sold_unit * v_f
          from public.raw_material_products o
         where o.id = p.id and p.raw_material_id = v_d
           and not exists (select 1 from public.raw_material_products k where k.raw_material_id = p_keep and k.product_id = o.product_id)
        returning p.id, o.base_units_per_sold_unit b)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'b', b)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'products', v_j); v_counts := public._rm_merge_add(v_counts, 'handelsvarekoblinger', v_n);
      select count(*) into v_n from public.raw_material_products where raw_material_id = v_d;
      if v_n > 0 then
        v_conf := v_conf || public._rm_merge_conf('produkt_finnes', format('%s salgsprodukter er koblet til begge varene; koblingen på «%s» blir stående.', v_n, v_dup.name), false);
      end if;

      -- Enheter
      with upd as (
        update public.raw_material_units u set raw_material_id = p_keep, units_in_base = o.units_in_base * v_f,
               is_default_purchase = o.is_default_purchase and not exists (select 1 from public.raw_material_units k where k.raw_material_id = p_keep and k.is_default_purchase),
               is_default_count = o.is_default_count and not exists (select 1 from public.raw_material_units k where k.raw_material_id = p_keep and k.is_default_count),
               is_sales_unit = o.is_sales_unit and not exists (select 1 from public.raw_material_units k where k.raw_material_id = p_keep and k.is_sales_unit)
          from public.raw_material_units o
         where o.id = u.id and u.raw_material_id = v_d
           and not exists (select 1 from public.raw_material_units k where k.raw_material_id = p_keep and lower(k.unit_label) = lower(o.unit_label))
        returning u.id, o.units_in_base b, o.is_default_purchase dp, o.is_default_count dc, o.is_sales_unit su)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'b', b, 'dp', dp, 'dc', dc, 'su', su)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'units', v_j); v_counts := public._rm_merge_add(v_counts, 'enheter', v_n);

      -- Forhandlinger (bare samme enhet), sammensetning, tellemaler
      if v_f = 1 then
        with upd as (
          update public.negotiation_items n set raw_material_id = p_keep
           where n.raw_material_id = v_d
             and not exists (select 1 from public.negotiation_items k where k.negotiation_id = n.negotiation_id and k.raw_material_id = p_keep)
          returning n.id)
        select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]'), count(*) into v_j, v_n from upd;
        v_log := public._rm_merge_push(v_log, 'negotiation_items', v_j); v_counts := public._rm_merge_add(v_counts, 'forhandlinger', v_n);
      end if;
      select count(*) into v_n from public.negotiation_items where raw_material_id = v_d;
      if v_n > 0 then
        v_conf := v_conf || public._rm_merge_conf('forhandling_blir_staende', format('%s forhandlingslinjer på «%s» blir stående (annen enhet eller samme forhandling).', v_n, v_dup.name), false);
      end if;
      with upd as (update public.raw_material_components set component_raw_material_id = p_keep where component_raw_material_id = v_d returning id)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'components_child', v_j); v_counts := public._rm_merge_add(v_counts, 'komponenter', v_n);
      if not exists (select 1 from public.raw_material_components where parent_raw_material_id = p_keep) then
        with upd as (update public.raw_material_components set parent_raw_material_id = p_keep where parent_raw_material_id = v_d returning id)
        select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]'), count(*) into v_j, v_n from upd;
        v_log := public._rm_merge_push(v_log, 'components_parent', v_j); v_counts := public._rm_merge_add(v_counts, 'komponenter', v_n);
        if v_n > 0 then v_parent_moved := true; end if;
      elsif exists (select 1 from public.raw_material_components where parent_raw_material_id = v_d) then
        v_conf := v_conf || public._rm_merge_conf('sammensetning_finnes', format('Begge varene har sammensetning. «%s» beholder sin.', v_keep.name), false);
      end if;
      with upd as (
        update public.vt_template_lines t set raw_material_id = p_keep
         where t.raw_material_id = v_d
           and not exists (select 1 from public.vt_template_lines k where k.template_id = t.template_id and k.raw_material_id = p_keep
                            and coalesce(k.location_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(t.location_id, '00000000-0000-0000-0000-000000000000'::uuid))
        returning t.id)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'template_lines', v_j); v_counts := public._rm_merge_add(v_counts, 'tellemaler', v_n);
      select count(*) into v_n from public.vt_count_lines where raw_material_id = v_d;
      if v_n > 0 then
        v_conf := v_conf || public._rm_merge_conf('tellinger_blir_staende', format('%s linjer i avsluttede tellinger har låst grunnlag og blir stående på «%s».', v_n, v_dup.name), false);
      end if;

$stage$)
  on conflict (file, part) do update set body = excluded.body, created_at = now();
do $g$ begin
  if (select md5(body) from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 3) <> '024e58e5d9b7ba5cc92484f04182bb22' then
    raise exception 'Del 03 er ikke skrevet inn riktig (md5 avviker) – skriv den inn på nytt';
  end if;
end $g$;
