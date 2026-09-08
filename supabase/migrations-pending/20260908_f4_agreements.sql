-- F4 — Avtaler: gyldighet, prioritet, dokument og atomisk anvendelse.
--
-- Rulles ut manuelt (ikke kjørt av agenten), ETTER F2 (bruker rm_is_finite og
-- kolonnene is_legacy/superseded_at på raw_material_price_history).
--
-- Problemet i dag: avtalen lagres med flere separate klientkall (upsert på
-- raw_material_suppliers, nullstilling av is_primary på de andre, oppdatering av
-- primary_supplier_id). Feiler ett av dem, står råvaren igjen med to primære
-- leverandører eller peker på feil. RPC-en her gjør alt i én transaksjon, og
-- avviser ugyldige datoer, priser og selskapsblanding.

begin;

-- 1) Prioritet: hvilken avtale gjelder når flere overlapper? -----------------
-- Lavest tall = høyest prioritet. Primærleverandøren vinner alltid.
alter table public.raw_material_suppliers
  add column if not exists agreement_priority integer not null default 100;

comment on column public.raw_material_suppliers.agreement_priority is
  'Lavere tall vinner når flere avtaler er gyldige samtidig. Primærleverandør vinner uansett.';

create index if not exists ix_rms_agreement_validity
  on public.raw_material_suppliers (raw_material_id, agreement_valid_from, agreement_valid_to);

-- 2) Gyldig avtale på en gitt dato -------------------------------------------
create or replace function public.rm_effective_agreement(
  p_raw_material_id uuid,
  p_on_date date default current_date
)
returns table (
  supplier_id uuid,
  agreed_price numeric,
  agreed_price_per_base_unit numeric,
  package_size numeric,
  package_unit text,
  agreement_valid_from date,
  agreement_valid_to date,
  agreement_document_url text,
  is_primary boolean,
  agreement_priority integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.supplier_id, s.agreed_price, s.agreed_price_per_base_unit,
         s.package_size, s.package_unit, s.agreement_valid_from, s.agreement_valid_to,
         s.agreement_document_url, s.is_primary, s.agreement_priority
    from public.raw_material_suppliers s
    join public.raw_materials rm on rm.id = s.raw_material_id
   where s.raw_material_id = p_raw_material_id
     and public.has_position_in_entity(rm.legal_entity_id)
     and coalesce(s.agreement_valid_from, '-infinity'::date) <= p_on_date
     and coalesce(s.agreement_valid_to, 'infinity'::date) >= p_on_date
     and s.agreed_price_per_base_unit is not null
   order by s.is_primary desc, s.agreement_priority asc,
            coalesce(s.agreement_valid_from, '-infinity'::date) desc
   limit 1;
$function$;

-- 3) Atomisk lagring av en avtale --------------------------------------------
create or replace function public.rm_apply_agreement(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rm raw_materials%rowtype;
  v_rm_id uuid := nullif(p_payload->>'raw_material_id', '')::uuid;
  v_sup_id uuid := nullif(p_payload->>'supplier_id', '')::uuid;
  v_price numeric := nullif(p_payload->>'agreed_price', '')::numeric;
  v_ppbu numeric := nullif(p_payload->>'agreed_price_per_base_unit', '')::numeric;
  v_pkg numeric := nullif(p_payload->>'package_size', '')::numeric;
  v_from date := nullif(p_payload->>'agreement_valid_from', '')::date;
  v_to date := nullif(p_payload->>'agreement_valid_to', '')::date;
  v_primary boolean := coalesce((p_payload->>'is_primary')::boolean, false);
  v_priority integer := coalesce(nullif(p_payload->>'agreement_priority', '')::integer, 100);
  v_doc text := nullif(p_payload->>'agreement_document_url', '');
  v_link_id uuid;
  v_sup_entity uuid;
begin
  if v_uid is null then
    raise exception 'Du må være innlogget for å lagre en avtale' using errcode = '28000';
  end if;
  if v_rm_id is null or v_sup_id is null then
    raise exception 'Avtalen mangler råvare eller leverandør';
  end if;

  -- Fast låserekkefølge: råvare før koblingsrad.
  select * into v_rm from public.raw_materials where id = v_rm_id for update;
  if not found then raise exception 'Råvaren finnes ikke' using errcode = 'P0002'; end if;

  if not (public.has_position_in_entity(v_rm.legal_entity_id)
          and public.has_app_write_access('ravarer')) then
    raise exception 'Mangler skrivetilgang til råvarer i dette selskapet' using errcode = '42501';
  end if;

  select legal_entity_id into v_sup_entity from public.suppliers where id = v_sup_id;
  if v_sup_entity is null then
    raise exception 'Leverandøren finnes ikke' using errcode = 'P0002';
  end if;
  if v_sup_entity <> v_rm.legal_entity_id then
    raise exception 'Leverandøren tilhører et annet selskap' using errcode = '42501';
  end if;

  if v_from is not null and v_to is not null and v_to < v_from then
    raise exception 'Avtalen kan ikke slutte før den starter';
  end if;
  if v_price is not null and (not public.rm_is_finite(v_price) or v_price < 0) then
    raise exception 'Ugyldig avtalepris';
  end if;
  if v_ppbu is not null and (not public.rm_is_finite(v_ppbu) or v_ppbu < 0) then
    raise exception 'Ugyldig pris per grunnenhet';
  end if;
  if v_pkg is not null and (not public.rm_is_finite(v_pkg) or v_pkg <= 0) then
    raise exception 'Ugyldig pakningsstørrelse';
  end if;
  -- Én kontrakt: har vi pakningspris og pakningsstørrelse, skal prisen per
  -- grunnenhet være avledet av dem, ikke et løsrevet tall.
  if v_ppbu is null and v_price is not null and v_pkg is not null then
    v_ppbu := v_price / v_pkg;
  elsif v_price is null and v_ppbu is not null and v_pkg is not null then
    v_price := v_ppbu * v_pkg;
  end if;

  insert into public.raw_material_suppliers as s (
    raw_material_id, supplier_id, supplier_sku, supplier_product_name,
    agreed_price, agreed_price_per_base_unit, package_size, package_unit,
    agreement_valid_from, agreement_valid_to, agreement_priority,
    agreement_document_url, is_primary, agreed_price_set_at, agreed_price_set_by
  )
  values (
    v_rm_id, v_sup_id, nullif(p_payload->>'supplier_sku', ''),
    nullif(p_payload->>'supplier_product_name', ''),
    v_price, v_ppbu, v_pkg, nullif(p_payload->>'package_unit', ''),
    v_from, v_to, v_priority, v_doc, v_primary,
    case when v_ppbu is null and v_price is null then null else now() end,
    case when v_ppbu is null and v_price is null then null else v_uid end
  )
  on conflict (raw_material_id, supplier_id) do update
    set supplier_sku = coalesce(excluded.supplier_sku, s.supplier_sku),
        supplier_product_name = coalesce(excluded.supplier_product_name, s.supplier_product_name),
        agreed_price = excluded.agreed_price,
        agreed_price_per_base_unit = excluded.agreed_price_per_base_unit,
        package_size = coalesce(excluded.package_size, s.package_size),
        package_unit = coalesce(excluded.package_unit, s.package_unit),
        agreement_valid_from = excluded.agreement_valid_from,
        agreement_valid_to = excluded.agreement_valid_to,
        agreement_priority = excluded.agreement_priority,
        -- Et nytt dokument erstatter, men mangler det, beholdes det gamle.
        agreement_document_url = coalesce(excluded.agreement_document_url, s.agreement_document_url),
        is_primary = excluded.is_primary,
        agreed_price_set_at = coalesce(excluded.agreed_price_set_at, s.agreed_price_set_at),
        agreed_price_set_by = coalesce(excluded.agreed_price_set_by, s.agreed_price_set_by)
  returning s.id into v_link_id;

  -- Én primær leverandør — samme transaksjon, så råvaren aldri står med to.
  if v_primary then
    update public.raw_material_suppliers
       set is_primary = false
     where raw_material_id = v_rm_id and id <> v_link_id and is_primary;
    update public.raw_materials
       set primary_supplier_id = v_sup_id
     where id = v_rm_id;
  elsif v_rm.primary_supplier_id = v_sup_id then
    -- Avtalen ble fratatt primærstatus: råvaren skal ikke peke på den lenger.
    update public.raw_materials set primary_supplier_id = null where id = v_rm_id;
  end if;

  -- Avtalen er en prishendelse, men aldri en registrert kostpris i seg selv:
  -- kostprisen kommer fra faktisk fakturert pris.
  if v_ppbu is not null then
    insert into public.raw_material_price_history
      (raw_material_id, supplier_id, price, source, effective_date, source_reference, notes, created_by)
    values (v_rm_id, v_sup_id, v_ppbu, 'agreement', coalesce(v_from, current_date),
            v_link_id::text, 'Avtalt pris per grunnenhet', v_uid);
  end if;

  return jsonb_build_object('ok', true, 'link_id', v_link_id,
                            'agreed_price', v_price,
                            'agreed_price_per_base_unit', v_ppbu,
                            'is_primary', v_primary);
end;
$function$;

revoke all on function public.rm_apply_agreement(jsonb) from public, anon;
grant execute on function public.rm_apply_agreement(jsonb) to authenticated;
grant execute on function public.rm_apply_agreement(jsonb) to service_role;

revoke all on function public.rm_effective_agreement(uuid, date) from public, anon;
grant execute on function public.rm_effective_agreement(uuid, date) to authenticated;
grant execute on function public.rm_effective_agreement(uuid, date) to service_role;

commit;
