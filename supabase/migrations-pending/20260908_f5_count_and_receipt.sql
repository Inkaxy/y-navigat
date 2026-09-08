-- F5 — Vedvarende telleark, konfliktkontroll, idempotent telling og varemottak.
--
-- Rulles ut manuelt (ikke kjørt av agenten). Forutsetninger lest fra live-basen 8. sep 2026:
--   * stock_movements har unik (source_table, source_id, raw_material_id) der source_id ikke er null
--     (brukt av stock_from_invoice_line sin ON CONFLICT).
--   * rm_stock_count_apply finnes uten låsing/idempotens — den beholdes urørt slik at
--     eventuelle andre kallere ikke brytes. Ny kontrakt er rm_stock_count_apply_v2.
--   * has_position_in_entity(uuid) og has_app_write_access(text) finnes.

begin;

-- 1) Vedvarende telleark ------------------------------------------------------
create table if not exists public.rm_stock_count_sheets (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  count_date date not null,
  op_id uuid not null unique,
  status text not null default 'draft' check (status in ('draft', 'applied', 'discarded')),
  note text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  applied_at timestamptz,
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
  );

drop policy if exists "rm_count_sheets_update" on public.rm_stock_count_sheets;
create policy "rm_count_sheets_update" on public.rm_stock_count_sheets
  for update to authenticated
  using (
    public.has_position_in_entity(legal_entity_id)
    and (public.has_app_write_access('ravarer') or public.has_app_write_access('lager'))
  )
  with check (public.has_position_in_entity(legal_entity_id));

drop policy if exists "rm_count_sheets_delete" on public.rm_stock_count_sheets;
create policy "rm_count_sheets_delete" on public.rm_stock_count_sheets
  for delete to authenticated
  using (
    public.has_position_in_entity(legal_entity_id)
    and (public.has_app_write_access('ravarer') or public.has_app_write_access('lager'))
    and status = 'draft'
  );

create index if not exists ix_rm_count_sheets_entity_date
  on public.rm_stock_count_sheets (legal_entity_id, count_date desc);

drop trigger if exists trg_rm_count_sheets_updated_at on public.rm_stock_count_sheets;
create trigger trg_rm_count_sheets_updated_at
  before update on public.rm_stock_count_sheets
  for each row execute function public.update_updated_at_column();

-- 2) Telling med konfliktkontroll, fast låserekkefølge og idempotens ---------
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
  v_name text;
  v_current numeric;
  v_diff numeric;
  v_adjusted int := 0;
  v_unchanged int := 0;
  v_rows jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_sheet rm_stock_count_sheets%rowtype;
  v_result jsonb;
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

  -- Idempotens: samme operasjons-ID bokfører aldri to ganger.
  select * into v_sheet from public.rm_stock_count_sheets where op_id = p_op_id for update;
  if found and v_sheet.status = 'applied' then
    return coalesce(v_sheet.result, jsonb_build_object('ok', true, 'already_applied', true))
           || jsonb_build_object('already_applied', true);
  end if;

  -- Fast låserekkefølge på råvarene, slik at to samtidige tellinger ikke låser hverandre i vranglås.
  perform 1
     from public.raw_materials rm
    where rm.id in (select (x->>'raw_material_id')::uuid from jsonb_array_elements(p_lines) x)
    order by rm.id
      for update;

  for e in
    select (x->>'raw_material_id')::uuid as raw_material_id,
           (x->>'counted_base')::numeric as counted,
           nullif(x->>'expected_base', '')::numeric as expected,
           nullif(x->>'line_note', '') as line_note
      from jsonb_array_elements(p_lines) x
     order by 1
  loop
    if e.counted is null or e.counted < 0 or not (e.counted = e.counted) then
      raise exception 'Ugyldig telletall';
    end if;

    select rm.legal_entity_id, rm.name, coalesce(rm.current_stock, 0)
      into v_entity, v_name, v_current
      from public.raw_materials rm
     where rm.id = e.raw_material_id and rm.stock_tracking;
    if v_entity is null then
      raise exception 'Varen finnes ikke eller er ikke lagerført';
    end if;
    if not (public.has_position_in_entity(v_entity)
            and (public.has_app_write_access('ravarer') or public.has_app_write_access('lager'))) then
      raise exception 'Ingen skrivetilgang' using errcode = '42501';
    end if;

    -- Konfliktkontroll: beholdningen kan ha endret seg mens tellingen pågikk.
    if e.expected is not null and e.expected is distinct from v_current then
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
        nullif(concat_ws(' | ', p_note, e.line_note), ''), v_uid)
      on conflict (source_table, source_id, raw_material_id) where source_id is not null
      do nothing;
      v_adjusted := v_adjusted + 1;
    else
      v_unchanged := v_unchanged + 1;
    end if;

    v_rows := v_rows || jsonb_build_object('raw_material_id', e.raw_material_id, 'name', v_name,
      'before', v_current, 'counted', e.counted, 'diff', v_diff);
  end loop;

  -- Konflikt stopper HELE tellingen: transaksjonen rulles tilbake og utkastet består i klienten.
  if jsonb_array_length(v_conflicts) > 0 then
    raise exception 'Beholdningen er endret av andre for % varer siden tellingen startet: %',
      jsonb_array_length(v_conflicts),
      (select string_agg(c->>'name', ', ') from jsonb_array_elements(v_conflicts) c)
      using errcode = '40001';
  end if;

  v_result := jsonb_build_object('ok', true, 'adjusted', v_adjusted, 'unchanged', v_unchanged,
                                 'rows', v_rows, 'op_id', p_op_id);

  if found or v_sheet.id is not null then
    update public.rm_stock_count_sheets
       set status = 'applied', applied_at = now(), result = v_result, note = coalesce(p_note, note)
     where op_id = p_op_id;
  else
    insert into public.rm_stock_count_sheets (legal_entity_id, count_date, op_id, status, note,
                                              payload, result, applied_at, created_by)
    values (v_entity, current_date, p_op_id, 'applied', p_note, p_lines, v_result, now(), v_uid)
    on conflict (op_id) do update
      set status = 'applied', applied_at = now(), result = excluded.result;
  end if;

  return v_result;
end;
$function$;

-- 3) Idempotent varemottak per fakturalinje ----------------------------------
-- Fakturalinje-triggeren stock_from_invoice_line fører allerede bevegelsen
-- (source_table = 'invoice_lines'). Mottaket skal derfor ALDRI føre en ny bevegelse
-- på toppen, bare kvittere ut linjen — og aldri snu en negativ kreditmengde til positiv.
create or replace function public.rm_receive_invoice_line(p_line_id uuid)
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
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Du må være innlogget for å motta varer' using errcode = '28000';
  end if;

  select * into v_l from public.invoice_lines where id = p_line_id for update;
  if not found then raise exception 'Fakturalinjen finnes ikke' using errcode = 'P0002'; end if;

  select * into v_inv from public.invoices where id = v_l.invoice_id for update;
  if not found then raise exception 'Fakturaen finnes ikke' using errcode = 'P0002'; end if;

  if not public.has_ravarer_invoice_access(v_inv.legal_entity_id, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer' using errcode = '42501';
  end if;

  if v_l.raw_material_id is null then
    raise exception 'Linjen er ikke koblet til en råvare';
  end if;

  select * into v_rm from public.raw_materials where id = v_l.raw_material_id;
  if not found then raise exception 'Råvaren finnes ikke'; end if;
  if v_rm.legal_entity_id <> v_inv.legal_entity_id then
    raise exception 'Råvaren tilhører et annet selskap' using errcode = '42501';
  end if;
  if not v_rm.stock_tracking then
    return jsonb_build_object('ok', true, 'skipped', 'ikke_lagerfort');
  end if;

  -- Allerede ført av triggeren? Da er mottaket idempotent uten ny bevegelse.
  select * into v_existing
    from public.stock_movements
   where source_table = 'invoice_lines' and source_id = v_l.id and raw_material_id = v_l.raw_material_id;
  if found then
    return jsonb_build_object('ok', true, 'already_posted', true,
                              'quantity_base', v_existing.quantity_base,
                              'movement_id', v_existing.id);
  end if;

  v_qty := coalesce(v_l.base_quantity,
                    case when lower(coalesce(v_l.unit, '')) = lower(coalesce(v_rm.base_unit, ''))
                         then v_l.quantity else null end);
  if v_qty is null or v_qty = 0 then
    raise exception 'Mengden kan ikke regnes om til %. Bekreft pakning eller enhet først.', v_rm.base_unit;
  end if;

  -- Kreditnota er en retur. En allerede negativ mengde snus ALDRI til positiv.
  if coalesce(v_inv.is_credit_note, false) then
    v_qty := -abs(v_qty);
  end if;

  insert into public.stock_movements (legal_entity_id, raw_material_id, movement_type, quantity_base,
                                      occurred_at, source_table, source_id, reason, note, created_by)
  values (v_inv.legal_entity_id, v_l.raw_material_id,
          case when v_qty < 0 then 'return' else 'purchase' end, v_qty,
          coalesce(v_inv.invoice_date::timestamptz, now()), 'invoice_lines', v_l.id,
          'Varemottak', 'Mottatt fra fakturalinje', v_uid)
  on conflict (source_table, source_id, raw_material_id) where source_id is not null
  do nothing;

  return jsonb_build_object('ok', true, 'already_posted', false, 'quantity_base', v_qty);
end;
$function$;

-- 4) Rettigheter (F1) --------------------------------------------------------
revoke all on function public.rm_stock_count_apply_v2(uuid, jsonb, text) from public, anon;
grant execute on function public.rm_stock_count_apply_v2(uuid, jsonb, text) to authenticated;
grant execute on function public.rm_stock_count_apply_v2(uuid, jsonb, text) to service_role;

revoke all on function public.rm_receive_invoice_line(uuid) from public, anon;
grant execute on function public.rm_receive_invoice_line(uuid) to authenticated;
grant execute on function public.rm_receive_invoice_line(uuid) to service_role;

commit;
