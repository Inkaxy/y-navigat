alter table public.negotiations
  add column if not exists negotiation_mode text not null default 'rfq',
  add column if not exists live_session_started_at timestamptz,
  add column if not exists live_session_ended_at timestamptz,
  add column if not exists live_facilitator_id uuid references auth.users(id),
  add column if not exists live_location_format text;

alter table public.negotiations drop constraint if exists negotiations_mode_check;
alter table public.negotiations add constraint negotiations_mode_check check (negotiation_mode in ('rfq','live'));

alter table public.negotiations drop constraint if exists negotiations_location_format_check;
alter table public.negotiations add constraint negotiations_location_format_check
  check (live_location_format is null or live_location_format in ('physical','video','phone'));

alter table public.negotiation_items
  add column if not exists live_status text default 'pending',
  add column if not exists live_agreed_price numeric,
  add column if not exists live_agreed_price_unit text,
  add column if not exists live_agreed_package_size numeric,
  add column if not exists live_agreed_package_unit text,
  add column if not exists live_agreed_price_per_base_unit numeric,
  add column if not exists live_agreed_contract_months int,
  add column if not exists live_agreed_min_volume numeric,
  add column if not exists live_agreed_min_volume_unit text,
  add column if not exists live_agreed_payment_terms_days int,
  add column if not exists live_agreed_at timestamptz,
  add column if not exists live_agreed_by uuid references auth.users(id),
  add column if not exists live_notes text;

alter table public.negotiation_items drop constraint if exists negotiation_items_live_status_check;
alter table public.negotiation_items add constraint negotiation_items_live_status_check
  check (live_status in ('pending','discussing','tentatively_agreed','agreed','declined','parked'));

create table if not exists public.negotiation_live_events (
  id uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references public.negotiations(id) on delete cascade,
  negotiation_item_id uuid references public.negotiation_items(id) on delete cascade,
  event_type text not null,
  event_data jsonb,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists negotiation_live_events_neg_created_idx
  on public.negotiation_live_events (negotiation_id, created_at);

alter table public.negotiation_live_events enable row level security;

drop policy if exists "live_events_select" on public.negotiation_live_events;
create policy "live_events_select" on public.negotiation_live_events
  for select to authenticated
  using (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_read(n.legal_entity_id)));

drop policy if exists "live_events_modify" on public.negotiation_live_events;
create policy "live_events_modify" on public.negotiation_live_events
  for all to authenticated
  using (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_write(n.legal_entity_id)))
  with check (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_write(n.legal_entity_id)));