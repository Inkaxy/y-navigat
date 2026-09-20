create or replace function public.rm_start_price_to_agreement(
  p_rms_id uuid,
  p_reason text,
  p_expected_start_price numeric default null,
  p_expected_unit_change_at timestamptz default null,
  p_expected_package_size numeric default null,
  p_expected_package_unit text default null,
  p_expected_base_units_per_package numeric default null,
  p_replace_existing boolean default false,
  p_valid_from date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s record;
  v_entity uuid;
  v_today date := (now() at time zone 'Europe/Oslo')::date;
  v_from date;
  v_to date;
  v_unit_change timestamptz;
begin
  if auth.uid() is null then raise exception 'Krever pålogging'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Begrunnelse er påkrevd'; end if;

  select rms.*, rm2.legal_entity_id, rm2.base_unit as current_base_unit into s
    from public.raw_material_suppliers rms
    join public.raw_materials rm2 on rm2.id = rms.raw_material_id
   where rms.id = p_rms_id
     for update of rms;
  if not found then raise exception 'Leverandørkoblingen finnes ikke'; end if;
  v_entity := s.legal_entity_id;
  if not public.has_ravarer_invoice_access(v_entity, 'approve') then
    raise exception 'Krever godkjennerrettighet for fakturaer i dette selskapet';
  end if;
  if s.start_price_per_base_unit is null then
    raise exception 'Det finnes ingen startpris å gjøre om til avtalepris';
  end if;

  -- 1) Startprisen må fortsatt være gyldig som grunnlag: samme grunnenhet,
  --    samme pakning som den ble bekreftet på, og NOK.
  if s.start_price_base_unit is distinct from s.current_base_unit then
    raise exception 'Grunnenheten er endret etter at startprisen ble bekreftet — startprisen må bekreftes på nytt';
  end if;
  if coalesce(s.start_price_currency, 'NOK') <> 'NOK' then
    raise exception 'Startprisen er i en annen valuta enn NOK og kan ikke bli avtalepris';
  end if;
  if s.start_price_package_size is distinct from s.package_size
     or s.start_price_package_unit is distinct from s.package_unit
     or s.start_price_base_units_per_package is distinct from s.base_units_per_package then
    raise exception 'Pakningen er endret etter at startprisen ble bekreftet — startprisen må bekreftes på nytt';
  end if;
  v_unit_change := public.rm_unit_change_at(s.raw_material_id);
  if s.start_price_unit_change_at is distinct from v_unit_change then
    raise exception 'Grunnenheten er endret etter at startprisen ble bekreftet — startprisen må bekreftes på nytt';
  end if;

  -- 2) Skjermbildet sender med det brukeren faktisk så. Er noe endret i
  --    mellomtiden, skal ikke en gammel visning kunne erstatte avtaleprisen.
  if p_expected_start_price is not null and s.start_price_per_base_unit <> p_expected_start_price then
    raise exception 'Startprisen er endret siden skjermbildet ble lastet — last inn på nytt';
  end if;
  if p_expected_unit_change_at is distinct from null
     and s.start_price_unit_change_at is distinct from p_expected_unit_change_at then
    raise exception 'Grunnlaget for startprisen er endret siden skjermbildet ble lastet — last inn på nytt';
  end if;
  if (p_expected_package_size is not null and s.package_size is distinct from p_expected_package_size)
     or (p_expected_package_unit is not null and s.package_unit is distinct from p_expected_package_unit)
     or (p_expected_base_units_per_package is not null
         and s.base_units_per_package is distinct from p_expected_base_units_per_package) then
    raise exception 'Pakningen er endret siden skjermbildet ble lastet — last inn på nytt';
  end if;

  -- 3) En eksisterende avtalepris erstattes bare når brukeren uttrykkelig sa det.
  if s.agreed_price_per_base_unit is not null and coalesce(p_replace_existing, false) = false then
    raise exception 'Leverandøren har allerede en avtalepris — bekreft uttrykkelig at den skal erstattes';
  end if;

  -- 4) Ny avtaleperiode. En ny pris skal ALDRI arve den gamle startdatoen:
  --    den ville gjort eldre fakturaer til avtalebrudd i ettertid.
  v_from := coalesce(p_valid_from, v_today);
  if v_from < v_today then
    raise exception 'Avtalen kan ikke gjelde fra en dato som er passert';
  end if;
  v_to := s.agreement_valid_to;
  if v_to is not null and v_to < v_today then
    v_to := null;  -- utløpt sluttdato ryddes bort
  end if;
  if v_to is not null and v_to < v_from then
    raise exception 'Avtalens sluttdato ligger før den nye startdatoen — rydd opp i avtaleperioden først';
  end if;

  update public.raw_material_suppliers
     set agreed_price_per_base_unit = s.start_price_per_base_unit,
         agreed_price_set_by = auth.uid(),
         agreed_price_set_at = now(),
         agreement_valid_from = v_from,
         agreement_valid_to = v_to,
         updated_at = now()
   where id = p_rms_id;

  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (auth.uid(), 'start_price_set_as_agreement', 'raw_material_supplier', p_rms_id, v_entity,
          jsonb_build_object(
            'old', jsonb_build_object('agreed_price_per_base_unit', s.agreed_price_per_base_unit,
                                      'agreement_valid_from', s.agreement_valid_from,
                                      'agreement_valid_to', s.agreement_valid_to),
            'new', jsonb_build_object('agreed_price_per_base_unit', s.start_price_per_base_unit,
                                      'agreement_valid_from', v_from,
                                      'agreement_valid_to', v_to,
                                      'replaced_existing', s.agreed_price_per_base_unit is not null,
                                      'from_start_price', true)),
          p_reason, 'fakturaer');

  return jsonb_build_object(
    'updated', true,
    'agreed_price_per_base_unit', s.start_price_per_base_unit,
    'agreement_valid_from', v_from,
    'agreement_valid_to', v_to,
    'replaced_existing', s.agreed_price_per_base_unit is not null
  );
end;
$function$;

revoke all on function public.rm_start_price_to_agreement(uuid, text, numeric, timestamptz, numeric, text, numeric, boolean, date) from public, anon;
grant execute on function public.rm_start_price_to_agreement(uuid, text, numeric, timestamptz, numeric, text, numeric, boolean, date) to authenticated, service_role;

drop function if exists public.rm_start_price_to_agreement(uuid, text);