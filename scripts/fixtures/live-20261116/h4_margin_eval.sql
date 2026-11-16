CREATE OR REPLACE FUNCTION public.h4_margin_eval(p_product_id uuid, p_price_level price_level, p_price numeric, p_is_provisional boolean, p_calc_type text, p_cost jsonb)
 RETURNS TABLE(brutto_pct numeric, db2 numeric, dg2_pct numeric, target_brutto_pct numeric, target_dg2_pct numeric, warn_below_pp numeric, target_source text, avvik_pp numeric, needed_price numeric, status text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  t record; v_raw numeric; v_labor numeric; v_energy numeric; v_need_br numeric; v_need_dg numeric;
begin
  select * into t from public.resolve_margin_target(p_product_id, p_price_level);
  target_brutto_pct := t.target_brutto_pct;
  target_dg2_pct    := t.target_dg2_pct;
  warn_below_pp     := t.warn_below_pp;
  target_source     := t.source;

  v_raw    := nullif(p_cost ->> 'raw_cost', '')::numeric;
  v_labor  := coalesce(nullif(p_cost ->> 'labor_cost', '')::numeric, 0);
  v_energy := coalesce(nullif(p_cost ->> 'energy_cost', '')::numeric, 0);

  if v_raw is not null then
    v_need_br := case when t.target_brutto_pct is not null and t.target_brutto_pct < 100
                      then v_raw / (1 - t.target_brutto_pct / 100) end;
    v_need_dg := case when t.target_dg2_pct is not null and t.target_dg2_pct < 100
                      then (v_raw + v_labor + v_energy) / (1 - t.target_dg2_pct / 100) end;
    needed_price := nullif(greatest(coalesce(v_need_br, 0), coalesce(v_need_dg, 0)), 0);
  end if;

  if not coalesce((p_cost ->> 'has_cost')::boolean, false) or v_raw is null then
    status := 'mangler_kalkyle'; needed_price := null;
  elsif p_calc_type = 'halvfabrikat' then
    status := 'halvfabrikat'; needed_price := null;
  elsif p_price is null or p_price <= 0 then
    status := 'ingen_pris';
  else
    brutto_pct := (p_price - v_raw) / p_price * 100;
    db2        := p_price - v_raw - v_labor - v_energy;
    dg2_pct    := db2 / p_price * 100;
    avvik_pp   := least(coalesce(brutto_pct - t.target_brutto_pct, 999),
                        coalesce(dg2_pct - t.target_dg2_pct, 999));
    if avvik_pp = 999 then avvik_pp := null; end if;
    status := case
      when (p_cost ->> 'quality') = 'C' then 'ikke_vurdert'
      when p_is_provisional            then 'forelopig'
      when avvik_pp is null            then 'uten_maal'
      when avvik_pp >= 0               then 'gronn'
      when avvik_pp >= -coalesce(t.warn_below_pp, 3) then 'gul'
      else 'rod' end;
  end if;
  return next;
end;
$function$
