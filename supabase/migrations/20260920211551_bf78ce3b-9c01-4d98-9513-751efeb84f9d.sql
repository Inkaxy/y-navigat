-- Dimensjon for en enhetskode: masse, volum, antall (stk) eller pakning.
create or replace function public.rm_unit_dimension(p_unit text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  with u as (select lower(btrim(coalesce(p_unit, ''))) as u)
  select case
    when u.u = '' then null
    when u.u in ('mg','g','gr','grm','gram','hg','hekto','kg','kilo','kgm','kilogram','t','tonn','ton') then 'masse'
    when u.u in ('ml','mlt','milliliter','cl','clt','centiliter','dl','dlt','desiliter','deciliter',
                 'l','lt','ltr','liter','litre') then 'volum'
    when u.u in ('stk','stykk','st','pcs','pc','piece','pieces','ea','each','h87','c62','nar') then 'antall'
    when u.u in ('esk','eske','ks','ksk','krt','krg','kart','kartong','bx','box','carton','ct',
                 'pk','pak','pakke','pack','pos','pose','poser','sk','sekk','sekker','bag','bags','sack','sacks',
                 'fl','btl','flaske','bottle','rl','rull','roll','spn','spann','kanne','boks','can',
                 'brett','tray','pall','pallet','plt','palleboks','pallebox','konteiner','container','cont',
                 'glass','gl','beger','beg','tube','tb','bunt','bundle','par','pair','kolli','coli','bulk')
      then 'pakning'
    else null
  end
  from u;
$$;

-- Forventet mengde i varens grunnenhet, utledet fra enheten som står på linjen.
-- Pakningsfaktoren brukes KUN for ekte pakningsenheter (og stk mot en målt grunnenhet).
-- status: ok | dimensjon_avvik | ukjent_enhet | mangler_enhet | mangler_pakningsfaktor | ugyldig_mengde
create or replace function public.rm_expected_base_quantity(
  p_quantity numeric,
  p_unit text,
  p_base_unit text,
  p_base_units_per_package numeric
)
returns jsonb
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  v_u text := lower(btrim(coalesce(p_unit, '')));
  v_b text := lower(btrim(coalesce(p_base_unit, '')));
  v_ud text;
  v_bd text;
  v_factor numeric;
begin
  if p_quantity is null or not public.rm_is_finite(p_quantity) or p_quantity <= 0 then
    return jsonb_build_object('status', 'ugyldig_mengde', 'expected', null);
  end if;
  if v_b = '' then
    return jsonb_build_object('status', 'ukjent_enhet', 'expected', null);
  end if;
  if v_u = '' then
    return jsonb_build_object('status', 'mangler_enhet', 'expected', null);
  end if;

  v_ud := public.rm_unit_dimension(v_u);
  v_bd := public.rm_unit_dimension(v_b);
  if v_ud is null or v_bd is null then
    return jsonb_build_object('status', 'ukjent_enhet', 'expected', null);
  end if;

  -- Målt enhet mot målt grunnenhet: krev samme dimensjon og bruk faktisk omregning.
  if v_ud in ('masse', 'volum') or (v_ud = 'antall' and v_bd = 'antall') then
    if v_ud is distinct from v_bd then
      return jsonb_build_object('status', 'dimensjon_avvik', 'expected', null);
    end if;
    v_factor := public.rm_unit_factor(v_u, v_b);
    if v_factor is null or not public.rm_is_finite(v_factor) or v_factor <= 0 then
      return jsonb_build_object('status', 'ukjent_enhet', 'expected', null);
    end if;
    return jsonb_build_object('status', 'ok', 'expected', p_quantity * v_factor);
  end if;

  -- Pakningsenhet (eller stk mot en målt grunnenhet): krev bekreftet pakningsfaktor.
  if p_base_units_per_package is null
     or not public.rm_is_finite(p_base_units_per_package)
     or p_base_units_per_package <= 0 then
    return jsonb_build_object('status', 'mangler_pakningsfaktor', 'expected', null);
  end if;
  return jsonb_build_object('status', 'ok', 'expected', p_quantity * p_base_units_per_package);
end;
$$;

-- Stemmer lagret base_quantity med den utledede mengden?
create or replace function public.rm_base_quantity_matches(
  p_quantity numeric,
  p_unit text,
  p_base_unit text,
  p_base_units_per_package numeric,
  p_base_quantity numeric
)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  with e as (
    select public.rm_expected_base_quantity(p_quantity, p_unit, p_base_unit, p_base_units_per_package) as j
  )
  select case
    when p_base_quantity is null or not public.rm_is_finite(p_base_quantity) or p_base_quantity <= 0 then false
    when (e.j->>'status') <> 'ok' then false
    else abs(p_base_quantity - (e.j->>'expected')::numeric)
         <= greatest(0.001, (e.j->>'expected')::numeric * 0.005)
  end
  from e;
$$;

revoke all on function public.rm_unit_dimension(text) from public;
revoke all on function public.rm_expected_base_quantity(numeric, text, text, numeric) from public;
revoke all on function public.rm_base_quantity_matches(numeric, text, text, numeric, numeric) from public;
grant execute on function public.rm_unit_dimension(text) to authenticated, service_role;
grant execute on function public.rm_expected_base_quantity(numeric, text, text, numeric) to authenticated, service_role;
grant execute on function public.rm_base_quantity_matches(numeric, text, text, numeric, numeric) to authenticated, service_role;

-- Kvalifikasjonen bruker den nye enhetsbaserte utledningen.
create or replace function public.rm_start_price_eligibility(p_invoice_line_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  l record; i record; rm record; s record; sup record;
  v_reasons text[] := '{}';
  v_unit_at timestamptz;
  v_calc numeric;
  v_tol numeric;
  v_qty jsonb;
  v_status text;
  v_expected numeric;
begin
  if p_invoice_line_id is null then
    return jsonb_build_object('eligible', false, 'blockers', to_jsonb(array['mangler_linje']));
  end if;

  select il.* into l from public.invoice_lines il where il.id = p_invoice_line_id;
  if not found then
    return jsonb_build_object('eligible', false, 'blockers', to_jsonb(array['linjen_finnes_ikke']));
  end if;

  select inv.* into i from public.invoices inv where inv.id = l.invoice_id;
  if not found then
    return jsonb_build_object('eligible', false, 'blockers', to_jsonb(array['fakturaen_finnes_ikke']));
  end if;

  if l.raw_material_id is null then
    return jsonb_build_object('eligible', false, 'blockers', to_jsonb(array['linjen_er_ikke_koblet_til_vare']));
  end if;

  select r.* into rm from public.raw_materials r where r.id = l.raw_material_id;
  if not found then
    return jsonb_build_object('eligible', false, 'blockers', to_jsonb(array['varen_finnes_ikke']));
  end if;

  if rm.legal_entity_id is distinct from i.legal_entity_id then
    return jsonb_build_object('eligible', false, 'blockers', to_jsonb(array['faktura_og_vare_i_ulike_selskap']));
  end if;

  if i.supplier_id is not null then
    select sp.* into sup from public.suppliers sp where sp.id = i.supplier_id;
    if not found or sup.legal_entity_id is distinct from rm.legal_entity_id then
      return jsonb_build_object('eligible', false, 'blockers', to_jsonb(array['leverandor_i_annet_selskap']));
    end if;
  end if;

  if auth.uid() is not null and not public.has_ravarer_invoice_access(i.legal_entity_id, 'read') then
    raise exception 'Ingen fakturatilgang for dette selskapet';
  end if;

  if i.supplier_id is null then
    v_reasons := array_append(v_reasons, 'fakturaen_mangler_leverandor');
  end if;
  if i.flagged_at is not null then
    v_reasons := array_append(v_reasons, 'fakturaen_er_flagget');
  end if;
  if coalesce(i.is_credit_note, false) then
    v_reasons := array_append(v_reasons, 'kreditnota');
  end if;
  if upper(coalesce(i.currency, 'NOK')) <> 'NOK' then
    v_reasons := array_append(v_reasons, 'annen_valuta');
  end if;
  if i.invoice_date is null then
    v_reasons := array_append(v_reasons, 'fakturaen_mangler_dato');
  end if;
  if rm.base_unit is null or btrim(rm.base_unit) = '' then
    v_reasons := array_append(v_reasons, 'varen_mangler_grunnenhet');
  end if;
  if coalesce(l.requires_review, false) then
    v_reasons := array_append(v_reasons, 'linjen_star_til_gjennomgang');
  end if;
  if l.review_reason is not null and btrim(l.review_reason) <> '' then
    if coalesce(l.requires_review, false) then
      v_reasons := array_append(v_reasons, 'uavklart_gjennomgangsarsak');
    else
      v_reasons := array_append(v_reasons, 'inkonsistent_gjennomgangsstatus');
    end if;
  end if;
  if l.match_confidence is distinct from 'manual' then
    v_reasons := array_append(v_reasons, 'koblingen_er_ikke_manuelt_bekreftet');
  end if;
  if l.total_amount is null or not public.rm_is_finite(l.total_amount) or l.total_amount <= 0 then
    v_reasons := array_append(v_reasons, 'ugyldig_nettobelop');
  end if;
  if l.quantity is null or not public.rm_is_finite(l.quantity) or l.quantity <= 0 then
    v_reasons := array_append(v_reasons, 'ugyldig_mengde');
  end if;
  if l.base_quantity is null or not public.rm_is_finite(l.base_quantity) or l.base_quantity <= 0 then
    v_reasons := array_append(v_reasons, 'ukjent_mengde_i_grunnenhet');
  end if;
  if l.price_per_base_unit is null or not public.rm_is_finite(l.price_per_base_unit) or l.price_per_base_unit <= 0 then
    v_reasons := array_append(v_reasons, 'ugyldig_pris_per_grunnenhet');
  end if;

  if l.total_amount is not null and public.rm_is_finite(l.total_amount) and l.total_amount > 0
     and l.base_quantity is not null and public.rm_is_finite(l.base_quantity) and l.base_quantity > 0 then
    v_calc := l.total_amount / l.base_quantity;
    v_tol := greatest(0.01, v_calc * 0.005);
    if l.price_per_base_unit is null or abs(l.price_per_base_unit - v_calc) > v_tol then
      v_reasons := array_append(v_reasons, 'utdaterte_beregnede_verdier');
    end if;
  end if;

  select rms.* into s
    from public.raw_material_suppliers rms
   where rms.raw_material_id = l.raw_material_id
     and rms.supplier_id = i.supplier_id;

  if not found then
    v_reasons := array_append(v_reasons, 'mangler_leverandorkobling');
  else
    if s.package_confirmed_at is null
       or s.base_units_per_package is null
       or s.base_units_per_package <= 0 then
      v_reasons := array_append(v_reasons, 'ukjent_pakning');
    end if;

    if l.quantity is not null and public.rm_is_finite(l.quantity) and l.quantity > 0
       and l.base_quantity is not null and public.rm_is_finite(l.base_quantity) and l.base_quantity > 0 then
      v_qty := public.rm_expected_base_quantity(
        l.quantity,
        l.unit,
        rm.base_unit,
        case when s.package_confirmed_at is not null then s.base_units_per_package else null end);
      v_status := v_qty->>'status';
      v_expected := nullif(v_qty->>'expected', '')::numeric;
      if v_status = 'ok' then
        if abs(l.base_quantity - v_expected) > greatest(0.001, v_expected * 0.005) then
          v_reasons := array_append(v_reasons, 'mengden_stemmer_ikke_med_pakningen');
        end if;
      elsif v_status = 'dimensjon_avvik' then
        v_reasons := array_append(v_reasons, 'enhet_passer_ikke_med_grunnenheten');
      elsif v_status in ('ukjent_enhet', 'mangler_enhet') then
        v_reasons := array_append(v_reasons, 'ukjent_enhet_pa_linjen');
      elsif v_status = 'mangler_pakningsfaktor'
            and not ('ukjent_pakning' = any (v_reasons)) then
        v_reasons := array_append(v_reasons, 'ukjent_pakning');
      end if;
    end if;

    if s.start_price_per_base_unit is not null then
      v_reasons := array_append(v_reasons, 'startpris_finnes_allerede');
    end if;
  end if;

  v_unit_at := public.rm_unit_change_at(l.raw_material_id);
  if v_unit_at is not null then
    if l.created_at is null or l.created_at < v_unit_at then
      v_reasons := array_append(v_reasons, 'enhet_endret_etter_fakturalinjen');
    end if;
    if s.id is not null and (s.package_confirmed_at is null or s.package_confirmed_at < v_unit_at) then
      v_reasons := array_append(v_reasons, 'pakning_ikke_bekreftet_etter_enhetsendring');
    end if;
  end if;

  return jsonb_build_object(
    'eligible', array_length(v_reasons, 1) is null,
    'blockers', to_jsonb(coalesce(v_reasons, '{}'::text[])),
    'raw_material_supplier_id', s.id,
    'raw_material_id', l.raw_material_id,
    'supplier_id', i.supplier_id,
    'legal_entity_id', i.legal_entity_id,
    'invoice_id', i.id,
    'invoice_number', i.invoice_number,
    'invoice_date', i.invoice_date,
    'price_per_base_unit', v_calc,
    'stored_price_per_base_unit', l.price_per_base_unit,
    'base_quantity', l.base_quantity,
    'expected_base_quantity', v_expected,
    'line_unit', l.unit,
    'total_amount', l.total_amount,
    'currency', upper(coalesce(i.currency, 'NOK')),
    'base_unit', rm.base_unit,
    'base_units_per_package', s.base_units_per_package,
    'package_size', s.package_size,
    'package_unit', s.package_unit,
    'unit_change_at', v_unit_at,
    'existing_start_price', s.start_price_per_base_unit
  );
end;
$function$;

-- Forslagslisten bruker samme utledning.
create or replace function public.rm_start_price_candidates(
  p_legal_entity_id uuid,
  p_supplier_id uuid default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_rows jsonb;
begin
  if p_legal_entity_id is null then
    raise exception 'Selskap mangler';
  end if;
  if auth.uid() is null then
    raise exception 'Krever pålogging';
  end if;
  if not public.has_ravarer_invoice_access(p_legal_entity_id, 'read') then
    raise exception 'Ingen fakturatilgang for dette selskapet';
  end if;

  select coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) into v_rows
  from (
    select distinct on (rms.id)
      rms.id                      as raw_material_supplier_id,
      rms.raw_material_id,
      rm.name                     as raw_material_name,
      rm.base_unit,
      rms.supplier_id,
      sup.name                    as supplier_name,
      il.id                       as invoice_line_id,
      il.description,
      (il.total_amount / il.base_quantity) as price_per_base_unit,
      il.base_quantity,
      il.total_amount,
      inv.id                      as invoice_id,
      inv.invoice_number,
      inv.invoice_date,
      upper(coalesce(inv.currency, 'NOK')) as currency
    from public.raw_material_suppliers rms
    join public.raw_materials rm on rm.id = rms.raw_material_id
    join public.suppliers sup on sup.id = rms.supplier_id
    join public.invoice_lines il on il.raw_material_id = rms.raw_material_id
    join public.invoices inv on inv.id = il.invoice_id and inv.supplier_id = rms.supplier_id
    where rm.legal_entity_id = p_legal_entity_id
      and sup.legal_entity_id = p_legal_entity_id
      and inv.legal_entity_id = p_legal_entity_id
      and (p_supplier_id is null or rms.supplier_id = p_supplier_id)
      and rms.start_price_per_base_unit is null
      and rms.package_confirmed_at is not null
      and rms.base_units_per_package is not null
      and rms.base_units_per_package > 0
      and rm.base_unit is not null
      and btrim(rm.base_unit) <> ''
      and inv.flagged_at is null
      and coalesce(inv.is_credit_note, false) = false
      and upper(coalesce(inv.currency, 'NOK')) = 'NOK'
      and inv.invoice_date is not null
      and il.match_confidence = 'manual'
      and coalesce(il.requires_review, false) = false
      and (il.review_reason is null or btrim(il.review_reason) = '')
      and il.price_per_base_unit is not null
      and public.rm_is_finite(il.price_per_base_unit)
      and il.price_per_base_unit > 0
      and il.base_quantity is not null
      and public.rm_is_finite(il.base_quantity)
      and il.base_quantity > 0
      and il.quantity is not null
      and il.quantity > 0
      and il.total_amount is not null
      and public.rm_is_finite(il.total_amount)
      and il.total_amount > 0
      and abs(il.price_per_base_unit - il.total_amount / il.base_quantity)
          <= greatest(0.01, (il.total_amount / il.base_quantity) * 0.005)
      and public.rm_base_quantity_matches(il.quantity, il.unit, rm.base_unit,
                                          rms.base_units_per_package, il.base_quantity)
      and (public.rm_unit_change_at(rms.raw_material_id) is null
           or (il.created_at >= public.rm_unit_change_at(rms.raw_material_id)
               and rms.package_confirmed_at >= public.rm_unit_change_at(rms.raw_material_id)))
    order by rms.id, inv.invoice_date asc, il.created_at asc, il.id asc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) c;

  return v_rows;
end;
$function$;