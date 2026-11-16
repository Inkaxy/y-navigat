-- =====================================================================================
-- PENDING 17.11.2026 · Variant B fase 3 · Automatikk: pant som følgevare, grenser for
-- nøkkelråvarer, automatisk oppdatering av køen for gamle åpne fakturaer.
-- Kjøres av root. Bare additivt: nye nullbare kolonner (null = standard), én ny tabell og
-- nye funksjoner. Endrer eller sletter INGEN eksisterende data ved kjøring, og starter ingen
-- jobb. Planlagt kjøring (cron) og engangsmerking ligger i egen fil merket DATAENDRING.
--
--  * invoice_match_settings: deposit_as_follow_item (null = på), auto_requeue_stale_enabled
--    (null = av), auto_requeue_batch_size (null = 25, maks 100), auto_requeue_min_age_days (null = 3).
--  * invoice_lines.deposit_parent_line_id: hvilken varelinje panten følger (null = følger fakturaen).
--  * rm_key_material_limits: egne prisgrenser per nøkkelråvare (lest av matchingen i et senere,
--    gjennomgått trinn; lagres og vises nå).
--  * rm_mark_deposit_follow_items(le, invoice_ids, limit, dry_run=true): åpne pantlinjer uten aktiv
--    prisobservasjon, mva 0, på åpen, ulåst faktura → følgevare (utenfor kost, ikke «Ikke vare»).
--  * rm_requeue_stale_open_invoices(le, limit, dry_run=true): eldste åpne fakturaer som ikke er
--    beregnet på N dager → vanlig omberegningskø (rm_rematch_invoices), i begrensede bolker.
--  * rm_automation_tick(): for planlagt kjøring (bare service/cron). Kalles ikke av noe ennå.
--  * rm_cap_automatikk_v1().
-- =====================================================================================
begin;

alter table public.invoice_match_settings
  add column if not exists deposit_as_follow_item boolean null,
  add column if not exists auto_requeue_stale_enabled boolean null,
  add column if not exists auto_requeue_batch_size integer null,
  add column if not exists auto_requeue_min_age_days integer null;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'ims_auto_requeue_batch_size_chk') then
    alter table public.invoice_match_settings add constraint ims_auto_requeue_batch_size_chk
      check (auto_requeue_batch_size is null or (auto_requeue_batch_size between 1 and 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ims_auto_requeue_min_age_days_chk') then
    alter table public.invoice_match_settings add constraint ims_auto_requeue_min_age_days_chk
      check (auto_requeue_min_age_days is null or (auto_requeue_min_age_days between 1 and 60));
  end if;
end $c$;

alter table public.invoice_lines add column if not exists deposit_parent_line_id uuid null;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_lines_deposit_parent_fk') then
    alter table public.invoice_lines add constraint invoice_lines_deposit_parent_fk
      foreign key (deposit_parent_line_id) references public.invoice_lines(id) on delete set null;
  end if;
end $c$;
create index if not exists ix_invoice_lines_deposit_parent on public.invoice_lines (deposit_parent_line_id) where deposit_parent_line_id is not null;

create table if not exists public.rm_key_material_limits (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null,
  raw_material_id uuid not null references public.raw_materials(id) on delete cascade,
  max_increase_pct numeric null check (max_increase_pct is null or (max_increase_pct >= 0 and max_increase_pct <= 500)),
  min_impact_nok numeric null check (min_impact_nok is null or min_impact_nok >= 0),
  note text null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_by uuid null,
  updated_at timestamptz not null default now(),
  unique (legal_entity_id, raw_material_id)
);
grant select on public.rm_key_material_limits to authenticated;
grant insert, update, delete on public.rm_key_material_limits to authenticated;
grant all on public.rm_key_material_limits to service_role;
alter table public.rm_key_material_limits enable row level security;
drop policy if exists rmkml_select on public.rm_key_material_limits;
create policy rmkml_select on public.rm_key_material_limits for select to authenticated
  using (public.has_ravarer_invoice_read_or_owner(legal_entity_id));
drop policy if exists rmkml_write on public.rm_key_material_limits;
create policy rmkml_write on public.rm_key_material_limits for all to authenticated
  using (public.has_ravarer_invoice_access(legal_entity_id, 'admin'))
  with check (public.has_ravarer_invoice_access(legal_entity_id, 'admin')
              and exists (select 1 from public.raw_materials rm where rm.id = raw_material_id and rm.legal_entity_id = rm_key_material_limits.legal_entity_id));
drop trigger if exists trg_rm_key_material_limits_updated on public.rm_key_material_limits;
create trigger trg_rm_key_material_limits_updated before update on public.rm_key_material_limits
  for each row execute function public.tg_set_updated_at();

create or replace function public.rm_mark_deposit_follow_items(p_legal_entity_id uuid, p_invoice_ids uuid[] default null,
                                                               p_limit integer default 200, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_limit int := greatest(1, least(500, coalesce(p_limit, 200)));
  r record; v_parent uuid;
  v_marked jsonb := '[]'::jsonb; v_skipped jsonb := '[]'::jsonb; v_n int := 0;
begin
  if v_uid is not null and not public.has_ravarer_invoice_access(p_legal_entity_id, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer' using errcode = '42501';
  end if;
  if v_uid is null and coalesce(current_user, '') not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Krever pålogging' using errcode = '28000';
  end if;
  for r in
    select il.id, il.invoice_id, il.line_number, il.description, il.vat_rate, il.raw_material_id, il.match_confidence, i.invoice_number
      from public.invoice_lines il join public.invoices i on i.id = il.invoice_id
     where i.legal_entity_id = p_legal_entity_id
       and (p_invoice_ids is null or i.id = any(p_invoice_ids))
       and il.line_kind = 'pant' and il.requires_review
       and coalesce(il.match_confidence, '') <> 'not_applicable' and il.excluded_at is null
       and i.status in ('imported','needs_review','ready') and i.flagged_at is null and i.reconciled_at is null
       and not exists (select 1 from public.invoice_internal_approvals a where a.invoice_id = i.id and a.status = 'approved' and a.revoked_at is null)
       and not exists (select 1 from public.invoice_line_cost_postings p where p.invoice_line_id = il.id and p.revoked_at is null)
     order by i.invoice_date asc, i.id, il.line_number nulls last, il.id
     limit v_limit
  loop
    if coalesce(r.vat_rate, 0) <> 0 then
      v_skipped := v_skipped || jsonb_build_object('id', r.id, 'invoice_number', r.invoice_number, 'reason', 'mva_ikke_null'); continue;
    end if;
    if exists (select 1 from public.raw_material_price_history h where h.invoice_line_id = r.id and h.superseded_at is null) then
      v_skipped := v_skipped || jsonb_build_object('id', r.id, 'invoice_number', r.invoice_number, 'reason', 'prisobservasjon'); continue;
    end if;
    -- Følger nærmeste varelinje over på samme faktura (ellers fakturaen som helhet).
    select x.id into v_parent from public.invoice_lines x
     where x.invoice_id = r.invoice_id and x.id <> r.id and coalesce(x.line_kind, 'vare') = 'vare'
       and r.line_number is not null and x.line_number is not null and x.line_number < r.line_number
     order by x.line_number desc limit 1;
    v_n := v_n + 1;
    v_marked := v_marked || jsonb_build_object('id', r.id, 'invoice_id', r.invoice_id, 'invoice_number', r.invoice_number,
                                               'description', r.description, 'parent_line_id', v_parent);
    if not coalesce(p_dry_run, true) then
      update public.invoice_lines
         set match_confidence = 'not_applicable', raw_material_id = null, requires_review = false, review_reason = null,
             price_per_base_unit = null, base_quantity = null, expected_price_per_base_unit = null,
             price_variance_pct = null, variance_status = null,
             resolution_note = 'Pant – følgevare (utenfor kost, mva-fri)', resolved_by = v_uid, resolved_at = now(),
             deposit_parent_line_id = v_parent, updated_at = now()
       where id = r.id;
    end if;
  end loop;
  if not coalesce(p_dry_run, true) and v_n > 0 then
    insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
    values (v_uid, 'invoice_lines.deposit_follow_items', 'legal_entity', p_legal_entity_id, p_legal_entity_id,
            jsonb_build_object('lines', v_marked), 'Pant merket som følgevare', 'ravarer');
  end if;
  return jsonb_build_object('ok', true, 'dry_run', coalesce(p_dry_run, true), 'marked', v_n, 'lines', v_marked, 'skipped', v_skipped);
end
$fn$;

create or replace function public.rm_requeue_stale_open_invoices(p_legal_entity_id uuid, p_limit integer default null, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_set public.invoice_match_settings%rowtype;
  v_limit int; v_age int; v_ids uuid[]; v_list jsonb; v_res jsonb := null;
begin
  select * into v_set from public.invoice_match_settings where legal_entity_id = p_legal_entity_id;
  if v_uid is not null then
    if not public.has_ravarer_invoice_access(p_legal_entity_id, 'write') then
      raise exception 'Mangler skrivetilgang til fakturaer' using errcode = '42501';
    end if;
  else
    if coalesce(current_user, '') not in ('postgres', 'service_role', 'supabase_admin') then
      raise exception 'Krever pålogging' using errcode = '28000';
    end if;
    -- Planlagt kjøring bare når bryteren er slått på.
    if not coalesce(v_set.auto_requeue_stale_enabled, false) then
      return jsonb_build_object('ok', true, 'skipped', 'av', 'queued', 0);
    end if;
  end if;
  v_limit := greatest(1, least(100, coalesce(p_limit, v_set.auto_requeue_batch_size, 25)));
  v_age := greatest(1, least(60, coalesce(v_set.auto_requeue_min_age_days, 3)));
  select coalesce(array_agg(t.id order by t.invoice_date, t.created_at), '{}'),
         coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'invoice_number', t.invoice_number, 'invoice_date', t.invoice_date,
                                               'last_run', t.last_run) order by t.invoice_date, t.created_at), '[]'::jsonb)
    into v_ids, v_list
    from (
      select i.id, i.invoice_number, i.invoice_date, i.created_at,
             (select max(q.finished_at) from public.rm_rematch_queue q where q.invoice_id = i.id) as last_run
        from public.invoices i
       where i.legal_entity_id = p_legal_entity_id
         and i.status in ('imported','needs_review','ready') and i.flagged_at is null
         and exists (select 1 from public.invoice_lines l where l.invoice_id = i.id and l.requires_review)
         and not exists (select 1 from public.rm_rematch_queue q where q.invoice_id = i.id and q.status in ('queued','dispatched'))
         and coalesce((select max(coalesce(q.finished_at, q.queued_at)) from public.rm_rematch_queue q where q.invoice_id = i.id), i.created_at)
             < now() - make_interval(days => v_age)
       order by i.invoice_date asc, i.created_at asc
       limit v_limit
    ) t;
  if coalesce(p_dry_run, true) or cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', true, 'dry_run', coalesce(p_dry_run, true), 'candidates', cardinality(v_ids), 'invoices', v_list,
                              'limit', v_limit, 'min_age_days', v_age, 'queued', 0);
  end if;
  v_res := public.rm_rematch_invoices(p_legal_entity_id, v_limit, v_ids, true);
  return jsonb_build_object('ok', true, 'dry_run', false, 'candidates', cardinality(v_ids), 'invoices', v_list,
                            'limit', v_limit, 'min_age_days', v_age, 'queued', coalesce((v_res->>'queued')::int, 0),
                            'already_queued', coalesce((v_res->>'already_queued')::int, 0));
end
$fn$;

create or replace function public.rm_automation_tick()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare r record; v_out jsonb := '[]'::jsonb; v_a jsonb; v_b jsonb;
begin
  if auth.uid() is not null then raise exception 'Bare planlagt kjøring' using errcode = '42501'; end if;
  for r in select legal_entity_id, deposit_as_follow_item, auto_requeue_stale_enabled from public.invoice_match_settings loop
    v_a := null; v_b := null;
    if coalesce(r.deposit_as_follow_item, true) then
      v_a := public.rm_mark_deposit_follow_items(r.legal_entity_id, null, 100, false);
    end if;
    if coalesce(r.auto_requeue_stale_enabled, false) then
      v_b := public.rm_requeue_stale_open_invoices(r.legal_entity_id, null, false);
    end if;
    v_out := v_out || jsonb_build_object('legal_entity_id', r.legal_entity_id,
      'deposit_marked', coalesce((v_a->>'marked')::int, 0), 'requeued', coalesce((v_b->>'queued')::int, 0));
  end loop;
  return jsonb_build_object('ok', true, 'entities', v_out);
end
$fn$;

create or replace function public.rm_cap_automatikk_v1()
returns boolean language sql stable security invoker set search_path to 'public' as $fn$ select true $fn$;

revoke all on function public.rm_mark_deposit_follow_items(uuid, uuid[], integer, boolean) from public, anon;
revoke all on function public.rm_requeue_stale_open_invoices(uuid, integer, boolean) from public, anon;
revoke all on function public.rm_automation_tick() from public, anon, authenticated;
revoke all on function public.rm_cap_automatikk_v1() from public, anon;
grant execute on function public.rm_mark_deposit_follow_items(uuid, uuid[], integer, boolean) to authenticated, service_role;
grant execute on function public.rm_requeue_stale_open_invoices(uuid, integer, boolean) to authenticated, service_role;
grant execute on function public.rm_automation_tick() to service_role;
grant execute on function public.rm_cap_automatikk_v1() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
