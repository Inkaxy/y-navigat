CREATE OR REPLACE FUNCTION public.rm_infer_package(p_line_id uuid, p_base_unit text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l record; i record; v_base text; v_arith numeric; v_arith_ok boolean := false;
  v_desc jsonb; v_desc_bupp numeric; v_factor numeric; v_agrees boolean := false;
  v_suggested numeric; v_source text; v_expl text; v_rounded numeric; v_direct numeric;
  v_basis text; v_disc numeric; v_arith_note text; v_var_n int := 0; v_var_bupp numeric;
  v_basis_factor numeric; v_raw_basis numeric;
begin
  select il.*, rm.base_unit as rm_base_unit into l
    from public.invoice_lines il left join public.raw_materials rm on rm.id = il.raw_material_id
   where il.id = p_line_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'linjen_finnes_ikke');
  end if;
  select inv.legal_entity_id, inv.supplier_id into i from public.invoices inv where inv.id = l.invoice_id;
  if auth.uid() is not null and not public.has_ravarer_invoice_access(i.legal_entity_id, 'read') then
    raise exception 'Ingen fakturatilgang for dette selskapet';
  end if;
  v_base := lower(btrim(coalesce(p_base_unit, l.rm_base_unit, '')));
  v_basis := lower(btrim(coalesce(l.unit_price_basis, '')));
  v_disc := case when l.discount_amount is not null and l.discount_amount > 0 then l.discount_amount end;

  if v_base <> '' and l.unit is not null and v_base <> 'stk' then
    v_direct := public.rm_unit_factor(l.unit, v_base);
    if v_direct is not null then
      return jsonb_build_object(
        'ok', true, 'direct', true, 'base_unit', v_base, 'line_unit', l.unit, 'direct_factor', v_direct,
        'arithmetic', jsonb_build_object('bupp', null, 'raw', null, 'ok', false),
        'description', public.rm_parse_package_any(l.description),
        'agrees', false, 'suggested_bupp', null, 'source', null, 'auto_confirmable', false, 'variant', null,
        'explanation', format('Linjen er fakturert i %s, som regnes rett om til %s. Pakningen trengs ikke for å finne prisen per %s.', l.unit, v_base, v_base));
    end if;
  end if;

  if l.quantity is not null and l.unit_price is not null and l.total_amount is not null
     and l.quantity > 0 and l.unit_price > 0 and l.total_amount > 0 then
    if v_disc is not null and abs(l.quantity * l.unit_price - v_disc - l.total_amount) <= 0.015 * l.total_amount then
      v_arith_note := 'rabatt';
    elsif v_disc is not null then
      v_arith_note := 'rabatt_uavklart';
    elsif abs(l.quantity * l.unit_price - l.total_amount) > 0.015 * l.total_amount then
      v_basis_factor := case when v_base <> '' and v_basis <> '' then public.rm_unit_factor(v_basis, v_base) end;
      if v_basis_factor is not null and v_basis_factor > 0 then
        v_raw_basis := l.total_amount / (l.quantity * l.unit_price);
        v_rounded := round(v_raw_basis, 2);
        v_arith := v_raw_basis * v_basis_factor;
        if v_raw_basis >= 0.5 and abs(v_raw_basis - v_rounded) <= 0.003 * v_raw_basis then
          v_arith := v_rounded * v_basis_factor; v_arith_ok := true;
        end if;
      else
        v_arith := null;
        v_arith_note := 'prisgrunnlag_ukjent';
      end if;
    end if;
  end if;

  v_desc := public.rm_parse_package_any(l.description);
  if v_desc is not null and v_base <> '' then
    if v_base = 'stk' then
      v_desc_bupp := (v_desc->>'count')::numeric;
    else
      v_factor := public.rm_unit_factor(v_desc->>'unit', v_base);
      if v_factor is not null then v_desc_bupp := (v_desc->>'total')::numeric * v_factor; end if;
    end if;
    if v_desc_bupp is not null and v_desc_bupp <= 0 then v_desc_bupp := null; end if;
  end if;

  if l.raw_material_id is not null and l.unit is not null then
    select count(distinct p.base_units_per_package), min(p.base_units_per_package) into v_var_n, v_var_bupp
      from public.raw_material_supplier_packages p
      join public.raw_material_suppliers s on s.id = p.raw_material_supplier_id
     where s.raw_material_id = l.raw_material_id and s.supplier_id = i.supplier_id
       and p.superseded_at is null and p.confirmed_at is not null and p.base_units_per_package > 0
       and lower(btrim(coalesce(p.package_unit, ''))) = lower(btrim(l.unit))
       and coalesce(p.supplier_sku_norm, '') = coalesce(public.rm_sku_norm(l.supplier_sku), '');
  end if;

  if v_arith_ok and v_desc_bupp is not null then
    v_agrees := abs(v_arith - v_desc_bupp) <= 0.005 * greatest(v_arith, v_desc_bupp);
  end if;

  if v_var_n > 1 then
    v_source := null; v_suggested := null;
    v_expl := format('Leverandøren har flere ulike bekreftede pakninger for %s på dette varenummeret. Pakningen er ukjent til den er avklart.', l.unit);
  elsif v_var_n = 1 then
    v_suggested := v_var_bupp; v_source := 'bekreftet_pakning';
    v_expl := format('Bekreftet tidligere: én %s inneholder %s %s.', l.unit, v_var_bupp, coalesce(nullif(v_base,''),''));
  elsif v_arith_ok and v_agrees then
    v_suggested := v_arith; v_source := 'regnestykke_og_varenavn';
    v_expl := format('Prisen er oppgitt per %s: %s × %s kr = %s kr gir %s %s per %s. Varenavnet sier det samme.',
      v_basis, l.quantity, l.unit_price, l.total_amount, v_arith, v_base, coalesce(l.unit,'pakning'));
  elsif v_arith_ok then
    v_suggested := v_arith; v_source := 'regnestykke';
    v_expl := format('Prisen er oppgitt per %s: %s × %s kr = %s kr gir %s %s per %s.',
      v_basis, l.quantity, l.unit_price, l.total_amount, v_arith, v_base, coalesce(l.unit,'pakning'));
  elsif v_desc_bupp is not null then
    v_suggested := v_desc_bupp; v_source := 'varenavn';
    v_expl := format('Varenavnet «%s» tyder på %s %s per %s. Det er bare et forslag – bekreft mot fakturaen.',
      l.description, v_desc_bupp, coalesce(nullif(v_base,''),''), coalesce(l.unit,'pakning'));
  else
    v_source := null;
    v_expl := 'Fakturaen sier ikke hvor mye én pakning inneholder. Fyll inn innholdet selv.';
  end if;
  if v_arith_note = 'rabatt' then
    v_expl := v_expl || ' Summen forklares av trykt rabatt, ikke av pakningen.';
  elsif v_arith_note = 'rabatt_uavklart' then
    v_expl := v_expl || ' Rabatten forklarer ikke summen – kontroller regnestykket.';
  elsif v_arith_note = 'prisgrunnlag_ukjent' then
    v_expl := v_expl || ' Prisforskjellen alene sier ikke noe om pakningen når prisgrunnlaget ikke er dokumentert per grunnenhet.';
  end if;

  return jsonb_build_object(
    'ok', true, 'direct', false,
    'base_unit', nullif(v_base, ''),
    'line_unit', l.unit,
    'arithmetic', jsonb_build_object('bupp', case when v_arith_ok then v_arith end, 'raw', v_arith, 'ok', v_arith_ok, 'note', v_arith_note),
    'description', case when v_desc is null then null else v_desc || jsonb_build_object('bupp', v_desc_bupp) end,
    'agrees', v_agrees,
    'suggested_bupp', v_suggested,
    'source', v_source,
    'variant', case when v_var_n > 0 then jsonb_build_object('count', v_var_n, 'bupp', case when v_var_n = 1 then v_var_bupp end) end,
    'auto_confirmable', (v_arith_ok and v_agrees) or v_var_n = 1,
    'explanation', v_expl);
end;
$function$;