-- Startpris: seks funn fra uavhengig testing + tre tilleggsfunn.
alter table public.raw_material_suppliers
  add column if not exists start_price_unit_change_at timestamptz;

create or replace function public.rm_guard_start_price_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('app.rm_start_price_rpc', true), '') = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.start_price_per_base_unit is not null
       or new.start_price_invoice_line_id is not null
       or new.start_price_confirmed_at is not null then
      raise exception 'Startpris kan bare settes gjennom bekreftelsesflyten';
    end if;
    return new;
  end if;

  if (new.start_price_per_base_unit, new.start_price_currency, new.start_price_base_unit,
      new.start_price_base_units_per_package, new.start_price_package_size, new.start_price_package_unit,
      new.start_price_invoice_id, new.start_price_invoice_line_id, new.start_price_effective_date,
      new.start_price_confirmed_by, new.start_price_confirmed_at, new.start_price_unit_change_at)
     is distinct from
     (old.start_price_per_base_unit, old.start_price_currency, old.start_price_base_unit,
      old.start_price_base_units_per_package, old.start_price_package_size, old.start_price_package_unit,
      old.start_price_invoice_id, old.start_price_invoice_line_id, old.start_price_effective_date,
      old.start_price_confirmed_by, old.start_price_confirmed_at, old.start_price_unit_change_at) then
    raise exception 'Startpris kan bare endres gjennom bekreftelses- eller endringsflyten';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_rm_guard_start_price on public.raw_material_suppliers;
create trigger trg_rm_guard_start_price
before insert or update on public.raw_material_suppliers
for each row execute function public.rm_guard_start_price_columns();

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
    else
      if l.quantity is not null and l.quantity > 0
         and l.base_quantity is not null and l.base_quantity > 0
         and abs(l.base_quantity - l.quantity * s.base_units_per_package)
             > greatest(0.001, l.quantity * s.base_units_per_package * 0.005)
         and abs(l.base_quantity - l.quantity) > greatest(0.001, l.quantity * 0.005) then
        v_reasons := array_append(v_reasons, 'mengden_stemmer_ikke_med_pakningen');
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

revoke all on function public.rm_start_price_eligibility(uuid) from public, anon;
grant execute on function public.rm_start_price_eligibility(uuid) to authenticated, service_role;

create or replace function public.rm_confirm_start_price(
  p_invoice_line_id uuid,
  p_expected_price numeric default null
)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
declare
  v_check jsonb;
  v_rms_id uuid;
  v_entity uuid;
  v_price numeric;
  v_unit_at timestamptz;
  s record;
  l record;
  i record;
  rm record;
begin
  if auth.uid() is null then
    raise exception 'Krever pålogging';
  end if;

  v_check := public.rm_start_price_eligibility(p_invoice_line_id);
  v_entity := (v_check->>'legal_entity_id')::uuid;
  if v_entity is null then
    return jsonb_build_object('created', false, 'reason', 'ugyldig_linje', 'check', v_check);
  end if;
  if not public.has_ravarer_invoice_access(v_entity, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer for dette selskapet';
  end if;

  v_rms_id := (v_check->>'raw_material_supplier_id')::uuid;
  if v_rms_id is null then
    return jsonb_build_object('created', false, 'reason', 'mangler_leverandorkobling', 'check', v_check);
  end if;

  select * into s from public.raw_material_suppliers where id = v_rms_id for update;
  select il.* into l from public.invoice_lines il where il.id = p_invoice_line_id for update;
  if not found then
    return jsonb_build_object('created', false, 'reason', 'linjen_finnes_ikke');
  end if;
  select inv.* into i from public.invoices inv where inv.id = l.invoice_id for share;
  select r.* into rm from public.raw_materials r where r.id = l.raw_material_id for share;

  if s.start_price_per_base_unit is not null then
    return jsonb_build_object(
      'created', false,
      'reason', case when s.start_price_invoice_line_id = p_invoice_line_id
                     then 'allerede_bekreftet_fra_denne_linjen' else 'startpris_finnes_allerede' end,
      'start_price', s.start_price_per_base_unit,
      'start_price_effective_date', s.start_price_effective_date,
      'raw_material_supplier_id', v_rms_id);
  end if;

  v_check := public.rm_start_price_eligibility(p_invoice_line_id);
  if (v_check->>'eligible')::boolean is distinct from true then
    return jsonb_build_object('created', false, 'reason', 'ikke_kvalifisert', 'check', v_check);
  end if;
  if (v_check->>'raw_material_supplier_id')::uuid is distinct from v_rms_id then
    return jsonb_build_object('created', false, 'reason', 'kilden_er_endret', 'check', v_check);
  end if;

  v_price := (v_check->>'price_per_base_unit')::numeric;
  if v_price is null or not public.rm_is_finite(v_price) or v_price <= 0 then
    return jsonb_build_object('created', false, 'reason', 'ugyldig_pris_per_grunnenhet', 'check', v_check);
  end if;

  if p_expected_price is not null
     and round(v_price, 6) <> round(p_expected_price, 6) then
    return jsonb_build_object('created', false, 'reason', 'utdatert_forslag', 'check', v_check);
  end if;

  v_unit_at := public.rm_unit_change_at(l.raw_material_id);

  perform set_config('app.rm_start_price_rpc', '1', true);

  update public.raw_material_suppliers
     set start_price_per_base_unit = v_price,
         start_price_currency = upper(coalesce(i.currency, 'NOK')),
         start_price_base_unit = rm.base_unit,
         start_price_base_units_per_package = s.base_units_per_package,
         start_price_package_size = s.package_size,
         start_price_package_unit = s.package_unit,
         start_price_invoice_id = i.id,
         start_price_invoice_line_id = l.id,
         start_price_effective_date = i.invoice_date,
         start_price_unit_change_at = v_unit_at,
         start_price_confirmed_by = auth.uid(),
         start_price_confirmed_at = now(),
         updated_at = now()
   where id = v_rms_id;

  perform set_config('app.rm_start_price_rpc', '0', true);

  insert into public.audit_log (user_id, action, entity_type, entity_id, entity_display_reference,
                                legal_entity_id, changes, reason, source_app)
  values (auth.uid(), 'start_price_confirmed', 'raw_material_supplier', v_rms_id,
          coalesce(rm.name, '') || ' / ' || coalesce(i.invoice_number, ''),
          v_entity,
          jsonb_build_object(
            'old', jsonb_build_object('start_price_per_base_unit', null),
            'new', jsonb_build_object(
              'start_price_per_base_unit', v_price,
              'currency', upper(coalesce(i.currency, 'NOK')),
              'base_unit', rm.base_unit,
              'base_units_per_package', s.base_units_per_package,
              'package_size', s.package_size,
              'package_unit', s.package_unit,
              'invoice_id', i.id,
              'invoice_line_id', l.id,
              'unit_change_at', v_unit_at,
              'effective_date', i.invoice_date)),
          'Bekreftet startpris fra fakturalinje', 'fakturaer');

  return jsonb_build_object(
    'created', true,
    'raw_material_supplier_id', v_rms_id,
    'start_price', v_price,
    'currency', upper(coalesce(i.currency, 'NOK')),
    'base_unit', rm.base_unit,
    'start_price_effective_date', i.invoice_date);
end;
$function$;

revoke all on function public.rm_confirm_start_price(uuid, numeric) from public, anon;
grant execute on function public.rm_confirm_start_price(uuid, numeric) to authenticated, service_role;

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
      and (abs(il.base_quantity - il.quantity * rms.base_units_per_package)
             <= greatest(0.001, il.quantity * rms.base_units_per_package * 0.005)
           or abs(il.base_quantity - il.quantity) <= greatest(0.001, il.quantity * 0.005))
      and (public.rm_unit_change_at(rms.raw_material_id) is null
           or (il.created_at >= public.rm_unit_change_at(rms.raw_material_id)
               and rms.package_confirmed_at >= public.rm_unit_change_at(rms.raw_material_id)))
    order by rms.id, inv.invoice_date asc, il.created_at asc, il.id asc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) c;

  return v_rows;
end;
$function$;

revoke all on function public.rm_start_price_candidates(uuid, uuid, integer) from public, anon;
grant execute on function public.rm_start_price_candidates(uuid, uuid, integer) to authenticated, service_role;

create or replace function public.rm_clear_start_price(p_rms_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
declare s record; v_entity uuid; v_old jsonb;
begin
  if auth.uid() is null then raise exception 'Krever pålogging'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Begrunnelse er påkrevd'; end if;

  select rms.*, rm.legal_entity_id into s
    from public.raw_material_suppliers rms
    join public.raw_materials rm on rm.id = rms.raw_material_id
   where rms.id = p_rms_id
     for update of rms;
  if not found then raise exception 'Leverandørkoblingen finnes ikke'; end if;
  v_entity := s.legal_entity_id;
  if not public.has_ravarer_invoice_access(v_entity, 'approve') then
    raise exception 'Krever godkjennerrettighet for fakturaer i dette selskapet';
  end if;
  if s.start_price_per_base_unit is null then
    return jsonb_build_object('cleared', false, 'reason', 'ingen_startpris');
  end if;

  v_old := jsonb_build_object(
    'start_price_per_base_unit', s.start_price_per_base_unit,
    'currency', s.start_price_currency,
    'base_unit', s.start_price_base_unit,
    'effective_date', s.start_price_effective_date,
    'invoice_line_id', s.start_price_invoice_line_id);

  perform set_config('app.rm_start_price_rpc', '1', true);

  update public.raw_material_suppliers
     set start_price_per_base_unit = null,
         start_price_currency = null,
         start_price_base_unit = null,
         start_price_base_units_per_package = null,
         start_price_package_size = null,
         start_price_package_unit = null,
         start_price_invoice_id = null,
         start_price_invoice_line_id = null,
         start_price_effective_date = null,
         start_price_unit_change_at = null,
         start_price_confirmed_by = null,
         start_price_confirmed_at = null,
         updated_at = now()
   where id = p_rms_id;

  perform set_config('app.rm_start_price_rpc', '0', true);

  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (auth.uid(), 'start_price_cleared', 'raw_material_supplier', p_rms_id, v_entity,
          jsonb_build_object('old', v_old, 'new', jsonb_build_object('start_price_per_base_unit', null)),
          p_reason, 'fakturaer');

  return jsonb_build_object('cleared', true);
end;
$function$;

revoke all on function public.rm_clear_start_price(uuid, text) from public, anon;
grant execute on function public.rm_clear_start_price(uuid, text) to authenticated, service_role;

create or replace function public.rm_price_reference(p_raw_material_id uuid, p_supplier_id uuid, p_invoice_id uuid, p_invoice_date date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_first  record;
  v_second record;
  v_hist   record;
  v_start  record;
  v_entity uuid;
  v_inv    record;
  v_cutoff date;
  v_cutoff_ts timestamptz;
  v_base_unit text;
begin
  if p_raw_material_id is null or p_supplier_id is null or p_invoice_date is null then
    return jsonb_build_object('source', 'none', 'reason', 'mangler_vare_leverandor_eller_dato');
  end if;

  select rm.legal_entity_id, rm.base_unit into v_entity, v_base_unit
    from public.raw_materials rm
   where rm.id = p_raw_material_id;
  if v_entity is null then
    raise exception 'Råvaren finnes ikke';
  end if;

  if p_invoice_id is not null then
    select i.legal_entity_id, i.supplier_id into v_inv
      from public.invoices i
     where i.id = p_invoice_id;
    if not found then
      raise exception 'Fakturaen finnes ikke';
    end if;
    if v_inv.legal_entity_id is distinct from v_entity then
      raise exception 'Faktura og råvare tilhører ulike selskap';
    end if;
    if v_inv.supplier_id is distinct from p_supplier_id then
      raise exception 'Leverandøren stemmer ikke med fakturaen';
    end if;
  end if;

  if auth.uid() is not null and not public.has_ravarer_invoice_access(v_entity, 'read') then
    raise exception 'Ingen fakturatilgang for dette selskapet';
  end if;

  select s.id, s.agreed_price_per_base_unit as price, s.agreement_priority,
         s.agreement_valid_from, s.agreement_valid_to
    into v_first
    from public.raw_material_suppliers s
   where s.raw_material_id = p_raw_material_id
     and s.supplier_id     = p_supplier_id
     and s.agreed_price_per_base_unit is not null
     and public.rm_is_finite(s.agreed_price_per_base_unit)
     and s.agreed_price_per_base_unit >= 0
     and coalesce(s.agreement_valid_from, '-infinity'::date) <= p_invoice_date
     and coalesce(s.agreement_valid_to,   'infinity'::date)  >= p_invoice_date
   order by s.agreement_priority asc,
            coalesce(s.agreement_valid_from, '-infinity'::date) desc,
            s.id
   limit 1;

  if found then
    select s.id
      into v_second
      from public.raw_material_suppliers s
     where s.raw_material_id = p_raw_material_id
       and s.supplier_id     = p_supplier_id
       and s.id <> v_first.id
       and s.agreed_price_per_base_unit is not null
       and coalesce(s.agreement_valid_from, '-infinity'::date) <= p_invoice_date
       and coalesce(s.agreement_valid_to,   'infinity'::date)  >= p_invoice_date
       and s.agreement_priority = v_first.agreement_priority
       and coalesce(s.agreement_valid_from, '-infinity'::date)
           = coalesce(v_first.agreement_valid_from, '-infinity'::date)
       and s.agreed_price_per_base_unit <> v_first.price
     limit 1;

    if found then
      return jsonb_build_object(
        'source', 'conflict',
        'reason', 'to_likestilte_avtaler_med_ulik_pris',
        'reference_id', v_first.id);
    end if;

    return jsonb_build_object(
      'source', 'agreement',
      'price', v_first.price,
      'reference_id', v_first.id,
      'reference_date', v_first.agreement_valid_from,
      'valid_to', v_first.agreement_valid_to);
  end if;

  select s.id, s.start_price_per_base_unit as price, s.start_price_effective_date as eff,
         s.start_price_invoice_id as invoice_id
    into v_start
    from public.raw_material_suppliers s
   where s.raw_material_id = p_raw_material_id
     and s.supplier_id     = p_supplier_id
     and s.start_price_per_base_unit is not null
     and public.rm_is_finite(s.start_price_per_base_unit)
     and s.start_price_per_base_unit > 0
     and s.start_price_effective_date is not null
     and s.start_price_effective_date <= p_invoice_date
     and upper(coalesce(s.start_price_currency, 'NOK')) = 'NOK'
     and s.start_price_base_unit is not distinct from v_base_unit
     and s.start_price_base_units_per_package is not distinct from s.base_units_per_package
     and s.start_price_package_size is not distinct from s.package_size
     and s.start_price_package_unit is not distinct from s.package_unit
     and s.start_price_unit_change_at is not distinct from public.rm_unit_change_at(p_raw_material_id)
   limit 1;

  if found then
    return jsonb_build_object(
      'source', 'start_price',
      'price', v_start.price,
      'reference_id', v_start.id,
      'reference_date', v_start.eff,
      'invoice_id', v_start.invoice_id);
  end if;

  v_cutoff := public.rm_unit_change_cutoff(p_raw_material_id);
  v_cutoff_ts := public.rm_unit_change_at(p_raw_material_id);

  select h.id, h.price, h.effective_date, h.invoice_id
    into v_hist
    from public.raw_material_price_history h
   where h.raw_material_id = p_raw_material_id
     and h.supplier_id     = p_supplier_id
     and h.source          = 'invoice'
     and upper(coalesce(h.currency, 'NOK')) = 'NOK'
     and coalesce(h.is_credit, false)  = false
     and coalesce(h.is_legacy, false)  = false
     and h.superseded_at is null
     and h.price is not null
     and public.rm_is_finite(h.price)
     and h.price >= 0
     and h.effective_date < p_invoice_date
     and h.effective_date >= coalesce(v_cutoff, '-infinity'::date)
     and (v_cutoff_ts is null or h.created_at >= v_cutoff_ts)
     and (p_invoice_id is null or h.invoice_id is distinct from p_invoice_id)
   order by h.effective_date desc, h.created_at desc, h.id desc
   limit 1;

  if found then
    return jsonb_build_object(
      'source', 'last_purchase',
      'price', v_hist.price,
      'reference_id', v_hist.id,
      'reference_date', v_hist.effective_date,
      'invoice_id', v_hist.invoice_id);
  end if;

  if v_cutoff is not null then
    return jsonb_build_object('source', 'none', 'reason', 'ingen_sammenlignbare_kjop_etter_enhetsendring');
  end if;

  return jsonb_build_object('source', 'none', 'reason', 'ingen_avtale_eller_tidligere_kjop');
end;
$function$;

revoke all on function public.rm_price_reference(uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.rm_price_reference(uuid, uuid, uuid, date) to service_role;