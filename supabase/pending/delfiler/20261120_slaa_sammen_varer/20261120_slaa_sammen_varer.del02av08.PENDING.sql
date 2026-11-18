-- VENTER PÅ ROOT. 20261120_slaa_sammen_varer.del02av08.PENDING.sql – del 2 av 8 av 20261120_slaa_sammen_varer.PENDING.sql (12833 byte tekst).
-- Legger bare teksten i mellomlagringen og kontrollerer md5. Ingen virkning på appen før del 8 («kjør»).
-- Kan kjøres på nytt (overskriver samme del). md5 for delen: e2feb7079dc710126bc2d9d0180f35d9

do $g$ begin
  if to_regclass('public._rm_sql_stage') is null then raise exception 'Kjør del 01 først'; end if;
  if not exists (select 1 from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 1) then
    raise exception 'Kjør del 01 først';
  end if;
end $g$;
insert into public._rm_sql_stage (file, part, body) values ('20261120_slaa_sammen_varer', 2, replace(replace(replace($stage$    v_factor := v_factor || jsonb_build_object(v_d::text, v_f);

    select count(*) into v_n from public.invoice_lines il where il.raw_material_id = v_d
       and exists (select 1 from public.invoice_line_cost_postings p where p.invoice_line_id = il.id and p.revoked_at is null);
    if v_n > 0 then
      v_conf := v_conf || public._rm_merge_conf('kostpris_fort', format('«%s» har %s fakturalinjer med ført kostpris. De er låst og kan ikke flyttes.', v_dup.name, v_n), true);
    end if;
    select count(*) into v_n from public.vt_count_lines l join public.vt_counts c on c.id = l.count_id
     where l.raw_material_id = v_d and c.status in ('pagar', 'til_kontroll');
    if v_n > 0 then
      v_conf := v_conf || public._rm_merge_conf('apen_telling', format('«%s» står i en åpen varetelling. Avslutt tellingen først.', v_dup.name), true);
    end if;
    if v_f <> 1 then
      select count(*) into v_n from public.recipe_packaging_lines where raw_material_id = v_d;
      if v_n > 0 then
        v_conf := v_conf || public._rm_merge_conf('emballasje_annen_enhet', format('«%s» brukes som emballasje i %s kalkyler med en annen enhet. Bytt dem først.', v_dup.name, v_n), true);
      end if;
    end if;
    if exists (select 1 from public.raw_material_components c
                where (c.parent_raw_material_id = p_keep and c.component_raw_material_id = v_d)
                   or (c.parent_raw_material_id = v_d and c.component_raw_material_id = p_keep)) then
      v_conf := v_conf || public._rm_merge_conf('komponent', format('«%s» og «%s» inngår i hverandres sammensetning.', v_dup.name, v_keep.name), true);
    end if;
    if v_dup.produced_by_recipe_id is not null then
      v_conf := v_conf || public._rm_merge_conf('lages_av_oppskrift', format('«%s» lages av en egen oppskrift og kan ikke slås sammen her.', v_dup.name), true);
    end if;
    if v_keep.declaration_name is not null and v_dup.declaration_name is not null
       and lower(btrim(v_keep.declaration_name)) <> lower(btrim(v_dup.declaration_name)) then
      v_conf := v_conf || public._rm_merge_conf('deklarasjonsnavn_ulikt',
        format('Deklarasjonsnavnet er ulikt («%s» / «%s»). «%s» beholder sitt.', v_keep.declaration_name, v_dup.declaration_name, v_keep.name), false);
    end if;
  end loop;

  v_blocking := exists (select 1 from jsonb_array_elements(v_conf) c where (c ->> 'blocking')::boolean);
  v_cost_before := jsonb_build_object('price', v_keep.current_cost_price, 'status', v_keep.cost_basis_status, 'unit', v_keep.base_unit);
  if v_blocking then
    if not p_dry_run then return jsonb_build_object('ok', false, 'code', 'konflikt', 'conflicts', v_conf); end if;
    -- Forhåndsvisning med sperre: ingen simulering, bare hva som stopper.
    return jsonb_build_object('ok', true, 'dry_run', true, 'can_apply', false, 'merge_id', null, 'keep_id', p_keep,
      'merged_ids', to_jsonb(v_dups), 'counts', '{}'::jsonb, 'conflicts', v_conf,
      'cost', jsonb_build_object('before', v_cost_before, 'after', null), 'factors', v_factor, 'grams_per_piece', v_gpp_used);
  end if;

  begin
    foreach v_d in array v_dups loop
      select * into v_dup from public.raw_materials where id = v_d;
      v_f := (v_factor ->> v_d::text)::numeric;

      -- Koblingsforslag
      with del as (
        delete from public.invoice_line_match_suggestions s where s.raw_material_id = v_d
           and exists (select 1 from public.invoice_line_match_suggestions k where k.invoice_line_id = s.invoice_line_id and k.raw_material_id = p_keep)
        returning s.*)
      select coalesce(jsonb_agg(to_jsonb(del)), '[]') into v_j from del;
      v_log := public._rm_merge_push(v_log, 'suggestions_deleted', v_j);
      with upd as (update public.invoice_line_match_suggestions set raw_material_id = p_keep where raw_material_id = v_d returning id)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]') into v_j from upd;
      v_log := public._rm_merge_push(v_log, 'suggestions_moved', v_j);

      -- Lager (før fakturalinjene, slik at fakturabevegelsene oppdateres i stedet for å slettes)
      with upd as (
        update public.stock_movements m set raw_material_id = p_keep, quantity_base = o.quantity_base * v_f
          from public.stock_movements o
         where o.id = m.id and m.raw_material_id = v_d
           and not (o.source_id is not null and exists (select 1 from public.stock_movements k where k.raw_material_id = p_keep
                      and k.source_table is not distinct from o.source_table and k.source_id = o.source_id))
        returning m.id, o.quantity_base q)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'q', q)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'movements', v_j); v_counts := public._rm_merge_add(v_counts, 'lagerbevegelser', v_n);
      select count(*) into v_n from public.stock_movements where raw_material_id = v_d;
      if v_n > 0 then
        v_conf := v_conf || public._rm_merge_conf('lagerbevegelse_blir_staende', format('%s lagerbevegelser på «%s» gjelder samme kilde som en bevegelse på beholdt vare og blir stående.', v_n, v_dup.name), false);
      end if;
      with upd as (
        update public.rm_stock_lots l set raw_material_id = p_keep, quantity_base = o.quantity_base * v_f, remaining_base = o.remaining_base * v_f
          from public.rm_stock_lots o where o.id = l.id and l.raw_material_id = v_d
        returning l.id, o.quantity_base q, o.remaining_base rb)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'q', q, 'rb', rb)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'lots', v_j); v_counts := public._rm_merge_add(v_counts, 'partier', v_n);
      with upd as (
        update public.rm_goods_receipts g set raw_material_id = p_keep, quantity_base = o.quantity_base * v_f
          from public.rm_goods_receipts o where o.id = g.id and g.raw_material_id = v_d
        returning g.id, o.quantity_base q)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'q', q)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'receipts', v_j); v_counts := public._rm_merge_add(v_counts, 'varemottak', v_n);

      -- Prishistorikk (før fakturalinjene; observasjoner i annen enhet teller ikke for kost, men vises)
      with upd as (
        update public.raw_material_price_history h set raw_material_id = p_keep
          from public.raw_material_price_history o where o.id = h.id and h.raw_material_id = v_d
        returning h.id, o.superseded_at s, o.superseded_reason rs)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 's', s, 'r', rs)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'history', v_j); v_counts := public._rm_merge_add(v_counts, 'prishistorikk', v_n);
      if v_f <> 1 then
        update public.raw_material_price_history set superseded_at = v_now, superseded_reason = 'sammenslatt_annen_enhet'
         where id in (select (e ->> 'id')::uuid from jsonb_array_elements(v_j) e) and superseded_at is null;
      end if;

      -- Leverandørkoblinger, varenumre, skrivemåter, pakninger og avtalepriser
      for r in select * from public.raw_material_suppliers where raw_material_id = v_d order by created_at, id loop
        select * into kr from public.raw_material_suppliers where raw_material_id = p_keep and supplier_id = r.supplier_id;
        if not found then
          if v_f <> 1 then
            with upd as (
              update public.raw_material_supplier_packages p set base_units_per_package = o.base_units_per_package * v_f
                from public.raw_material_supplier_packages o where o.id = p.id and p.raw_material_supplier_id = r.id
              returning p.id, o.base_units_per_package b)
            select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'b', b)), '[]') into v_j from upd;
            v_log := public._rm_merge_push(v_log, 'packages_converted', v_j);
          end if;
          select coalesce(array_agg(id), '{}') into v_pkg_before from public.raw_material_supplier_packages where raw_material_supplier_id = r.id;
          if v_f = 1 then
            update public.raw_material_suppliers s set raw_material_id = p_keep,
                   is_primary = s.is_primary and not exists (select 1 from public.raw_material_suppliers k where k.raw_material_id = p_keep and k.is_primary)
             where s.id = r.id;
          else
            perform set_config('app.rm_start_price_rpc', '1', true);
            update public.raw_material_suppliers s set raw_material_id = p_keep,
                   is_primary = s.is_primary and not exists (select 1 from public.raw_material_suppliers k where k.raw_material_id = p_keep and k.is_primary),
                   base_units_per_package = s.base_units_per_package * v_f,
                   agreed_price_per_base_unit = s.agreed_price_per_base_unit / v_f,
                   start_price_per_base_unit = s.start_price_per_base_unit / v_f,
                   start_price_base_units_per_package = s.start_price_base_units_per_package * v_f,
                   start_price_base_unit = case when s.start_price_base_unit is null then null else v_keep.base_unit end
             where s.id = r.id;
            perform set_config('app.rm_start_price_rpc', '', true);
            -- Pakningsvariant-triggeren lagrer den gamle (uomregnede) pakningen: den gjelder ikke beholdt enhet.
            delete from public.raw_material_supplier_packages
             where raw_material_supplier_id = r.id and id <> all(v_pkg_before) and base_units_per_package = r.base_units_per_package;
          end if;
          select coalesce(jsonb_agg(to_jsonb(id)), '[]') into v_j from public.raw_material_supplier_packages
           where raw_material_supplier_id = r.id and id <> all(v_pkg_before);
          v_log := public._rm_merge_push(v_log, 'packages_created', v_j);
          v_log := public._rm_merge_push(v_log, 'suppliers_moved', jsonb_build_array(jsonb_build_object(
            'id', r.id, 'd', v_d, 'p', r.is_primary, 'b', r.base_units_per_package, 'a', r.agreed_price_per_base_unit,
            'sp', r.start_price_per_base_unit, 'spb', r.start_price_base_units_per_package, 'spu', r.start_price_base_unit)));
          v_counts := public._rm_merge_add(v_counts, 'leverandorkoblinger', 1);
        else
          v_rms_map := v_rms_map || jsonb_build_object(r.id::text, kr.id);
          with upd as (
            update public.raw_material_supplier_aliases a set raw_material_supplier_id = kr.id
             where a.raw_material_supplier_id = r.id and a.status in ('confirmed', 'pending')
               and not exists (select 1 from public.raw_material_supplier_aliases k where k.raw_material_supplier_id = kr.id
                                and k.alias_type = a.alias_type and k.alias_value_normalized = a.alias_value_normalized)
            returning a.id)
          select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', r.id)), '[]'), count(*) into v_j, v_n from upd;
          v_log := public._rm_merge_push(v_log, 'aliases_moved', v_j); v_counts := public._rm_merge_add(v_counts, 'skrivemater', v_n);
          -- Lær leverandørens varenummer og varenavn på beholdt kobling (to varenumre hos samme leverandør er lov).
          for x in select q.t, q.v from (values ('supplier_sku'::public.alias_type, r.supplier_sku), ('product_name'::public.alias_type, r.supplier_product_name)) q(t, v) loop
            continue when x.v is null or btrim(x.v) = '';
            continue when x.t = 'supplier_sku' and public.rm_sku_norm(x.v) = public.rm_sku_norm(kr.supplier_sku);
            continue when x.t = 'product_name' and lower(btrim(x.v)) = lower(btrim(coalesce(kr.supplier_product_name, '')));
            v_src := null;
            select id, status, confirmed_by, confirmed_at into v_src, v_st, v_cb, v_ca from public.raw_material_supplier_aliases
             where raw_material_supplier_id = kr.id and alias_type = x.t and alias_value_normalized = lower(btrim(x.v));
            if v_src is null then
              insert into public.raw_material_supplier_aliases (raw_material_supplier_id, alias_type, alias_value, status, match_count, confirmed_by, confirmed_at, last_seen_at)
              values (kr.id, x.t, btrim(x.v), 'confirmed', 0, p_uid, v_now, v_now) returning id into v_src;
              v_log := public._rm_merge_push(v_log, 'aliases_created', jsonb_build_array(to_jsonb(v_src)));
              v_counts := public._rm_merge_add(v_counts, case when x.t = 'supplier_sku' then 'varenumre_laert' else 'skrivemater' end, 1);
            elsif v_st = 'rejected' then
              v_conf := v_conf || public._rm_merge_conf('avvist_pa_beholdt',
$stage$, chr(13), ''), chr(160), ' '), chr(9), ' '))
  on conflict (file, part) do update set body = excluded.body, created_at = now();
do $g$ begin
  if (select md5(body) from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 2) <> 'e2feb7079dc710126bc2d9d0180f35d9' then
    raise exception 'Del 02 er ikke skrevet inn riktig (md5 avviker) – skriv den inn på nytt';
  end if;
end $g$;
