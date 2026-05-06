
do $$ begin
  create type negotiation_status as enum ('draft','invited','in_progress','concluded','cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type negotiation_recipient_status as enum ('invited','viewed','responded','declined','expired','locked');
exception when duplicate_object then null; end $$;
do $$ begin
  create type negotiation_response_status as enum ('draft','submitted','withdrawn');
exception when duplicate_object then null; end $$;

create table if not exists public.negotiations (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null,
  title text not null,
  purpose text,
  contract_start date,
  contract_end date,
  baseline_period_start date,
  baseline_period_end date,
  response_deadline timestamptz,
  status negotiation_status not null default 'draft',
  notes text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  concluded_at timestamptz,
  archived_at timestamptz
);
create index if not exists idx_negotiations_legal_entity on public.negotiations(legal_entity_id);
create index if not exists idx_negotiations_status on public.negotiations(status);

create table if not exists public.negotiation_items (
  id uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references public.negotiations(id) on delete cascade,
  raw_material_id uuid not null references public.raw_materials(id) on delete cascade,
  expected_annual_volume numeric,
  expected_annual_volume_unit text,
  actual_volume_baseline numeric,
  actual_cost_baseline numeric,
  actual_avg_price_baseline numeric,
  target_price numeric,
  suggested_package_size numeric,
  suggested_package_unit text,
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (negotiation_id, raw_material_id)
);
create index if not exists idx_neg_items_negotiation on public.negotiation_items(negotiation_id);

create table if not exists public.negotiation_recipients (
  id uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references public.negotiations(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  contact_email text,
  contact_name text,
  access_token text not null unique,
  password_hash text,
  password_set_at timestamptz,
  password_expires_at timestamptz,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  status negotiation_recipient_status not null default 'invited',
  invited_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  responded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (negotiation_id, supplier_id)
);
create index if not exists idx_neg_recipients_negotiation on public.negotiation_recipients(negotiation_id);
create index if not exists idx_neg_recipients_token on public.negotiation_recipients(access_token);

create table if not exists public.negotiation_responses (
  id uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references public.negotiations(id) on delete cascade,
  recipient_id uuid not null references public.negotiation_recipients(id) on delete cascade,
  negotiation_item_id uuid not null references public.negotiation_items(id) on delete cascade,
  offered_price numeric,
  offered_package_size numeric,
  offered_package_unit text,
  contract_length_months int,
  min_order_volume numeric,
  min_order_unit text,
  payment_terms text,
  delivery_terms text,
  datasheet_url text,
  notes text,
  status negotiation_response_status not null default 'draft',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipient_id, negotiation_item_id)
);
create index if not exists idx_neg_responses_negotiation on public.negotiation_responses(negotiation_id);
create index if not exists idx_neg_responses_recipient on public.negotiation_responses(recipient_id);

create table if not exists public.negotiation_messages (
  id uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references public.negotiations(id) on delete cascade,
  recipient_id uuid references public.negotiation_recipients(id) on delete cascade,
  event_type text not null,
  actor text,
  ip_address text,
  user_agent text,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_neg_messages_negotiation on public.negotiation_messages(negotiation_id);
create index if not exists idx_neg_messages_recipient on public.negotiation_messages(recipient_id);

create table if not exists public.negotiation_outcomes (
  id uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references public.negotiations(id) on delete cascade,
  negotiation_item_id uuid not null references public.negotiation_items(id) on delete cascade,
  winner_recipient_id uuid references public.negotiation_recipients(id) on delete set null,
  winner_response_id uuid references public.negotiation_responses(id) on delete set null,
  agreed_price numeric,
  agreed_package_size numeric,
  agreed_package_unit text,
  set_as_primary boolean not null default false,
  applied_to_supplier boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (negotiation_id, negotiation_item_id)
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_negotiations_touch on public.negotiations;
create trigger trg_negotiations_touch before update on public.negotiations
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_neg_recipients_touch on public.negotiation_recipients;
create trigger trg_neg_recipients_touch before update on public.negotiation_recipients
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_neg_responses_touch on public.negotiation_responses;
create trigger trg_neg_responses_touch before update on public.negotiation_responses
  for each row execute function public.touch_updated_at();

alter table public.negotiations enable row level security;
alter table public.negotiation_items enable row level security;
alter table public.negotiation_recipients enable row level security;
alter table public.negotiation_responses enable row level security;
alter table public.negotiation_messages enable row level security;
alter table public.negotiation_outcomes enable row level security;

create or replace function public.has_negotiation_read(_legal_entity_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.has_ravarer_invoice_access(_legal_entity_id, 'read');
$$;

create or replace function public.has_negotiation_write(_legal_entity_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.has_ravarer_invoice_access(_legal_entity_id, 'write');
$$;

drop policy if exists negotiations_select on public.negotiations;
create policy negotiations_select on public.negotiations for select to authenticated
  using (public.has_negotiation_read(legal_entity_id));
drop policy if exists negotiations_modify on public.negotiations;
create policy negotiations_modify on public.negotiations for all to authenticated
  using (public.has_negotiation_write(legal_entity_id))
  with check (public.has_negotiation_write(legal_entity_id));

drop policy if exists neg_items_select on public.negotiation_items;
create policy neg_items_select on public.negotiation_items for select to authenticated
  using (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_read(n.legal_entity_id)));
drop policy if exists neg_items_modify on public.negotiation_items;
create policy neg_items_modify on public.negotiation_items for all to authenticated
  using (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_write(n.legal_entity_id)))
  with check (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_write(n.legal_entity_id)));

drop policy if exists neg_recipients_select on public.negotiation_recipients;
create policy neg_recipients_select on public.negotiation_recipients for select to authenticated
  using (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_read(n.legal_entity_id)));
drop policy if exists neg_recipients_modify on public.negotiation_recipients;
create policy neg_recipients_modify on public.negotiation_recipients for all to authenticated
  using (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_write(n.legal_entity_id)))
  with check (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_write(n.legal_entity_id)));

drop policy if exists neg_responses_select on public.negotiation_responses;
create policy neg_responses_select on public.negotiation_responses for select to authenticated
  using (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_read(n.legal_entity_id)));
drop policy if exists neg_responses_modify on public.negotiation_responses;
create policy neg_responses_modify on public.negotiation_responses for all to authenticated
  using (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_write(n.legal_entity_id)))
  with check (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_write(n.legal_entity_id)));

drop policy if exists neg_messages_select on public.negotiation_messages;
create policy neg_messages_select on public.negotiation_messages for select to authenticated
  using (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_read(n.legal_entity_id)));
drop policy if exists neg_messages_modify on public.negotiation_messages;
create policy neg_messages_modify on public.negotiation_messages for all to authenticated
  using (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_write(n.legal_entity_id)))
  with check (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_write(n.legal_entity_id)));

drop policy if exists neg_outcomes_select on public.negotiation_outcomes;
create policy neg_outcomes_select on public.negotiation_outcomes for select to authenticated
  using (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_read(n.legal_entity_id)));
drop policy if exists neg_outcomes_modify on public.negotiation_outcomes;
create policy neg_outcomes_modify on public.negotiation_outcomes for all to authenticated
  using (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_write(n.legal_entity_id)))
  with check (exists (select 1 from public.negotiations n where n.id = negotiation_id and public.has_negotiation_write(n.legal_entity_id)));

create or replace function public.gen_rfq_token()
returns text language plpgsql security definer set search_path=public,extensions as $$
declare v_bytes bytea;
begin
  v_bytes := gen_random_bytes(24);
  return replace(replace(replace(encode(v_bytes,'base64'),'+','-'),'/','_'),'=','');
end $$;

create or replace function public.gen_rfq_password()
returns text language plpgsql security definer set search_path=public,extensions as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; result text := ''; i int;
begin
  for i in 1..6 loop
    result := result || substr(alphabet, 1 + (floor(random() * length(alphabet))::int), 1);
  end loop;
  return result;
end $$;

create or replace function public.set_rfq_password(p_recipient_id uuid)
returns text language plpgsql security definer set search_path=public,extensions as $$
declare v_pw text; v_le uuid;
begin
  select n.legal_entity_id into v_le
    from public.negotiation_recipients nr
    join public.negotiations n on n.id = nr.negotiation_id
   where nr.id = p_recipient_id;
  if v_le is null then raise exception 'Recipient not found'; end if;
  if not public.has_ravarer_invoice_access(v_le, 'write') then
    raise exception 'Not authorized';
  end if;
  v_pw := public.gen_rfq_password();
  update public.negotiation_recipients
     set password_hash = crypt(v_pw, gen_salt('bf', 10)),
         password_set_at = now(),
         password_expires_at = now() + interval '5 minutes',
         failed_attempts = 0,
         locked_until = null,
         invited_at = coalesce(invited_at, now())
   where id = p_recipient_id;
  return v_pw;
end $$;

create or replace function public.negotiation_recipient_by_token(p_token text, p_password text)
returns table (
  recipient_id uuid,
  negotiation_id uuid,
  supplier_id uuid,
  status text,
  expires_at timestamptz,
  negotiation_title text,
  response_deadline timestamptz,
  result text
)
language plpgsql security definer set search_path=public,extensions as $$
declare r record;
begin
  select nr.*, n.title as ntitle, n.response_deadline as ndl
    into r
    from public.negotiation_recipients nr
    join public.negotiations n on n.id = nr.negotiation_id
   where nr.access_token = p_token
   limit 1;

  if not found then
    return query select null::uuid, null::uuid, null::uuid, null::text, null::timestamptz, null::text, null::timestamptz, 'invalid_token';
    return;
  end if;

  if r.expires_at < now() then
    return query select r.id, r.negotiation_id, r.supplier_id, r.status::text, r.expires_at, r.ntitle, r.ndl, 'expired';
    return;
  end if;

  if r.locked_until is not null and r.locked_until > now() then
    return query select r.id, r.negotiation_id, r.supplier_id, r.status::text, r.expires_at, r.ntitle, r.ndl, 'locked';
    return;
  end if;

  if r.password_hash is null or r.password_hash <> crypt(p_password, r.password_hash) then
    update public.negotiation_recipients
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '24 hours' else locked_until end,
           status = case when failed_attempts + 1 >= 5 then 'locked'::negotiation_recipient_status else status end
     where id = r.id;
    return query select r.id, r.negotiation_id, r.supplier_id, r.status::text, r.expires_at, r.ntitle, r.ndl, 'wrong_password';
    return;
  end if;

  update public.negotiation_recipients
     set failed_attempts = 0,
         first_viewed_at = coalesce(first_viewed_at, now()),
         last_viewed_at = now(),
         status = case when status = 'invited' then 'viewed'::negotiation_recipient_status else status end
   where id = r.id;

  return query select r.id, r.negotiation_id, r.supplier_id, r.status::text, r.expires_at, r.ntitle, r.ndl, 'ok';
end $$;

revoke all on function public.negotiation_recipient_by_token(text,text) from public;
grant execute on function public.negotiation_recipient_by_token(text,text) to anon, authenticated;

create or replace function public.set_rfq_token_default()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
begin
  if new.access_token is null or new.access_token = '' then
    new.access_token := public.gen_rfq_token();
  end if;
  return new;
end $$;
drop trigger if exists trg_neg_recipients_token on public.negotiation_recipients;
create trigger trg_neg_recipients_token before insert on public.negotiation_recipients
  for each row execute function public.set_rfq_token_default();
