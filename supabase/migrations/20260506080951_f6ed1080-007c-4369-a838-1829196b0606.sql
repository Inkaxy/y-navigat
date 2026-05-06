
create extension if not exists pg_trgm;

insert into apps (code, display_name, description, access_pattern, status, category, sort_order, start_path, deploy_url, color_hex)
values ('fakturaer', 'Fakturaer', 'Inngående fakturaer, EHF-import og auto-matching mot råvarer', 'multi_company', 'active', 'finance', 33, '/fakturaer', 'https://nbhub.no', '#4F46E5')
on conflict (code) do nothing;

create or replace function public.has_fakturaer_access(_legal_entity_id uuid, _required_level text default 'read')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_positions up
    join position_app_access paa on paa.position_id = up.position_id
    join apps a on a.id = paa.app_id
    where up.user_id = auth.uid()
      and a.code = 'fakturaer'
      and up.legal_entity_id = _legal_entity_id
      and (
        _required_level = 'read'
        or (_required_level = 'write' and paa.level in ('write','admin'))
        or (_required_level = 'admin' and paa.level = 'admin')
      )
  )
$$;

create or replace function public.has_fakturaer_read_or_owner(_legal_entity_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_fakturaer_access(_legal_entity_id, 'read')
    or exists (
      select 1 from user_positions up
      join positions p on p.id = up.position_id
      where up.user_id = auth.uid() and p.is_owner = true
    )
$$;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id) on delete cascade,
  supplier_id uuid not null references suppliers(id),
  invoice_number text not null,
  invoice_date date not null,
  due_date date,
  total_amount numeric,
  total_vat numeric,
  currency text default 'NOK',
  status text not null default 'pending',
  source text,
  source_document_url text,
  ehf_payload jsonb,
  imported_at timestamptz default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (legal_entity_id, supplier_id, invoice_number)
);
create index on invoices (legal_entity_id, status);
create index on invoices (legal_entity_id, invoice_date desc);
create index on invoices (supplier_id);
create trigger trg_invoices_updated_at before update on invoices for each row execute function public.set_updated_at();
alter table invoices enable row level security;
create policy "invoices_select" on invoices for select using (public.has_fakturaer_read_or_owner(legal_entity_id));
create policy "invoices_insert" on invoices for insert with check (public.has_fakturaer_access(legal_entity_id, 'write'));
create policy "invoices_update" on invoices for update using (public.has_fakturaer_access(legal_entity_id, 'write'));
create policy "invoices_delete" on invoices for delete using (public.has_fakturaer_access(legal_entity_id, 'admin'));

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  line_number int,
  supplier_sku text,
  description text,
  quantity numeric,
  unit text,
  unit_price numeric,
  total_amount numeric,
  vat_rate numeric,
  raw_material_id uuid references raw_materials(id),
  match_confidence text,
  price_per_base_unit numeric,
  expected_price_per_base_unit numeric,
  price_variance_pct numeric,
  variance_status text,
  requires_review boolean default false,
  review_reason text,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolution_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index on invoice_lines (invoice_id);
create index on invoice_lines (raw_material_id);
create index on invoice_lines (requires_review) where requires_review = true;
create trigger trg_invoice_lines_updated_at before update on invoice_lines for each row execute function public.set_updated_at();
alter table invoice_lines enable row level security;
create policy "invoice_lines_select" on invoice_lines for select using (exists (select 1 from invoices i where i.id = invoice_id and public.has_fakturaer_read_or_owner(i.legal_entity_id)));
create policy "invoice_lines_insert" on invoice_lines for insert with check (exists (select 1 from invoices i where i.id = invoice_id and public.has_fakturaer_access(i.legal_entity_id, 'write')));
create policy "invoice_lines_update" on invoice_lines for update using (exists (select 1 from invoices i where i.id = invoice_id and public.has_fakturaer_access(i.legal_entity_id, 'write')));
create policy "invoice_lines_delete" on invoice_lines for delete using (exists (select 1 from invoices i where i.id = invoice_id and public.has_fakturaer_access(i.legal_entity_id, 'write')));

create table public.invoice_line_match_suggestions (
  id uuid primary key default gen_random_uuid(),
  invoice_line_id uuid not null references invoice_lines(id) on delete cascade,
  raw_material_id uuid not null references raw_materials(id) on delete cascade,
  confidence numeric not null,
  match_reason text,
  rank int not null,
  created_at timestamptz default now(),
  unique (invoice_line_id, raw_material_id)
);
create index on invoice_line_match_suggestions (invoice_line_id, rank);
alter table invoice_line_match_suggestions enable row level security;
create policy "ilms_select" on invoice_line_match_suggestions for select using (exists (select 1 from invoice_lines il join invoices i on i.id = il.invoice_id where il.id = invoice_line_id and public.has_fakturaer_read_or_owner(i.legal_entity_id)));
create policy "ilms_write" on invoice_line_match_suggestions for all
  using (exists (select 1 from invoice_lines il join invoices i on i.id = il.invoice_id where il.id = invoice_line_id and public.has_fakturaer_access(i.legal_entity_id, 'write')))
  with check (exists (select 1 from invoice_lines il join invoices i on i.id = il.invoice_id where il.id = invoice_line_id and public.has_fakturaer_access(i.legal_entity_id, 'write')));

alter table raw_material_supplier_aliases add column if not exists alias_value_normalized text;

create or replace function public.normalize_alias_value() returns trigger as $$
begin new.alias_value_normalized := lower(trim(new.alias_value)); return new; end;
$$ language plpgsql;

drop trigger if exists trg_normalize_alias_value on raw_material_supplier_aliases;
create trigger trg_normalize_alias_value before insert or update on raw_material_supplier_aliases for each row execute function public.normalize_alias_value();

update raw_material_supplier_aliases set alias_value_normalized = lower(trim(alias_value)) where alias_value_normalized is null;

do $$
declare _cname text;
begin
  for _cname in select conname from pg_constraint where conrelid = 'public.raw_material_supplier_aliases'::regclass and contype = 'u'
  loop execute format('alter table raw_material_supplier_aliases drop constraint %I', _cname);
  end loop;
end$$;

alter table raw_material_supplier_aliases add constraint raw_material_supplier_aliases_unique_norm unique (alias_type, alias_value_normalized, raw_material_supplier_id);
create index if not exists idx_rmsa_lookup_confirmed on raw_material_supplier_aliases (alias_type, alias_value_normalized) where status = 'confirmed';

create or replace function public.normalize_exclusion_pattern() returns trigger as $$
begin new.pattern_value_normalized := lower(trim(new.pattern_value)); return new; end;
$$ language plpgsql;

create table public.invoice_line_exclusion_patterns (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id) on delete cascade,
  supplier_id uuid references suppliers(id),
  pattern_type text not null,
  pattern_value text not null,
  pattern_value_normalized text,
  reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);
create index on invoice_line_exclusion_patterns (legal_entity_id, supplier_id);
create trigger trg_normalize_exclusion_pattern before insert or update on invoice_line_exclusion_patterns for each row execute function public.normalize_exclusion_pattern();
alter table invoice_line_exclusion_patterns enable row level security;
create policy "ilep_select" on invoice_line_exclusion_patterns for select using (public.has_fakturaer_read_or_owner(legal_entity_id));
create policy "ilep_write" on invoice_line_exclusion_patterns for all
  using (public.has_fakturaer_access(legal_entity_id, 'write'))
  with check (public.has_fakturaer_access(legal_entity_id, 'write'));

create table public.invoice_match_settings (
  legal_entity_id uuid primary key references legal_entities(id) on delete cascade,
  default_price_tolerance_pct numeric default 2.0,
  fuzzy_match_threshold numeric default 0.5,
  fuzzy_auto_match_threshold numeric default 0.85,
  fuzzy_auto_match_dominance_threshold numeric default 0.65,
  auto_approve_within_tolerance boolean default false,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);
alter table invoice_match_settings enable row level security;
create policy "ims_select" on invoice_match_settings for select using (public.has_fakturaer_read_or_owner(legal_entity_id));
create policy "ims_write" on invoice_match_settings for all
  using (public.has_fakturaer_access(legal_entity_id, 'admin'))
  with check (public.has_fakturaer_access(legal_entity_id, 'admin'));

insert into invoice_match_settings (legal_entity_id) select id from legal_entities on conflict (legal_entity_id) do nothing;

create table public.invoice_match_category_tolerances (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id) on delete cascade,
  category text not null,
  price_tolerance_pct numeric not null,
  unique (legal_entity_id, category)
);
alter table invoice_match_category_tolerances enable row level security;
create policy "imct_select" on invoice_match_category_tolerances for select using (public.has_fakturaer_read_or_owner(legal_entity_id));
create policy "imct_write" on invoice_match_category_tolerances for all
  using (public.has_fakturaer_access(legal_entity_id, 'admin'))
  with check (public.has_fakturaer_access(legal_entity_id, 'admin'));

insert into storage.buckets (id, name, public) values ('invoice-pdfs', 'invoice-pdfs', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('invoice-ehf-xml', 'invoice-ehf-xml', false) on conflict (id) do nothing;

create policy "invoice_pdfs_select" on storage.objects for select to authenticated
  using (bucket_id = 'invoice-pdfs' and exists (
    select 1 from user_positions up
    join position_app_access paa on paa.position_id = up.position_id
    join apps a on a.id = paa.app_id
    where up.user_id = auth.uid() and a.code = 'fakturaer'
  ));
create policy "invoice_pdfs_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'invoice-pdfs' and exists (
    select 1 from user_positions up
    join position_app_access paa on paa.position_id = up.position_id
    join apps a on a.id = paa.app_id
    where up.user_id = auth.uid() and a.code = 'fakturaer' and paa.level in ('write','admin')
  ));
create policy "invoice_ehf_select" on storage.objects for select to authenticated
  using (bucket_id = 'invoice-ehf-xml' and exists (
    select 1 from user_positions up
    join position_app_access paa on paa.position_id = up.position_id
    join apps a on a.id = paa.app_id
    where up.user_id = auth.uid() and a.code = 'fakturaer'
  ));
create policy "invoice_ehf_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'invoice-ehf-xml' and exists (
    select 1 from user_positions up
    join position_app_access paa on paa.position_id = up.position_id
    join apps a on a.id = paa.app_id
    where up.user_id = auth.uid() and a.code = 'fakturaer' and paa.level in ('write','admin')
  ));
