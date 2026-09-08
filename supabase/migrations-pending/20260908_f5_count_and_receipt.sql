-- F5 — Serverlagret telleark, atomisk claim, konfliktkontroll og sporbart varemottak
-- (revidert etter gjennomgang av a34fa0a).
--
-- Rulles ut manuelt (ikke kjørt av agenten). Forutsetninger lest fra live-basen 8. sep 2026:
--   * stock_movements har unik (source_table, source_id, raw_material_id) der source_id ikke er null.
--   * trg_stock_from_invoice_line fører allerede en purchase/return-bevegelse per fakturalinje.
--     Bokført bevegelse er IKKE det samme som fysisk mottak — mottaket kvitteres derfor ut i
--     en egen tabell (rm_goods_receipts) med hvem, når og mengde.
--   * rm_stock_count_apply (v1) beholdes urørt for eventuelle andre kallere.
--   * has_position_in_entity(uuid), has_app_write_access(text) og has_ravarer_invoice_access finnes.
--   * rm_is_finite(numeric) kommer fra 20260908_f2_price_history_linewise.sql — kjør F2 først.

begin;

-- 1) Serverlagret telleark ----------------------------------------------------
create table if not exists public.rm_stock_count_sheets (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  count_date date not null default current_date,
  op_id uuid not null unique,
  status text not null default 'draft' check (status in ('draft', 'applying', 'applied', 'discarded')),
  note text,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text,
  result jsonb,
  applied_at timestamptz,
  applied_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.rm_stock_count_sheets to authenticated;
grant all on public.rm_stock_count_sheets to service_role;

alter table public.rm_stock_count_sheets enable row level security;

drop policy if exists "rm_count_sheets_select" on public.rm_stock_count_sheets;
create policy "rm_count_sheets_select" on public.rm_stock_count_sheets
  for select to authenticated
  using (public.has_position_in_entity(legal_entity_id));

drop policy if exists "rm_count_sheets_write" on public.rm_stock_count_sheets;
create policy "rm_count_sheets_write" on public.rm_stock_count_sheets
  for insert to authenticated
  with check (
    public.has_position_in_entity(legal_entity_id)
    and (public.has_app_write_access('ravarer') or public.has_app_write_access('lager'))
    and created_by = auth.uid()
    -- Klienten kan bare opprette utkast. Bokføring skjer via RPC-en.
    and status = 'draft'
    and applied_at is null
    and applied_by is null
    and result is null
  );

-- Klienten kan redigere utkastet sitt, men aldri sette applied/result eller flytte arket.
drop policy if exists "rm_count_sheets_update" on public.rm_stock_count_sheets;
create policy "rm_count_sheets_update" on public.rm_stock_count_sheets
  for update to authenticated
  using (
    public.has_position_in_entity(legal_entity_id)
    and (public.has_app_write_access('ravarer') or public.has_app_write_access('lager'))
    and status = 'draft'
  )
  with check (
    public.has_position_in_entity(legal_entity_id)
    and (public.has_app_write_access('ravarer') or public.has_app_write_access('lager'))
    and status in ('draft', 'discarded')
    and applied_at is null
    and applied_by is null
    and result is null
  );

drop policy if exists "rm_count_sheets_delete" on public.rm_stock_count_sheets;
create policy "rm_count_sheets_delete" on public.rm_stock_count_sheets
  for delete to authenticated
  using (
    public.has_position_in_entity(legal_entity_id)
    and (public.has_app_write_access('ravarer') or public.has_app_write_access('lager'))
    and status = 'draft'
  );

-- Uforanderlige felt: selskap, op_id og opprinnelig oppretter kan ikke endres av klienten,
-- og et bokført ark kan ikke redigeres i det hele tatt.
create or replace function public.fn_rm_count_sheet_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- Kall fra RPC-en (SECURITY DEFINER, eier postgres) kjører ikke som 'authenticated'
  -- og skal slippe forbi. Vakten gjelder direkte klientskriving.
  if current_user <> 'authenticated' then
    return new;
  end if;
  if old.status in ('applied') then
    raise exception 'Et bokført telleark kan ikke endres' using errcode = '42501';
  end if;
  if new.legal_entity_id is distinct from old.legal_entity_id then
    raise exception 'Telleark kan ikke flyttes til et annet selskap' using errcode = '42501';
  end if;
  if new.op_id is distinct from old.op_id or new.created_by is distinct from old.created_by then
    raise exception 'Operasjons-ID og oppretter er låst' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_rm_count_sheet_guard on public.rm_stock_count_sheets;
create trigger trg_rm_count_sheet_guard
  before update on public.rm_stock_count_sheets
  for each row execute function public.fn_rm_count_sheet_guard();

create index if not exists ix_rm_count_sheets_entity_date
  on public.rm_stock_count_sheets (legal_entity_id, count_date desc);
create index if not exists ix_rm_count_sheets_open
  on public.rm_stock_count_sheets (legal_entity_id, created_by)
  where status = 'draft';

drop trigger if exists trg_rm_count_sheets_updated_at on public.rm_stock_count_sheets;
create trigger trg_rm_count_sheets_updated_at
  before update on public.rm_stock_count_sheets
  for each row execute function public.update_updated_at_column();

-- 2) Telling: claim FØR arbeid, konfliktkontroll og idempotens ---------------
create or replace function public.rm_stock_count_apply_v2(
  p_op_id uuid,
  p_lines jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  e record;
  v_uid uuid := auth.uid();
  v_entity uuid;
  v_entity_count int;
  v_name text;
  v_current numeric;
  v_diff numeric;
  v_adjusted int := 0;
  v_unchanged int := 0;
  v_rows jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_sheet rm_stock_count_sheets%rowtype;
  v_result jsonb;
  v_hash text;
  v_ids uuid[];
begin
  if v_uid is null then
    raise exception 'Du må være innlogget for å bokføre en telling' using errcode = '28000';
  end if;
  if p_op_id is null then
    raise exception 'Tellingen mangler operasjons-ID';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Tellingen må ha minst én linje';
  end if;

  -- 2a) Ingen duplikate råvarer i samme telling.
  select array_agg((x->>'raw_material_id')::uuid order by (x->>'raw_material_id')::uuid)
    into v_ids from jsonb_array_elements(p_lines) x;
  if array_length(v_ids, 1) is distinct from (select count(distinct u) from unnest(v_ids) u) then
    raise exception 'Samme vare er ført opp flere ganger i tellingen';
  end if;
  if exists (select 1 from unnest(v_ids) u where u is null) then
    raise exception 'En tellelinje mangler vare';
  end if;

  -- 2b) Alle varene må høre til samme selskap, og brukeren må ha skrivetilgang der.
  select count(distinct rm.legal_entity_id), min(rm.legal_entity_id)
    into v_entity_count, v_entity
    from public.raw_materials rm where rm.id = any(v_ids);
  if v_entity is null then
    raise exception 'Ingen av varene finnes';
  end if;
  if v_entity_count > 1 then
    raise exception 'Tellingen blander varer fra flere selskaper' using errcode = '42501';
  end if;
  if (select count(*) from public.raw_materials rm where rm.id = any(v_ids)) <> array_length(v_ids, 1) then
    raise exception 'En eller flere varer finnes ikke';
  end if;
  if not (public.has_position_in_entity(v_entity)
          and (public.has_app_write_access('ravarer') or public.has_app_write_access('lager'))) then
    raise exception 'Ingen skrivetilgang til lageret i dette selskapet' using errcode = '42501';
  end if;

  v_hash := md5(p_lines::text);

  -- 2c) CLAIM: opprett arket atomisk FØR arbeidet, og lås det.
  insert into public.rm_stock_count_sheets (legal_entity_id, count_date, op_id, status, note,
                                            payload, payload_hash, created_by)
  values (v_entity, current_date, p_op_id, 'applying', p_note, p_lines, v_hash, v_uid)
  on conflict (op_id) do nothing;

  select * into v_sheet from public.rm_stock_count_sheets where op_id = p_op_id for update;
  if not found then
    raise exception 'Kunne ikke reservere tellingen' using errcode = '40001';
  end if;

  -- 2d) Tilgang og innhold valideres FØR et hurtigbufret svar returneres.
  if v_sheet.legal_entity_id <> v_entity then
    raise exception 'Operasjons-ID-en tilhører et annet selskap' using errcode = '42501';
  end if;
  if not public.has_position_in_entity(v_sheet.legal_entity_id) then
    raise exception 'Ingen tilgang til dette telleoppdraget' using errcode = '42501';
  end if;
  if v_sheet.status = 'discarded' then
    raise exception 'Telleoppdraget er forkastet og kan ikke bokføres';
  end if;
  if v_sheet.payload_hash is not null and v_sheet.payload_hash <> v_hash then
    raise exception 'Operasjons-ID-en er allerede brukt med et annet innhold' using errcode = '23505';
  end if;
  if v_sheet.status = 'applied' then
    return coalesce(v_sheet.result, jsonb_build_object('ok', true))
           || jsonb_build_object('already_applied', true);
  end if;

  update public.rm_stock_count_sheets
     set status = 'applying', payload = p_lines, payload_hash = v_hash,
         note = coalesce(p_note, note)
   where id = v_sheet.id;

  -- 2e) Deterministisk låserekkefølge på råvarene.
  perform rm.id from public.raw_materials rm
    where rm.id = any(v_ids) order by rm.id for update;

  for e in
    select (x->>'raw_material_id')::uuid as raw_material_id,
           (x->>'counted_base')::numeric as counted,
           nullif(x->>'expected_base', '')::numeric as expected,
           nullif(x->>'line_note', '') as line_note,
           nullif(x->>'location', '') as location
      from jsonb_array_elements(p_lines) x
     order by 1
  loop
    -- NaN/Infinity: numeric 'NaN' = 'NaN' er TRUE i Postgres, derfor rm_is_finite.
    if not public.rm_is_finite(e.counted) or e.counted < 0 then
      raise exception 'Ugyldig telletall for vare %', e.raw_material_id;
    end if;
    if e.expected is null then
      raise exception 'Tellelinjen mangler forventet beholdning (expected_base)';
    end if;
    if not public.rm_is_finite(e.expected) then
      raise exception 'Ugyldig forventet beholdning for vare %', e.raw_material_id;
    end if;

    select rm.name, coalesce(rm.current_stock, 0)
      into v_name, v_current
      from public.raw_materials rm
     where rm.id = e.raw_material_id and rm.stock_tracking;
    if v_name is null then
      raise exception 'Varen finnes ikke eller er ikke lagerført';
    end if;

    if e.expected is distinct from v_current then
      v_conflicts := v_conflicts || jsonb_build_object(
        'raw_material_id', e.raw_material_id, 'name', v_name,
        'expected', e.expected, 'current', v_current);
    end if;

    v_diff := e.counted - v_current;
    if v_diff <> 0 then
      insert into public.stock_movements(legal_entity_id, raw_material_id, movement_type,
        quantity_base, occurred_at, source_table, source_id, reason, note, created_by)
      values (v_entity, e.raw_material_id, 'count_adjust', v_diff, now(),
        'stock_count', p_op_id, 'Varetelling',
        nullif(concat_ws(' | ', p_note, e.location, e.line_note), ''), v_uid)
      on conflict (source_table, source_id, raw_material_id) where source_id is not null
      do nothing;
      v_adjusted := v_adjusted + 1;
    else
      v_unchanged := v_unchanged + 1;
    end if;

    v_rows := v_rows || jsonb_build_object('raw_material_id', e.raw_material_id, 'name', v_name,
      'before', v_current, 'counted', e.counted, 'diff', v_diff);
  end loop;

  -- Konflikt stopper HELE tellingen: transaksjonen rulles tilbake, arket forblir utkast.
  if jsonb_array_length(v_conflicts) > 0 then
    raise exception 'Beholdningen er endret av andre for % varer siden tellingen startet: %',
      jsonb_array_length(v_conflicts),
      (select string_agg(c->>'name', ', ') from jsonb_array_elements(v_conflicts) c)
      using errcode = '40001';
  end if;

  v_result := jsonb_build_object('ok', true, 'adjusted', v_adjusted, 'unchanged', v_unchanged,
                                 'rows', v_rows, 'op_id', p_op_id);

  update public.rm_stock_count_sheets
     set status = 'applied', applied_at = now(), applied_by = v_uid, result = v_result
   where id = v_sheet.id;

  return v_result;
end;
$function$;

-- 3) Varemottak: fysisk kvittering, ikke bare en bokført bevegelse -----------
create table if not exists public.rm_goods_receipts (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  invoice_line_id uuid not null references public.invoice_lines(id) on delete cascade,
  raw_material_id uuid not null references public.raw_materials(id) on delete cascade,
  quantity_base numeric not null,
  movement_id uuid references public.stock_movements(id) on delete set null,
  lot_id uuid,
  received_at timestamptz not null default now(),
  received_by uuid,
  note text,
  created_at timestamptz not null default now(),
  unique (invoice_line_id)
);

grant select, insert on public.rm_goods_receipts to authenticated;
grant all on public.rm_goods_receipts to service_role;
alter table public.rm_goods_receipts enable row level security;

drop policy if exists "rm_goods_receipts_select" on public.rm_goods_receipts;
create policy "rm_goods_receipts_select" on public.rm_goods_receipts
  for select to authenticated
  using (public.has_position_in_entity(legal_entity_id));

-- Innsetting skjer via RPC-en (security definer). Ingen direkte insert-policy for klienten.

-- Lot/parti for råvarer. stock_batches krever stock_item_id og kan ikke brukes til råvarer.
create table if not exists public.rm_stock_lots (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  raw_material_id uuid not null references public.raw_materials(id) on delete cascade,
  lot_number text,
  best_before date,
  received_at timestamptz not null default now(),
  quantity_base numeric not null,
  remaining_base numeric not null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  invoice_line_id uuid references public.invoice_lines(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.rm_stock_lots to authenticated;
grant all on public.rm_stock_lots to service_role;
alter table public.rm_stock_lots enable row level security;

drop policy if exists "rm_stock_lots_select" on public.rm_stock_lots;
create policy "rm_stock_lots_select" on public.rm_stock_lots
  for select to authenticated
  using (public.has_position_in_entity(legal_entity_id));

create index if not exists ix_rm_stock_lots_rm on public.rm_stock_lots (raw_material_id, received_at desc);

drop trigger if exists trg_rm_stock_lots_updated_at on public.rm_stock_lots;
create trigger trg_rm_stock_lots_updated_at
  before update on public.rm_stock_lots
  for each row execute function public.update_updated_at_column();

-- Gammel enarguments-signatur fjernes slik at det bare finnes én kontrakt.
drop function if exists public.rm_receive_invoice_line(uuid);

create or replace function public.rm_receive_invoice_line(
  p_line_id uuid,
  p_lot_number text default null,
  p_best_before date default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_l invoice_lines%rowtype;
  v_inv invoices%rowtype;
  v_rm raw_materials%rowtype;
  v_qty numeric;
  v_existing stock_movements%rowtype;
  v_receipt rm_goods_receipts%rowtype;
  v_movement_id uuid;
  v_lot_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Du må være innlogget for å motta varer' using errcode = '28000';
  end if;

  -- FAST LÅSEREKKEFØLGE: faktura FØR linje — samme rekkefølge som rm_reconcile_invoice,
  -- ellers kan de to låse hverandre i vranglås.
  select i.* into v_inv
    from public.invoices i
    join public.invoice_lines il on il.invoice_id = i.id
   where il.id = p_line_id
     for update of i;
  if not found then raise exception 'Fakturalinjen finnes ikke' using errcode = 'P0002'; end if;

  select * into v_l from public.invoice_lines where id = p_line_id for update;
  if not found then raise exception 'Fakturalinjen finnes ikke' using errcode = 'P0002'; end if;

  if not public.has_ravarer_invoice_access(v_inv.legal_entity_id, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer' using errcode = '42501';
  end if;

  -- Kontrollene gjelder ALLTID, også når triggeren allerede har bokført en bevegelse.
  if v_l.raw_material_id is null then
    raise exception 'Linjen er ikke koblet til en råvare';
  end if;
  if coalesce(v_l.match_confidence::text, '') = 'not_applicable' then
    raise exception 'Linjen er merket som ikke relevant og kan ikke mottas';
  end if;
  if coalesce(v_l.requires_review, false) then
    raise exception 'Linjen venter på gjennomgang og kan ikke mottas';
  end if;

  select * into v_rm from public.raw_materials where id = v_l.raw_material_id for update;
  if not found then raise exception 'Råvaren finnes ikke'; end if;
  if v_rm.legal_entity_id <> v_inv.legal_entity_id then
    raise exception 'Råvaren tilhører et annet selskap' using errcode = '42501';
  end if;
  if not v_rm.stock_tracking then
    return jsonb_build_object('ok', true, 'skipped', 'ikke_lagerfort');
  end if;

  v_qty := coalesce(v_l.base_quantity,
                    case when lower(coalesce(v_l.unit, '')) = lower(coalesce(v_rm.base_unit, ''))
                         then v_l.quantity else null end);
  if not public.rm_is_finite(v_qty) or v_qty = 0 then
    raise exception 'Mengden kan ikke regnes om til %. Bekreft pakning eller enhet først.', v_rm.base_unit;
  end if;
  if coalesce(v_inv.is_credit_note, false) then
    -- Kreditnota er en retur. En allerede negativ mengde snus ALDRI til positiv.
    v_qty := -abs(v_qty);
  elsif v_qty < 0 then
    raise exception 'Negativ mengde på en ordinær faktura kan ikke mottas';
  end if;

  -- Allerede fysisk kvittert? Da er mottaket idempotent.
  select * into v_receipt from public.rm_goods_receipts where invoice_line_id = v_l.id;
  if found then
    return jsonb_build_object('ok', true, 'already_received', true,
                              'quantity_base', v_receipt.quantity_base,
                              'received_at', v_receipt.received_at,
                              'lot_id', v_receipt.lot_id);
  end if;

  -- Triggeren kan allerede ha ført lagerbevegelsen. Da fører vi ikke en ny,
  -- men kvitteringen registreres uansett — bokført er ikke det samme som mottatt.
  select * into v_existing
    from public.stock_movements
   where source_table = 'invoice_lines' and source_id = v_l.id
     and raw_material_id = v_l.raw_material_id;

  if found then
    v_movement_id := v_existing.id;
    if v_existing.quantity_base is distinct from v_qty then
      update public.stock_movements set quantity_base = v_qty where id = v_existing.id;
    end if;
  else
    insert into public.stock_movements (legal_entity_id, raw_material_id, movement_type, quantity_base,
                                        occurred_at, source_table, source_id, reason, note, created_by)
    values (v_inv.legal_entity_id, v_l.raw_material_id,
            case when v_qty < 0 then 'return' else 'purchase' end, v_qty,
            coalesce(v_inv.invoice_date::timestamptz, now()), 'invoice_lines', v_l.id,
            'Varemottak', coalesce(p_note, 'Mottatt fra fakturalinje'), v_uid)
    on conflict (source_table, source_id, raw_material_id) where source_id is not null
    do update set quantity_base = excluded.quantity_base
    returning id into v_movement_id;
  end if;

  -- Lot opprettes bare for faktisk tilgang (ikke retur).
  if v_qty > 0 then
    insert into public.rm_stock_lots (legal_entity_id, raw_material_id, lot_number, best_before,
                                      quantity_base, remaining_base, supplier_id, invoice_line_id, created_by)
    values (v_inv.legal_entity_id, v_l.raw_material_id, nullif(p_lot_number, ''), p_best_before,
            v_qty, v_qty, v_inv.supplier_id, v_l.id, v_uid)
    returning id into v_lot_id;
  end if;

  insert into public.rm_goods_receipts (legal_entity_id, invoice_id, invoice_line_id, raw_material_id,
                                        quantity_base, movement_id, lot_id, received_by, note)
  values (v_inv.legal_entity_id, v_inv.id, v_l.id, v_l.raw_material_id,
          v_qty, v_movement_id, v_lot_id, v_uid, p_note)
  on conflict (invoice_line_id) do nothing;

  return jsonb_build_object('ok', true, 'already_received', false,
                            'quantity_base', v_qty, 'lot_id', v_lot_id,
                            'movement_id', v_movement_id);
end;
$function$;

-- 4) Rettigheter (F1) --------------------------------------------------------
revoke all on function public.rm_stock_count_apply_v2(uuid, jsonb, text) from public, anon;
grant execute on function public.rm_stock_count_apply_v2(uuid, jsonb, text) to authenticated;
grant execute on function public.rm_stock_count_apply_v2(uuid, jsonb, text) to service_role;

revoke all on function public.rm_receive_invoice_line(uuid, text, date, text) from public, anon;
grant execute on function public.rm_receive_invoice_line(uuid, text, date, text) to authenticated;
grant execute on function public.rm_receive_invoice_line(uuid, text, date, text) to service_role;

commit;
