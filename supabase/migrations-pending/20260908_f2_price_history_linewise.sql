-- F2 — Linjesporbar prishistorikk og atomisk avstemming.
--
-- Rulles ut manuelt (ikke kjørt av agenten). Forutsetninger lest fra live-basen 8. sep 2026:
--   * raw_material_price_history mangler invoice_line_id (bekreftet).
--   * raw_material_purchases HAR allerede unik invoice_line_id (rører vi ikke).
--   * invoices har currency, is_credit_note, flagged_at, reconciled_at/by.
--   * invoice_lines har price_per_base_unit, requires_review, match_confidence.
--   * raw_materials.price_source = 'manual' betyr manuelt overstyrt kostpris.
--
-- Endringen er additiv: ingen kolonner eller rader slettes, gammel historikk merkes
-- som legacy og settes til side (superseded_at) først når en linjeført rad dekker den.

begin;

-- 1) Nye kolonner på prishistorikken -----------------------------------------
alter table public.raw_material_price_history
  add column if not exists invoice_line_id uuid references public.invoice_lines(id) on delete cascade,
  add column if not exists currency text not null default 'NOK',
  add column if not exists is_credit boolean not null default false,
  add column if not exists is_legacy boolean not null default false,
  add column if not exists superseded_at timestamptz;

comment on column public.raw_material_price_history.invoice_line_id is
  'Fakturalinjen prisen kom fra. Gir én prishendelse per linje, slik at samme råvare kan stå flere ganger på samme faktura.';
comment on column public.raw_material_price_history.is_credit is
  'Kreditnota. Slike rader er en kredithendelse og skal aldri bli ny normal kostpris.';
comment on column public.raw_material_price_history.is_legacy is
  'Rad skrevet av den gamle kontrakten (én rad per faktura og råvare, uten linje-ID).';

-- Alt som allerede finnes fra faktura uten linje-ID er per definisjon legacy.
update public.raw_material_price_history
   set is_legacy = true
 where source = 'invoice'
   and invoice_line_id is null
   and is_legacy = false;

-- Unikhet per fakturalinje. Idempotens for både triggerne og avstemmings-RPC-en.
create unique index if not exists ux_rmph_invoice_line
  on public.raw_material_price_history (invoice_line_id)
  where invoice_line_id is not null;

create index if not exists ix_rmph_rm_effective
  on public.raw_material_price_history (raw_material_id, effective_date desc, created_at desc);

-- 2) Én felles funksjon som fører prishistorikk for én fakturalinje ----------
create or replace function public.fn_rm_price_history_upsert_line(p_line_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_l invoice_lines%rowtype;
  v_inv invoices%rowtype;
begin
  select * into v_l from public.invoice_lines where id = p_line_id;
  if not found or v_l.raw_material_id is null then return false; end if;

  select * into v_inv from public.invoices where id = v_l.invoice_id;
  if not found then return false; end if;

  -- Kun avklarte linjer.
  if coalesce(v_l.match_confidence, '') not in ('auto_high', 'auto_medium', 'auto_low', 'manual') then
    return false;
  end if;
  if coalesce(v_l.requires_review, false) then return false; end if;
  if v_inv.status not in ('ready', 'reconciled') then return false; end if;

  -- Kun NOK: vi omregner ikke valuta automatisk.
  if upper(coalesce(v_inv.currency, 'NOK')) <> 'NOK' then return false; end if;

  -- Aldri unit_price som fallback: uten pris per grunnenhet vet vi ikke hva prisen gjelder.
  if v_l.price_per_base_unit is null or v_l.price_per_base_unit < 0 then return false; end if;

  insert into public.raw_material_price_history
    (raw_material_id, supplier_id, price, source, invoice_id, invoice_line_id,
     effective_date, source_reference, currency, is_credit, created_by)
  values
    (v_l.raw_material_id, v_inv.supplier_id, v_l.price_per_base_unit, 'invoice',
     v_inv.id, v_l.id, v_inv.invoice_date, v_inv.invoice_number, 'NOK',
     coalesce(v_inv.is_credit_note, false), auth.uid())
  on conflict (invoice_line_id) where invoice_line_id is not null
  do update set
     raw_material_id = excluded.raw_material_id,
     supplier_id     = excluded.supplier_id,
     price           = excluded.price,
     effective_date  = excluded.effective_date,
     source_reference = excluded.source_reference,
     is_credit       = excluded.is_credit;

  -- Gammel rad for samme faktura og råvare bevares, men telles ikke dobbelt.
  update public.raw_material_price_history h
     set is_legacy = true,
         superseded_at = coalesce(h.superseded_at, now())
   where h.invoice_id = v_inv.id
     and h.raw_material_id = v_l.raw_material_id
     and h.invoice_line_id is null
     and h.source = 'invoice';

  return true;
end;
$function$;

-- 3) Avledet kostpris: dato + primærleverandør, manuell overstyring vinner ---
create or replace function public.rm_apply_derived_cost_price(p_raw_material_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rm raw_materials%rowtype;
  v_price numeric;
begin
  select * into v_rm from public.raw_materials where id = p_raw_material_id;
  if not found then return null; end if;
  if coalesce(v_rm.price_source, '') = 'manual' then return v_rm.current_cost_price; end if;

  select h.price
    into v_price
    from public.raw_material_price_history h
   where h.raw_material_id = p_raw_material_id
     and h.is_credit = false
     and h.superseded_at is null
     and (v_rm.primary_supplier_id is null or h.supplier_id is not distinct from v_rm.primary_supplier_id)
   order by h.effective_date desc, h.created_at desc
   limit 1;

  if v_price is null then return v_rm.current_cost_price; end if;

  update public.raw_materials
     set current_cost_price = v_price,
         price_updated_at = now(),
         price_source = 'invoice',
         updated_at = now()
   where id = p_raw_material_id
     and coalesce(price_source, '') <> 'manual';

  return v_price;
end;
$function$;

-- 4) Triggerne skrives om til linjekontrakten -------------------------------
create or replace function public.fn_invoice_line_match_price_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.raw_material_id is null then return new; end if;
  if tg_op = 'UPDATE'
     and old.raw_material_id is not distinct from new.raw_material_id
     and old.match_confidence is not distinct from new.match_confidence
     and old.price_per_base_unit is not distinct from new.price_per_base_unit
     and old.requires_review is not distinct from new.requires_review then
    return new;
  end if;

  if public.fn_rm_price_history_upsert_line(new.id) then
    perform public.rm_apply_derived_cost_price(new.raw_material_id);
    perform public.refresh_purchase_stats();
  end if;
  return new;
end;
$function$;

create or replace function public.fn_invoice_status_price_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_any boolean := false;
begin
  if new.status = any(array['ready', 'reconciled']) and (old.status is distinct from new.status) then
    for r in
      select il.id, il.raw_material_id
        from public.invoice_lines il
       where il.invoice_id = new.id
         and il.raw_material_id is not null
       order by il.id
    loop
      if public.fn_rm_price_history_upsert_line(r.id) then
        v_any := true;
        perform public.rm_apply_derived_cost_price(r.raw_material_id);
      end if;
    end loop;
    if v_any then perform public.refresh_purchase_stats(); end if;
  end if;
  return new;
end;
$function$;

-- 5) Atomisk avstemming ------------------------------------------------------
create or replace function public.rm_reconcile_invoice(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inv invoices%rowtype;
  v_uid uuid := auth.uid();
  v_bad int;
  r record;
  v_written int := 0;
begin
  if v_uid is null then
    raise exception 'Du må være innlogget for å bekrefte en faktura' using errcode = '28000';
  end if;

  -- Lås fakturaen først, deretter linjene i stigende ID-rekkefølge (fast låserekkefølge).
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Fakturaen finnes ikke' using errcode = 'P0002';
  end if;

  if not public.has_ravarer_invoice_access(v_inv.legal_entity_id, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer' using errcode = '42501';
  end if;

  perform 1 from public.invoice_lines where invoice_id = v_inv.id order by id for update;

  -- Idempotens: gjentatt kall på en bekreftet faktura er en no-op, ikke en feil.
  if v_inv.status = 'reconciled' then
    return jsonb_build_object('ok', true, 'already_reconciled', true, 'history_written', 0);
  end if;

  if v_inv.flagged_at is not null then
    raise exception 'Fakturaen er flagget for oppfølging og kan ikke bekreftes';
  end if;
  if v_inv.supplier_id is null then
    raise exception 'Fakturaen mangler leverandør — prishistorikken kan ikke føres';
  end if;
  if upper(coalesce(v_inv.currency, 'NOK')) <> 'NOK' then
    raise exception 'Fakturaen er i % — prishistorikken føres i NOK', upper(v_inv.currency);
  end if;
  if v_inv.status not in ('imported', 'needs_review', 'ready', 'matched', 'review') then
    raise exception 'Fakturaen har status «%» og kan ikke bekreftes herfra', v_inv.status;
  end if;

  -- Alle linjer må være avklart.
  select count(*) into v_bad
    from public.invoice_lines il
   where il.invoice_id = v_inv.id
     and coalesce(il.match_confidence, '') <> 'not_applicable'
     and (coalesce(il.requires_review, false)
          or il.raw_material_id is null
          or il.price_per_base_unit is null
          or il.price_per_base_unit < 0);
  if v_bad > 0 then
    raise exception '% linjer mangler råvare, gjennomgang eller gyldig pris per grunnenhet', v_bad;
  end if;

  -- Selskapskobling: råvare og leverandør må høre til fakturaens selskap.
  select count(*) into v_bad
    from public.invoice_lines il
    join public.raw_materials rm on rm.id = il.raw_material_id
   where il.invoice_id = v_inv.id
     and rm.legal_entity_id <> v_inv.legal_entity_id;
  if v_bad > 0 then
    raise exception '% linjer peker på råvarer i et annet selskap', v_bad;
  end if;

  update public.invoices
     set status = 'reconciled',
         reconciled_at = now(),
         reconciled_by = v_uid,
         updated_at = now()
   where id = v_inv.id;

  for r in
    select il.id, il.raw_material_id
      from public.invoice_lines il
     where il.invoice_id = v_inv.id
       and il.raw_material_id is not null
       and coalesce(il.match_confidence, '') <> 'not_applicable'
     order by il.id
  loop
    if public.fn_rm_price_history_upsert_line(r.id) then
      v_written := v_written + 1;
      perform public.rm_apply_derived_cost_price(r.raw_material_id);
    end if;
  end loop;

  perform public.refresh_purchase_stats();

  return jsonb_build_object(
    'ok', true,
    'already_reconciled', false,
    'history_written', v_written,
    'is_credit_note', coalesce(v_inv.is_credit_note, false)
  );
end;
$function$;

-- 6) Rettigheter (F1) --------------------------------------------------------
revoke all on function public.fn_rm_price_history_upsert_line(uuid) from public, anon, authenticated;
revoke all on function public.rm_apply_derived_cost_price(uuid) from public, anon, authenticated;
revoke all on function public.rm_reconcile_invoice(uuid) from public, anon;
grant execute on function public.rm_reconcile_invoice(uuid) to authenticated;
grant execute on function public.rm_reconcile_invoice(uuid) to service_role;
grant execute on function public.fn_rm_price_history_upsert_line(uuid) to service_role;
grant execute on function public.rm_apply_derived_cost_price(uuid) to service_role;

commit;
