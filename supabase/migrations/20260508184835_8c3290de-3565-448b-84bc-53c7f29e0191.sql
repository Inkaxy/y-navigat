
-- ============================================================
-- Fase B: Customer groups (M2M with price-list inheritance)
-- ============================================================

create table public.customer_groups (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null,
  code text not null,
  display_name text not null,
  description text,
  color_hex text,
  default_price_list_id uuid references public.price_lists(id) on delete set null,
  sort_order integer not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  constraint customer_groups_status_chk check (status in ('active','archived')),
  constraint customer_groups_code_unique unique (legal_entity_id, code)
);

create index customer_groups_legal_entity_idx on public.customer_groups(legal_entity_id);
create index customer_groups_status_idx on public.customer_groups(status);

alter table public.customer_groups enable row level security;

create policy "cg_select_in_entity" on public.customer_groups
  for select
  using (has_position_in_entity(legal_entity_id) or is_platform_admin());

create policy "cg_insert_write" on public.customer_groups
  for insert
  with check (has_position_in_entity(legal_entity_id) and has_app_write_access('kunder'::text));

create policy "cg_update_write" on public.customer_groups
  for update
  using (has_position_in_entity(legal_entity_id) and has_app_write_access('kunder'::text))
  with check (has_position_in_entity(legal_entity_id) and has_app_write_access('kunder'::text));

create policy "cg_delete_write" on public.customer_groups
  for delete
  using (has_position_in_entity(legal_entity_id) and has_app_write_access('kunder'::text));

create trigger update_customer_groups_updated_at
before update on public.customer_groups
for each row execute function public.update_updated_at_column();

-- ============================================================
-- Members M2M
-- ============================================================

create table public.customer_group_members (
  customer_id uuid not null references public.customers(id) on delete cascade,
  group_id uuid not null references public.customer_groups(id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid,
  primary key (customer_id, group_id)
);

create index customer_group_members_group_idx on public.customer_group_members(group_id);
create index customer_group_members_customer_idx on public.customer_group_members(customer_id);

alter table public.customer_group_members enable row level security;

create policy "cgm_select_in_entity" on public.customer_group_members
  for select
  using (
    exists (
      select 1 from public.customer_groups g
      where g.id = customer_group_members.group_id
        and (has_position_in_entity(g.legal_entity_id) or is_platform_admin())
    )
  );

create policy "cgm_insert_write" on public.customer_group_members
  for insert
  with check (
    exists (
      select 1 from public.customer_groups g
      where g.id = customer_group_members.group_id
        and has_position_in_entity(g.legal_entity_id)
        and has_app_write_access('kunder'::text)
    )
  );

create policy "cgm_delete_write" on public.customer_group_members
  for delete
  using (
    exists (
      select 1 from public.customer_groups g
      where g.id = customer_group_members.group_id
        and has_position_in_entity(g.legal_entity_id)
        and has_app_write_access('kunder'::text)
    )
  );

-- ============================================================
-- Effective price-list resolver
-- Priority: customer.default_price_list_id > group.default_price_list_id (lowest sort_order)
-- ============================================================

create or replace function public.customer_effective_price_list(_customer_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select c.default_price_list_id from public.customers c where c.id = _customer_id),
    (
      select g.default_price_list_id
      from public.customer_group_members m
      join public.customer_groups g on g.id = m.group_id
      where m.customer_id = _customer_id
        and g.status = 'active'
        and g.default_price_list_id is not null
      order by g.sort_order asc, g.created_at asc
      limit 1
    )
  );
$$;
