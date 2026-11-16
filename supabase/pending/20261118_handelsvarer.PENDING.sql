-- =====================================================================================
-- PENDING 18.11.2026 · Variant B fase 4 · Handelsvarer (Varer › Priser › Handelsvarer)
-- Kjøres av root etter Henriks ja. Bare additivt: én ny tabell, én ny kolonne, nye funksjoner.
-- Endrer eller sletter INGEN eksisterende data. Ingen eksisterende funksjon byttes.
--
--  1. entity_calc_settings.resale_default_factor (null = 1,2): standard påslagsfaktor for handelsvarer.
--  2. resale_markup_settings: påslag per prisliste (raw_material_id null), per handelsvare
--     (price_list_id null) og per handelsvare × prisliste, pluss «sperr i denne prislisten».
--     Lagres bare som forslagsgrunnlag. Prislistene endres fortsatt bare via set_prices når
--     brukeren trykker Lagre i «ulagrede endringer».
--  3. varer_cap_handelsvarer_v1(): frontend lagrer påslag/sperre bare når denne finnes.
-- =====================================================================================
begin;

alter table public.entity_calc_settings
  add column if not exists resale_default_factor numeric null;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'ecs_resale_default_factor_chk') then
    alter table public.entity_calc_settings add constraint ecs_resale_default_factor_chk
      check (resale_default_factor is null or (resale_default_factor >= 0.5 and resale_default_factor <= 10));
  end if;
end $c$;

create table if not exists public.resale_markup_settings (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null,
  price_list_id uuid null references public.price_lists(id) on delete cascade,
  raw_material_id uuid null references public.raw_materials(id) on delete cascade,
  factor numeric null check (factor is null or (factor >= 0.5 and factor <= 10)),
  blocked boolean not null default false,
  note text null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resale_markup_scope_chk check (price_list_id is not null or raw_material_id is not null),
  constraint resale_markup_block_chk check (not blocked or (price_list_id is not null and raw_material_id is not null))
);
create unique index if not exists ux_resale_markup_list on public.resale_markup_settings (price_list_id) where raw_material_id is null;
create unique index if not exists ux_resale_markup_item on public.resale_markup_settings (raw_material_id) where price_list_id is null;
create unique index if not exists ux_resale_markup_cell on public.resale_markup_settings (price_list_id, raw_material_id)
  where price_list_id is not null and raw_material_id is not null;
create index if not exists ix_resale_markup_entity on public.resale_markup_settings (legal_entity_id);

grant select, insert, update, delete on public.resale_markup_settings to authenticated;
grant all on public.resale_markup_settings to service_role;
alter table public.resale_markup_settings enable row level security;

drop policy if exists rms_markup_select on public.resale_markup_settings;
create policy rms_markup_select on public.resale_markup_settings for select to authenticated
  using (public.has_position_in_entity(legal_entity_id) or public.is_platform_admin());
drop policy if exists rms_markup_write on public.resale_markup_settings;
create policy rms_markup_write on public.resale_markup_settings for all to authenticated
  using (public.has_position_in_entity(legal_entity_id) and public.has_app_write_access('varer'))
  with check (
    public.has_position_in_entity(legal_entity_id) and public.has_app_write_access('varer')
    and (price_list_id is null or exists (select 1 from public.price_lists pl
          where pl.id = price_list_id and pl.legal_entity_id = resale_markup_settings.legal_entity_id))
    and (raw_material_id is null or exists (select 1 from public.raw_materials rm
          where rm.id = raw_material_id and rm.legal_entity_id = resale_markup_settings.legal_entity_id)));

drop trigger if exists trg_resale_markup_updated on public.resale_markup_settings;
create trigger trg_resale_markup_updated before update on public.resale_markup_settings
  for each row execute function public.tg_set_updated_at();

create or replace function public.varer_cap_handelsvarer_v1()
returns boolean language sql stable set search_path to 'public' as $$ select true $$;
revoke all on function public.varer_cap_handelsvarer_v1() from public, anon;
grant execute on function public.varer_cap_handelsvarer_v1() to authenticated, service_role;

commit;
