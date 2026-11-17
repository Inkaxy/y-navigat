CREATE OR REPLACE FUNCTION public.rm_lines_sum_check(p_sum numeric, p_count integer, p_total numeric, p_vat numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare v_exp numeric; v_tol numeric; v_var numeric; v_sum numeric;
begin
  if coalesce(p_count, 0) = 0 then
    return jsonb_build_object('lines_sum_excl_vat', null, 'lines_sum_variance_pct', null, 'lines_sum_status', 'no_lines');
  end if;
  v_sum := round(coalesce(p_sum, 0), 2);
  if p_total is null or not public.rm_is_finite(p_total) or p_total = 0 then
    return jsonb_build_object('lines_sum_excl_vat', v_sum, 'lines_sum_variance_pct', null, 'lines_sum_status', 'no_total');
  end if;
  if p_vat is not null and public.rm_is_finite(p_vat) then v_exp := p_total - p_vat; v_tol := 2; else v_exp := p_total; v_tol := 20; end if;
  if v_exp = 0 then
    return jsonb_build_object('lines_sum_excl_vat', v_sum, 'lines_sum_variance_pct', null, 'lines_sum_status', 'no_total');
  end if;
  v_var := round((v_sum - v_exp) / v_exp * 100, 3);
  return jsonb_build_object('lines_sum_excl_vat', v_sum, 'lines_sum_variance_pct', v_var,
    'lines_sum_status', case when abs(v_var) <= v_tol then 'ok' else 'mismatch' end);
end $function$

CREATE OR REPLACE FUNCTION public.rm_lines_sum_check(p_sum numeric, p_count integer, p_total numeric, p_vat numeric, p_is_credit boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare v_exp numeric; v_tol numeric; v_var numeric; v_sum numeric;
begin
  if not coalesce(p_is_credit, false) then
    return public.rm_lines_sum_check(p_sum, p_count, p_total, p_vat);
  end if;
  if coalesce(p_count, 0) = 0 then
    return jsonb_build_object('lines_sum_excl_vat', null, 'lines_sum_variance_pct', null, 'lines_sum_status', 'no_lines');
  end if;
  v_sum := round(coalesce(p_sum, 0), 2);
  if p_total is null or not public.rm_is_finite(p_total) or p_total = 0 then
    return jsonb_build_object('lines_sum_excl_vat', v_sum, 'lines_sum_variance_pct', null, 'lines_sum_status', 'no_total');
  end if;
  -- Kreditnota: mva følger totalens fortegn (total 3612 / -3612 med mva lagret som 471).
  if p_vat is not null and public.rm_is_finite(p_vat) then v_exp := p_total - sign(p_total) * abs(p_vat); v_tol := 2; else v_exp := p_total; v_tol := 20; end if;
  -- Motsatt fortegn mellom total og linjer er bare lagringsform på kreditnota; størrelsen kontrolleres som før.
  if v_sum <> 0 and v_exp <> 0 and sign(v_exp) <> sign(v_sum) then v_exp := -v_exp; end if;
  if v_exp = 0 then
    return jsonb_build_object('lines_sum_excl_vat', v_sum, 'lines_sum_variance_pct', null, 'lines_sum_status', 'no_total');
  end if;
  v_var := round((v_sum - v_exp) / v_exp * 100, 3);
  return jsonb_build_object('lines_sum_excl_vat', v_sum, 'lines_sum_variance_pct', v_var,
    'lines_sum_status', case when abs(v_var) <= v_tol then 'ok' else 'mismatch' end);
end $function$
