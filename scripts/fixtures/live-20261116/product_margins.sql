CREATE OR REPLACE FUNCTION public.product_margins(p_product_id uuid, p_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c jsonb; s record; p record; pl record; t record;
  v_rows jsonb := '[]'::jsonb;
  v_price numeric; v_raw numeric; v_labor numeric; v_pack numeric; v_energy numeric;
  v_brutto numeric; v_db2 numeric; v_dg2 numeric; v_status text;
  v_need_br numeric; v_need_dg numeric; v_need numeric; v_avvik numeric;
begin
  select id, legal_entity_id, display_name, calc_type into p from public.products where id = p_product_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'Varen finnes ikke'); end if;

  c := public.product_cost(p_product_id);
  select * into s from public.entity_calc_settings where legal_entity_id = p.legal_entity_id;

  if not coalesce((c->>'has_cost')::boolean, false) then
    return jsonb_build_object('ok', true, 'has_cost', false, 'cost', c, 'levels', '[]'::jsonb);
  end if;

  v_raw    := coalesce((c->>'raw_cost')::numeric, 0);
  v_labor  := coalesce((c->>'labor_cost')::numeric, 0);
  v_pack   := coalesce((c->>'packaging_cost')::numeric, 0);
  v_energy := coalesce((c->>'energy_cost')::numeric, 0);

  for pl in
    select l.id, l.code, l.display_name, l.price_level, l.is_provisional, l.prices_include_mva,
           (select pli.price from public.price_list_items pli
             where pli.price_list_id = l.id and pli.product_id = p_product_id
               and pli.valid_from <= p_date and (pli.valid_to is null or pli.valid_to >= p_date)
             order by pli.valid_from desc limit 1) as price
      from public.price_lists l
     where l.legal_entity_id = p.legal_entity_id and l.status = 'active' and l.price_level is not null
     order by l.price_level, l.code
  loop
    v_price := pl.price;
    if pl.prices_include_mva and v_price is not null then
      v_price := v_price / (1 + coalesce((select mva_rate from public.products where id=p_product_id),15)/100);
    end if;

    select * into t from public.resolve_margin_target(p_product_id, pl.price_level);

    if v_price is null or v_price <= 0 then
      v_brutto := null; v_db2 := null; v_dg2 := null; v_status := 'ingen_pris'; v_avvik := null;
    else
      v_brutto := (v_price - v_raw) / v_price * 100;
      v_db2    := v_price - v_raw - v_labor - v_energy;
      v_dg2    := v_db2 / v_price * 100;
      v_avvik  := least(coalesce(v_brutto - t.target_brutto_pct, 999),
                        coalesce(v_dg2 - t.target_dg2_pct, 999));
      v_status := case
        when (c->>'quality') = 'C'         then 'ikke_vurdert'
        when p.calc_type = 'halvfabrikat'  then 'halvfabrikat'
        when pl.is_provisional             then 'forelopig'
        when v_avvik >= 0                  then 'gronn'
        when v_avvik >= -coalesce(t.warn_below_pp,3) then 'gul'
        else 'rod' end;
    end if;

    v_need_br := case when t.target_brutto_pct is not null and t.target_brutto_pct < 100
                      then v_raw / (1 - t.target_brutto_pct/100) end;
    v_need_dg := case when t.target_dg2_pct is not null and t.target_dg2_pct < 100
                      then (v_raw + v_labor + v_energy) / (1 - t.target_dg2_pct/100) end;
    v_need := greatest(coalesce(v_need_br, 0), coalesce(v_need_dg, 0));
    if v_need = 0 then v_need := null; end if;

    v_rows := v_rows || jsonb_build_object(
      'price_list_id', pl.id, 'code', pl.code, 'name', pl.display_name,
      'price_level', pl.price_level, 'is_provisional', pl.is_provisional,
      'price', round(v_price, 2),
      'price_with_packaging', case when v_price is not null and coalesce(s.packaging_mode,'legges_til')='legges_til'
                                   then round(v_price + v_pack, 2) end,
      'brutto_pct', round(v_brutto, 2), 'db2', round(v_db2, 2), 'dg2_pct', round(v_dg2, 2),
      'target_brutto_pct', t.target_brutto_pct, 'target_dg2_pct', t.target_dg2_pct,
      'target_source', t.source, 'avvik_pp', round(v_avvik, 2),
      'needed_price', round(v_need, 2),
      'needed_change_pct', case when v_price > 0 and v_need is not null
                                then round((v_need / v_price - 1) * 100, 1) end,
      'status', v_status);
  end loop;

  return jsonb_build_object('ok', true, 'has_cost', true, 'product', p.display_name,
    'calc_type', p.calc_type, 'cost', c, 'levels', v_rows);
end $function$
