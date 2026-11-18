// Minimal stubb av live-skjemaet for «Slå sammen varer» (delt av SQL-testene).
export const STUB = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create type public.access_level as enum ('none','read','write','approve','admin');
create type public.alias_type as enum ('supplier_sku','product_name','ean','gtin');
create type public.alias_status as enum ('confirmed','pending','rejected','superseded');
create function public.has_ravarer_access(_user_id uuid, _le uuid, _min public.access_level) returns boolean language sql stable as $$
  select _user_id is not null and coalesce(nullif(current_setting('test.level', true), ''), 'none')::public.access_level >= _min $$;
create function public.rm_sku_norm(text) returns text language sql immutable as $$ select lower(regexp_replace(coalesce($1, ''), '[^a-zA-Z0-9]', '', 'g')) $$;
create table public.legal_entities (id uuid primary key, status text);
create table public.suppliers (id uuid primary key, legal_entity_id uuid, name text);
create table public.raw_materials (id uuid primary key, legal_entity_id uuid not null, name text not null, sku text not null, base_unit text not null,
  category text, categories text[] not null default '{}', item_type text not null default 'ravare', is_active boolean not null default true,
  current_cost_price numeric, cost_basis_status text, unit_weight_grams numeric, declaration_name text, grain_classification text, cereal_type text,
  water_content_pct numeric, density_g_per_ml numeric, allergens_reviewed_at timestamptz, is_composite boolean not null default false,
  components_reviewed_at timestamptz, primary_supplier_id uuid, produced_by_recipe_id uuid, created_at timestamptz not null default now(),
  current_stock numeric not null default 0, stock_tracking boolean not null default false);
create table public.invoice_lines (id uuid primary key, raw_material_id uuid references public.raw_materials(id), base_quantity numeric,
  price_per_base_unit numeric, package_source_rms_id uuid, excluded_raw_material_id uuid, exclusion_prev jsonb, price_acceptance jsonb, total_amount numeric);
create table public.invoice_line_cost_postings (invoice_line_id uuid, revoked_at timestamptz);
create table public.vt_counts (id uuid primary key, status text);
create table public.vt_count_lines (id uuid primary key default gen_random_uuid(), count_id uuid, raw_material_id uuid);
create table public.vt_template_lines (id uuid primary key default gen_random_uuid(), template_id uuid, raw_material_id uuid, location_id uuid);
create table public.recipe_lines (id uuid primary key default gen_random_uuid(), recipe_id uuid, raw_material_id uuid, quantity numeric, unit text);
create table public.recipe_packaging_lines (id uuid primary key default gen_random_uuid(), recipe_id uuid, raw_material_id uuid);
create table public.raw_material_components (id uuid primary key default gen_random_uuid(), parent_raw_material_id uuid, component_raw_material_id uuid);
create table public.invoice_line_match_suggestions (id uuid primary key default gen_random_uuid(), invoice_line_id uuid, raw_material_id uuid,
  confidence numeric, match_reason text, rank int, created_at timestamptz default now(), unique (invoice_line_id, raw_material_id));
create table public.stock_movements (id uuid primary key default gen_random_uuid(), raw_material_id uuid, quantity_base numeric, source_table text, source_id uuid);
create table public.rm_stock_lots (id uuid primary key default gen_random_uuid(), raw_material_id uuid, quantity_base numeric, remaining_base numeric);
create table public.rm_goods_receipts (id uuid primary key default gen_random_uuid(), raw_material_id uuid, quantity_base numeric);
create table public.raw_material_price_history (id uuid primary key default gen_random_uuid(), raw_material_id uuid, invoice_line_id uuid, price numeric,
  superseded_at timestamptz, superseded_reason text, created_at timestamptz default clock_timestamp());
create unique index ux_rmph_invoice_line on public.raw_material_price_history (invoice_line_id) where invoice_line_id is not null and superseded_at is null;
create table public.raw_material_suppliers (id uuid primary key, raw_material_id uuid not null, supplier_id uuid not null, supplier_sku text,
  supplier_product_name text, is_primary boolean not null default false, package_size numeric, package_unit text, base_units_per_package numeric,
  package_confirmed_at timestamptz, package_confirmed_by uuid, container_unit text, agreed_price_per_base_unit numeric, agreement_valid_from date,
  agreement_valid_to date, agreement_document_url text, start_price_per_base_unit numeric, start_price_base_units_per_package numeric,
  start_price_base_unit text, created_at timestamptz default now(), unique (raw_material_id, supplier_id));
create table public.raw_material_supplier_aliases (id uuid primary key default gen_random_uuid(), raw_material_supplier_id uuid not null,
  alias_type public.alias_type not null, alias_value text not null, alias_value_normalized text, status public.alias_status not null default 'pending',
  match_count int not null default 1, confirmed_by uuid, confirmed_at timestamptz, last_seen_at timestamptz default now(),
  unique (alias_type, alias_value_normalized, raw_material_supplier_id));
create function public.normalize_alias_value() returns trigger language plpgsql as $$
begin new.alias_value_normalized := lower(trim(new.alias_value)); return new; end $$;
create trigger trg_normalize_alias_value before insert or update on public.raw_material_supplier_aliases for each row execute function public.normalize_alias_value();
create table public.raw_material_supplier_packages (id uuid primary key default gen_random_uuid(), raw_material_supplier_id uuid not null,
  supplier_sku_norm text not null default '', package_size numeric, package_unit text, base_units_per_package numeric not null,
  confirmed_at timestamptz, confirmed_by uuid, container_unit text, superseded_at timestamptz, superseded_reason text);
create unique index rmsp_variant on public.raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm,
  coalesce(package_size, -1), coalesce(lower(package_unit), ''), base_units_per_package);
-- Live _rms_record_package_variant (byte-lik logikk).
create function public._rms_record_package_variant() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.package_confirmed_at is not null and old.base_units_per_package is not null then
    insert into raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_size, package_unit, base_units_per_package, confirmed_at, confirmed_by, container_unit)
    values (old.id, rm_sku_norm(old.supplier_sku), old.package_size, old.package_unit, old.base_units_per_package, old.package_confirmed_at, old.package_confirmed_by, old.container_unit)
    on conflict do nothing;
  end if;
  if new.package_confirmed_at is not null and new.base_units_per_package is not null then
    insert into raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_size, package_unit, base_units_per_package, confirmed_at, confirmed_by, container_unit)
    values (new.id, rm_sku_norm(new.supplier_sku), new.package_size, new.package_unit, new.base_units_per_package, new.package_confirmed_at, new.package_confirmed_by, new.container_unit)
    on conflict (raw_material_supplier_id, supplier_sku_norm, coalesce(package_size, -1), coalesce(lower(package_unit), ''), base_units_per_package)
    do update set confirmed_at = excluded.confirmed_at, superseded_at = null, superseded_reason = null;
  end if;
  return new;
end $$;
create trigger trg_rms_package_variant after insert or update of package_size, package_unit, base_units_per_package, package_confirmed_at, supplier_sku, container_unit
  on public.raw_material_suppliers for each row execute function public._rms_record_package_variant();
-- Live startprisvakt (forenklet: bare pris-feltet).
create function public.rm_guard_start_price_columns() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.rm_start_price_rpc', true), '') = '1' then return new; end if;
  if tg_op = 'UPDATE' and (new.start_price_per_base_unit, new.start_price_base_unit) is distinct from (old.start_price_per_base_unit, old.start_price_base_unit) then
    raise exception 'Startpris kan bare endres gjennom bekreftelses- eller endringsflyten';
  end if;
  return new;
end $$;
create trigger trg_rm_guard_start_price before insert or update on public.raw_material_suppliers for each row execute function public.rm_guard_start_price_columns();
-- Forenklet fn_invoice_line_match_price_history: avslutt observasjon ved bytte, én aktiv observasjon per linje.
create function public.fn_line_price_history() returns trigger language plpgsql as $$
begin
  if old.raw_material_id is not distinct from new.raw_material_id and old.price_per_base_unit is not distinct from new.price_per_base_unit
     and old.package_source_rms_id is not distinct from new.package_source_rms_id then return new; end if;
  if old.raw_material_id is not null and old.raw_material_id is distinct from new.raw_material_id then
    update raw_material_price_history set superseded_at = coalesce(superseded_at, now()), superseded_reason = coalesce(superseded_reason, 'linje_ukoblet')
     where invoice_line_id = new.id and raw_material_id = old.raw_material_id and superseded_at is null;
  end if;
  if new.raw_material_id is null or new.price_per_base_unit is null then return new; end if;
  if exists (select 1 from raw_material_price_history where invoice_line_id = new.id and superseded_at is null
              and raw_material_id = new.raw_material_id and price = new.price_per_base_unit) then return new; end if;
  update raw_material_price_history set superseded_at = now(), superseded_reason = 'nytt_prisgrunnlag' where invoice_line_id = new.id and superseded_at is null;
  insert into raw_material_price_history (raw_material_id, invoice_line_id, price) values (new.raw_material_id, new.id, new.price_per_base_unit);
  return new;
end $$;
create trigger trg_line_price_history after update of raw_material_id, price_per_base_unit, base_quantity on public.invoice_lines
  for each row execute function public.fn_line_price_history();
create table public.raw_material_purchases (id uuid primary key default gen_random_uuid(), raw_material_id uuid);
create table public.product_cost_additions (id uuid primary key default gen_random_uuid(), raw_material_id uuid);
create table public.raw_material_products (id uuid primary key default gen_random_uuid(), raw_material_id uuid, product_id uuid,
  base_units_per_sold_unit numeric not null default 1, unique (raw_material_id, product_id));
create table public.raw_material_units (id uuid primary key default gen_random_uuid(), raw_material_id uuid, unit_label text, units_in_base numeric,
  is_default_purchase boolean not null default false, is_default_count boolean not null default false, is_sales_unit boolean not null default false);
create table public.negotiation_items (id uuid primary key default gen_random_uuid(), negotiation_id uuid, raw_material_id uuid, unique (negotiation_id, raw_material_id));
create table public.raw_material_nutrition (raw_material_id uuid primary key, energy_kj numeric);
create table public.raw_material_allergens (id uuid primary key default gen_random_uuid(), raw_material_id uuid, allergen text, presence text, unique (raw_material_id, allergen));
create table public.raw_material_datasheets (id uuid primary key default gen_random_uuid(), raw_material_id uuid, is_current boolean);
create table public.price_list_items (id uuid primary key default gen_random_uuid(), price_list_id uuid, product_id uuid);
create table public.audit_log (id bigserial primary key, user_id uuid, action text, entity_type text, entity_id uuid, entity_display_reference text,
  legal_entity_id uuid, changes jsonb, reason text, source_app text);
-- Forenklet prisvelger: nyeste aktive observasjon er kostpris.
create function public.rm_apply_derived_cost_price(p uuid) returns numeric language plpgsql as $$
declare v numeric;
begin
  select price into v from raw_material_price_history where raw_material_id = p and superseded_at is null order by created_at desc, id desc limit 1;
  update raw_materials set current_cost_price = coalesce(v, current_cost_price), cost_basis_status = case when v is null then 'mangler' else 'verifisert' end where id = p;
  return v;
end $$;
create function public.refresh_purchase_stats() returns void language sql as $$ select $$;
create function public.merge_raw_materials(p_keep uuid, p_dup uuid) returns void language plpgsql as $$ begin delete from raw_materials where id = p_dup; end $$;
`;
