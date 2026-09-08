-- F2 — Linjesporbar prishistorikk og atomisk avstemming (revidert etter gjennomgang av a34fa0a).
--
-- Rulles ut manuelt (ikke kjørt av agenten). Forutsetninger lest fra live-basen 8. sep 2026:
--   * raw_material_price_history mangler invoice_line_id (bekreftet), og har kolonnene
--     id, raw_material_id, supplier_id, price, source, source_reference, invoice_id,
--     effective_date, notes, created_by, created_at.
--   * raw_material_purchases HAR allerede unik invoice_line_id (rører vi ikke).
--   * invoices har currency, is_credit_note, flagged_at, reconciled_at/by, supplier_id, legal_entity_id.
--   * invoice_lines har price_per_base_unit, base_quantity, quantity, requires_review, match_confidence.
--   * LIVE trigger trg_invoice_line_match_price_history lyttet KUN på
--     (raw_material_id, match_confidence). Den droppes og gjenskapes med riktig kolonneliste.
--   * LIVE trg_invoice_status_price_history lyttet kun på invoices.status. Metadataendringer
--     (dato, valuta, kreditnota, leverandør) fanges nå av en egen trigger.
--
-- Endringen er additiv for data: ingen rader slettes, gammel historikk merkes og settes til side.

begin;

-- 0) Fellesvakt mot NaN/Infinity ---------------------------------------------
-- NB: i Postgres er numeric 'NaN' = numeric 'NaN' TRUE, så `x <> x` fanger IKKE NaN.
create or replace function public.rm_is_finite(p numeric)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select p is not null
     and p <> 'NaN'::numeric
     and p <> 'Infinity'::numeric
     and p <> '-Infinity'::numeric;
$function$;

comment on function public.rm_is_finite(numeric) is
  'Sann kun for et endelig tall. numeric ''NaN'' = ''NaN'' er TRUE i Postgres, derfor eksplisitt sammenligning.';

-- 1) Nye kolonner på prishistorikken -----------------------------------------
-- Sporbarhet skal overleve at en fakturalinje slettes: ON DELETE SET NULL, ikke CASCADE.
-- Linjens identitet bevares i source_reference/invoice_line_ref og raden merkes superseded.
alter table public.raw_material_price_history
  add column if not exists invoice_line_id uuid references public.invoice_lines(id) on delete set null,
  add column if not exists invoice_line_ref uuid,
  add column if not exists currency text not null default 'NOK',
  add column if not exists is_credit boolean not null default false,
  add column if not exists is_legacy boolean not null default false,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_reason text;

comment on column public.raw_material_price_history.invoice_line_id is
  'Fakturalinjen prisen kom fra. Én prishendelse per linje, slik at samme råvare kan stå flere ganger på samme faktura. Settes til NULL hvis linjen slettes.';
comment on column public.raw_material_price_history.invoice_line_ref is
  'Uforanderlig kopi av linje-ID for revisjonsspor. Overlever sletting av fakturalinjen.';
comment on column public.raw_material_price_history.is_credit is
  'Kreditnota. Slike rader er en kredithendelse og skal aldri bli ny normal kostpris.';
comment on column public.raw_material_price_history.is_legacy is
  'Rad skrevet av den gamle kontrakten (én rad per faktura og råvare, uten linje-ID).';
comment on column public.raw_material_price_history.superseded_reason is
  'Hvorfor raden ikke lenger er gjeldende: linje_ukoblet, til_gjennomgang, valuta_endret, ny_linjerad, linje_slettet, angret_omregning.';

-- Alt som allerede finnes fra faktura uten linje-ID er per definisjon legacy.
update public.raw_material_price_history
   set is_legacy = true
 where source = 'invoice'
   and invoice_line_id is null
   and is_legacy = false;

create unique index if not exists ux_rmph_invoice_line
  on public.raw_material_price_history (invoice_line_id)
  where invoice_line_id is not null;

create index if not exists ix_rmph_rm_effective
  on public.raw_material_price_history (raw_material_id, effective_date desc, created_at desc);

create index if not exists ix_rmph_active
  on public.raw_material_price_history (raw_material_id, effective_date desc)
  where superseded_at is null and is_legacy = false and is_credit = false;

-- Sletting av en fakturalinje skal bevare prisauditen, men gjøre den inaktiv.
create or replace function public.fn_rmph_line_deleted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.raw_material_price_history
     set superseded_at = coalesce(superseded_at, now()),
         superseded_reason = coalesce(superseded_reason, 'linje_slettet')
   where invoice_line_id = old.id;
  return old;
end;
$function$;

drop trigger if exists trg_rmph_line_deleted on public.invoice_lines;
create trigger trg_rmph_line_deleted
  before delete on public.invoice_lines
  for each row execute function public.fn_rmph_line_deleted();

-- 2) Én felles funksjon som fører prishistorikk for én fakturalinje ----------
-- Kontrakt: returnerer true når linjen har en GYLDIG aktiv prishendelse etter kallet.
-- Når linjen ikke lenger kvalifiserer, settes en eventuell tidligere linjerad til side —
-- ellers ville feil historikk bli liggende aktiv.
create or replace function public.fn_rm_price_history_upsert_line(p_line_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_l invoice_lines%rowtype;
  v_inv invoices%rowtype;
  v_sup_entity uuid;
  v_rm_entity uuid;
  v_reason text;
begin
  select * into v_l from public.invoice_lines where id = p_line_id;
  if not found then return false; end if;

  select * into v_inv from public.invoices where id = v_l.invoice_id;
  if not found then return false; end if;

  -- Årsakene til at linjen IKKE skal ha en aktiv prishendelse.
  if v_l.raw_material_id is null then
    v_reason := 'linje_ukoblet';
  elsif coalesce(v_l.match_confidence::text, '') = 'not_applicable' then
    v_reason := 'linje_ukoblet';
  elsif coalesce(v_l.match_confidence::text, '') not in ('auto_high', 'auto_medium', 'auto_low', 'manual') then
    -- Ukjent/tom confidence er ikke en avklart kobling.
    v_reason := 'ukjent_match';
  elsif coalesce(v_l.requires_review, false) then
    v_reason := 'til_gjennomgang';
  elsif v_inv.status not in ('ready', 'reconciled') then
    v_reason := 'faktura_ikke_klar';
  elsif upper(coalesce(v_inv.currency, 'NOK')) <> 'NOK' then
    v_reason := 'valuta_endret';
  elsif v_inv.flagged_at is not null then
    v_reason := 'faktura_flagget';
  elsif not public.rm_is_finite(v_l.price_per_base_unit) or v_l.price_per_base_unit < 0 then
    -- Aldri unit_price som fallback, og aldri NaN/Infinity/negativ pris.
    v_reason := 'ugyldig_pris';
  elsif not coalesce(v_inv.is_credit_note, false)
        and v_l.base_quantity is not null
        and (not public.rm_is_finite(v_l.base_quantity) or v_l.base_quantity < 0) then
    -- Negativ mengde på en ordinær faktura er ikke et kjøp.
    v_reason := 'ugyldig_mengde';
  end if;

  if v_reason is null then
    -- Selskapskontroll: både råvare og leverandør må høre til fakturaens selskap.
    select legal_entity_id into v_rm_entity from public.raw_materials where id = v_l.raw_material_id;
    if v_rm_entity is null or v_rm_entity <> v_inv.legal_entity_id then
      v_reason := 'annet_selskap';
    else
      select legal_entity_id into v_sup_entity from public.suppliers where id = v_inv.supplier_id;
      if v_inv.supplier_id is null or v_sup_entity is null or v_sup_entity <> v_inv.legal_entity_id then
        v_reason := 'leverandor_annet_selskap';
      end if;
    end if;
  end if;

  if v_reason is not null then
    update public.raw_material_price_history
       set superseded_at = coalesce(superseded_at, now()),
           superseded_reason = coalesce(superseded_reason, v_reason)
     where invoice_line_id = p_line_id
       and superseded_at is null;
    return false;
  end if;

  insert into public.raw_material_price_history
    (raw_material_id, supplier_id, price, source, invoice_id, invoice_line_id, invoice_line_ref,
     effective_date, source_reference, currency, is_credit, created_by)
  values
    (v_l.raw_material_id, v_inv.supplier_id, v_l.price_per_base_unit, 'invoice',
     v_inv.id, v_l.id, v_l.id, v_inv.invoice_date, v_inv.invoice_number, 'NOK',
     coalesce(v_inv.is_credit_note, false), auth.uid())
  on conflict (invoice_line_id) where invoice_line_id is not null
  do update set
     raw_material_id  = excluded.raw_material_id,
     supplier_id      = excluded.supplier_id,
     price            = excluded.price,
     effective_date   = excluded.effective_date,
     source_reference = excluded.source_reference,
     is_credit        = excluded.is_credit,
     currency         = 'NOK',
     superseded_at    = null,
     superseded_reason = null;

  -- Gammel rad for samme faktura og råvare bevares, men telles ikke dobbelt.
  update public.raw_material_price_history h
     set is_legacy = true,
         superseded_at = coalesce(h.superseded_at, now()),
         superseded_reason = coalesce(h.superseded_reason, 'ny_linjerad')
   where h.invoice_id = v_inv.id
     and h.raw_material_id = v_l.raw_material_id
     and h.invoice_line_id is null
     and h.source = 'invoice';

  return true;
end;
$function$;

-- 3) Avledet kostpris --------------------------------------------------------
-- Utvalget joiner invoices, slik at en gammel kreditnota ikke slipper gjennom selv om
-- migreringen skulle ha satt is_credit = false på raden. Legacy, superseded, fremmed
-- valuta og flaggede fakturaer er ekskludert. Nyere manuell/avtalt pris respekteres.
create or replace function public.rm_apply_derived_cost_price(p_raw_material_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rm raw_materials%rowtype;
  v_price numeric;
  v_date date;
begin
  select * into v_rm from public.raw_materials where id = p_raw_material_id for update;
  if not found then return null; end if;
  if coalesce(v_rm.price_source, '') = 'manual' then return v_rm.current_cost_price; end if;

  select h.price, h.effective_date
    into v_price, v_date
    from public.raw_material_price_history h
    left join public.invoices i on i.id = h.invoice_id
   where h.raw_material_id = p_raw_material_id
     and h.source in ('invoice', 'agreement', 'recalc')
     and h.is_credit = false
     and h.is_legacy = false
     and h.superseded_at is null
     and upper(coalesce(h.currency, 'NOK')) = 'NOK'
     and public.rm_is_finite(h.price)
     and h.price >= 0
     -- Kreditnota utelukkes også via fakturaen, ikke bare via kolonnen.
     and (h.invoice_id is null or coalesce(i.is_credit_note, false) = false)
     and (h.invoice_id is null or i.flagged_at is null)
     and (h.invoice_id is null or upper(coalesce(i.currency, 'NOK')) = 'NOK')
     and (v_rm.primary_supplier_id is null or h.supplier_id is not distinct from v_rm.primary_supplier_id)
   order by h.effective_date desc, h.created_at desc
   limit 1;

  if v_price is null then return v_rm.current_cost_price; end if;

  -- En eldre hendelse skal aldri overskrive en nyere registrert pris.
  if v_rm.price_updated_at is not null
     and v_date is not null
     and v_date < v_rm.price_updated_at::date then
    return v_rm.current_cost_price;
  end if;

  update public.raw_materials
     set current_cost_price = v_price,
         -- Hendelsens dato, ikke now(): ellers ødelegges eldre/nyere-sammenligningen.
         price_updated_at = coalesce(v_date::timestamptz, now()),
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
  if tg_op = 'UPDATE'
     and old.raw_material_id is not distinct from new.raw_material_id
     and old.match_confidence is not distinct from new.match_confidence
     and old.price_per_base_unit is not distinct from new.price_per_base_unit
     and old.base_quantity is not distinct from new.base_quantity
     and old.requires_review is not distinct from new.requires_review then
    return new;
  end if;

  -- Bytter linjen råvare, må den gamle råvarens hendelse settes til side.
  if tg_op = 'UPDATE'
     and old.raw_material_id is not null
     and old.raw_material_id is distinct from new.raw_material_id then
    update public.raw_material_price_history
       set superseded_at = coalesce(superseded_at, now()),
           superseded_reason = coalesce(superseded_reason, 'linje_ukoblet')
     where invoice_line_id = new.id
       and raw_material_id = old.raw_material_id
       and superseded_at is null;
    perform public.rm_apply_derived_cost_price(old.raw_material_id);
  end if;

  if public.fn_rm_price_history_upsert_line(new.id) then
    perform public.rm_apply_derived_cost_price(new.raw_material_id);
    perform public.refresh_purchase_stats();
  elsif new.raw_material_id is not null then
    perform public.rm_apply_derived_cost_price(new.raw_material_id);
  end if;
  return new;
end;
$function$;

-- Live-triggeren lyttet kun på (raw_material_id, match_confidence). Gjenskap med full liste.
drop trigger if exists trg_invoice_line_match_price_history on public.invoice_lines;
create trigger trg_invoice_line_match_price_history
  after insert or update of raw_material_id, match_confidence, price_per_base_unit,
                            base_quantity, requires_review
  on public.invoice_lines
  for each row execute function public.fn_invoice_line_match_price_history();

-- Status OG metadata på fakturaen påvirker alle linjene.
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
  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.invoice_date is not distinct from new.invoice_date
     and old.currency is not distinct from new.currency
     and old.is_credit_note is not distinct from new.is_credit_note
     and old.supplier_id is not distinct from new.supplier_id
     and old.flagged_at is not distinct from new.flagged_at then
    return new;
  end if;

  for r in
    select il.id, il.raw_material_id
      from public.invoice_lines il
     where il.invoice_id = new.id
     order by il.id
  loop
    if public.fn_rm_price_history_upsert_line(r.id) then
      v_any := true;
    end if;
    if r.raw_material_id is not null then
      perform public.rm_apply_derived_cost_price(r.raw_material_id);
    end if;
  end loop;
  if v_any then perform public.refresh_purchase_stats(); end if;
  return new;
end;
$function$;

drop trigger if exists trg_invoice_status_price_history on public.invoices;
create trigger trg_invoice_status_price_history
  after update of status, invoice_date, currency, is_credit_note, supplier_id, flagged_at
  on public.invoices
  for each row execute function public.fn_invoice_status_price_history();

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
  v_skipped int := 0;
begin
  if v_uid is null then
    raise exception 'Du må være innlogget for å bekrefte en faktura' using errcode = '28000';
  end if;

  -- FAST LÅSEREKKEFØLGE: faktura -> linjer (stigende ID). Samme rekkefølge som varemottaket.
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Fakturaen finnes ikke' using errcode = 'P0002';
  end if;

  if not public.has_ravarer_invoice_access(v_inv.legal_entity_id, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer' using errcode = '42501';
  end if;

  perform 1 from public.invoice_lines where invoice_id = v_inv.id order by id for update;

  if v_inv.status = 'reconciled' then
    return jsonb_build_object('ok', true, 'already_reconciled', true, 'history_written', 0);
  end if;

  if v_inv.flagged_at is not null then
    raise exception 'Fakturaen er flagget for oppfølging og kan ikke bekreftes';
  end if;
  if v_inv.supplier_id is null then
    raise exception 'Fakturaen mangler leverandør — prishistorikken kan ikke føres';
  end if;
  perform 1 from public.suppliers s
   where s.id = v_inv.supplier_id and s.legal_entity_id = v_inv.legal_entity_id;
  if not found then
    raise exception 'Leverandøren tilhører et annet selskap enn fakturaen' using errcode = '42501';
  end if;
  if upper(coalesce(v_inv.currency, 'NOK')) <> 'NOK' then
    raise exception 'Fakturaen er i % — prishistorikken føres i NOK', upper(v_inv.currency);
  end if;
  if v_inv.status not in ('imported', 'needs_review', 'ready', 'matched', 'review') then
    raise exception 'Fakturaen har status «%» og kan ikke bekreftes herfra', v_inv.status;
  end if;

  -- Alle linjer må være avklart: kjent confidence, ingen gjennomgang, gyldige tall.
  select count(*) into v_bad
    from public.invoice_lines il
   where il.invoice_id = v_inv.id
     and coalesce(il.match_confidence::text, '') <> 'not_applicable'
     and (coalesce(il.requires_review, false)
          or il.raw_material_id is null
          or coalesce(il.match_confidence::text, '') not in ('auto_high', 'auto_medium', 'auto_low', 'manual')
          or not public.rm_is_finite(il.price_per_base_unit)
          or il.price_per_base_unit < 0
          or (il.base_quantity is not null and not public.rm_is_finite(il.base_quantity))
          or (coalesce(v_inv.is_credit_note, false) = false
              and il.base_quantity is not null and il.base_quantity < 0));
  if v_bad > 0 then
    raise exception '% linjer mangler råvare, gjennomgang, gyldig mengde eller gyldig pris per grunnenhet', v_bad;
  end if;

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
       and coalesce(il.match_confidence::text, '') <> 'not_applicable'
     order by il.id
  loop
    if public.fn_rm_price_history_upsert_line(r.id) then
      v_written := v_written + 1;
      perform public.rm_apply_derived_cost_price(r.raw_material_id);
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  -- En bekreftet faktura skal aldri stå igjen med linjer uten prishendelse.
  if v_skipped > 0 then
    raise exception '% linjer kunne ikke føres i prishistorikken — avstemmingen er avbrutt', v_skipped;
  end if;

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
grant execute on function public.rm_is_finite(numeric) to authenticated, service_role;

commit;
