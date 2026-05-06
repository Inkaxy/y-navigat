-- 1. Legg til invoice_access-kolonne
alter table public.position_app_access
  add column if not exists invoice_access boolean not null default false;

-- 2. Migrer: posisjoner med write/admin på fakturaer-appen får invoice_access=true på ravarer-appen.
--    Sørg først for at posisjonen har en rad på ravarer (lag read hvis den mangler).
with fakturaer_positions as (
  select position_id, level
  from public.position_app_access
  where app_id = (select id from public.apps where code = 'fakturaer')
    and level in ('write','admin')
),
ravarer_app as (select id from public.apps where code = 'ravarer')
insert into public.position_app_access (position_id, app_id, level, invoice_access)
select fp.position_id, ra.id, 'read'::access_level, true
from fakturaer_positions fp, ravarer_app ra
on conflict (position_id, app_id) do update
  set invoice_access = true;

-- 3. Slett fakturaer-tilganger og selve appen
delete from public.position_app_access
  where app_id = (select id from public.apps where code = 'fakturaer');
delete from public.apps where code = 'fakturaer';

-- 4. Ny helper: invoice_access på ravarer-appen + matching legal_entity
create or replace function public.has_ravarer_invoice_access(_legal_entity_id uuid, _required_level text default 'read')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from user_positions up
    join position_app_access paa on paa.position_id = up.position_id
    join apps a on a.id = paa.app_id
    where up.user_id = auth.uid()
      and a.code = 'ravarer'
      and paa.invoice_access = true
      and up.legal_entity_id = _legal_entity_id
      and up.valid_from <= current_date
      and (up.valid_to is null or up.valid_to >= current_date)
      and (
        _required_level = 'read'
        or (_required_level = 'write' and paa.level in ('write','admin'))
        or (_required_level = 'admin' and paa.level = 'admin')
      )
  )
$$;

create or replace function public.has_ravarer_invoice_read_or_owner(_legal_entity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_ravarer_invoice_access(_legal_entity_id, 'read')
    or exists (
      select 1 from user_positions up
      join positions p on p.id = up.position_id
      where up.user_id = auth.uid() and p.is_owner = true
    )
$$;

-- 5. Oppdater RLS-policies på alle invoice-tabeller
-- invoices
drop policy if exists invoices_select on public.invoices;
drop policy if exists invoices_insert on public.invoices;
drop policy if exists invoices_update on public.invoices;
drop policy if exists invoices_delete on public.invoices;
create policy invoices_select on public.invoices for select
  using (public.has_ravarer_invoice_read_or_owner(legal_entity_id));
create policy invoices_insert on public.invoices for insert
  with check (public.has_ravarer_invoice_access(legal_entity_id, 'write'));
create policy invoices_update on public.invoices for update
  using (public.has_ravarer_invoice_access(legal_entity_id, 'write'));
create policy invoices_delete on public.invoices for delete
  using (public.has_ravarer_invoice_access(legal_entity_id, 'admin'));

-- invoice_lines (joiner mot invoices for legal_entity)
drop policy if exists invoice_lines_select on public.invoice_lines;
drop policy if exists invoice_lines_insert on public.invoice_lines;
drop policy if exists invoice_lines_update on public.invoice_lines;
drop policy if exists invoice_lines_delete on public.invoice_lines;
create policy invoice_lines_select on public.invoice_lines for select
  using (exists (select 1 from public.invoices i where i.id = invoice_id and public.has_ravarer_invoice_read_or_owner(i.legal_entity_id)));
create policy invoice_lines_insert on public.invoice_lines for insert
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and public.has_ravarer_invoice_access(i.legal_entity_id, 'write')));
create policy invoice_lines_update on public.invoice_lines for update
  using (exists (select 1 from public.invoices i where i.id = invoice_id and public.has_ravarer_invoice_access(i.legal_entity_id, 'write')));
create policy invoice_lines_delete on public.invoice_lines for delete
  using (exists (select 1 from public.invoices i where i.id = invoice_id and public.has_ravarer_invoice_access(i.legal_entity_id, 'write')));

-- invoice_line_match_suggestions
drop policy if exists ilms_select on public.invoice_line_match_suggestions;
drop policy if exists ilms_write on public.invoice_line_match_suggestions;
create policy ilms_select on public.invoice_line_match_suggestions for select
  using (exists (select 1 from public.invoice_lines il join public.invoices i on i.id = il.invoice_id where il.id = invoice_line_id and public.has_ravarer_invoice_read_or_owner(i.legal_entity_id)));
create policy ilms_write on public.invoice_line_match_suggestions for all
  using (exists (select 1 from public.invoice_lines il join public.invoices i on i.id = il.invoice_id where il.id = invoice_line_id and public.has_ravarer_invoice_access(i.legal_entity_id, 'write')))
  with check (exists (select 1 from public.invoice_lines il join public.invoices i on i.id = il.invoice_id where il.id = invoice_line_id and public.has_ravarer_invoice_access(i.legal_entity_id, 'write')));

-- invoice_line_exclusion_patterns (legal_entity_id direkte)
drop policy if exists ilep_select on public.invoice_line_exclusion_patterns;
drop policy if exists ilep_write on public.invoice_line_exclusion_patterns;
create policy ilep_select on public.invoice_line_exclusion_patterns for select
  using (public.has_ravarer_invoice_read_or_owner(legal_entity_id));
create policy ilep_write on public.invoice_line_exclusion_patterns for all
  using (public.has_ravarer_invoice_access(legal_entity_id, 'write'))
  with check (public.has_ravarer_invoice_access(legal_entity_id, 'write'));

-- invoice_match_settings
drop policy if exists ims_select on public.invoice_match_settings;
drop policy if exists ims_write on public.invoice_match_settings;
create policy ims_select on public.invoice_match_settings for select
  using (public.has_ravarer_invoice_read_or_owner(legal_entity_id));
create policy ims_write on public.invoice_match_settings for all
  using (public.has_ravarer_invoice_access(legal_entity_id, 'admin'))
  with check (public.has_ravarer_invoice_access(legal_entity_id, 'admin'));

-- invoice_match_category_tolerances
drop policy if exists imct_select on public.invoice_match_category_tolerances;
drop policy if exists imct_write on public.invoice_match_category_tolerances;
create policy imct_select on public.invoice_match_category_tolerances for select
  using (public.has_ravarer_invoice_read_or_owner(legal_entity_id));
create policy imct_write on public.invoice_match_category_tolerances for all
  using (public.has_ravarer_invoice_access(legal_entity_id, 'admin'))
  with check (public.has_ravarer_invoice_access(legal_entity_id, 'admin'));

-- raw_material_supplier_aliases (skal beholde åpen tilgang for ravarer-brukere generelt,
-- men skrive-tilgang til invoice-relaterte aliaser styres her). Behold eksisterende policies hvis de
-- allerede tillater ravarer-tilgang. Vi rører ikke disse for å unngå å bryte øvrige ravarer-flows.
