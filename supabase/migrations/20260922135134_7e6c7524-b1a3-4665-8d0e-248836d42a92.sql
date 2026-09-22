create or replace function public.user_holds_position(_position_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_positions up
    where up.position_id = _position_id
      and up.user_id = auth.uid()
      and (up.valid_from is null or up.valid_from <= current_date)
      and (up.valid_to is null or up.valid_to >= current_date)
  )
$$;

revoke execute on function public.user_holds_position(uuid) from public, anon;
grant execute on function public.user_holds_position(uuid) to authenticated;

drop policy if exists paa_select_authenticated on public.position_app_access;
create policy paa_select_own_or_admin on public.position_app_access
for select to authenticated
using (is_platform_admin() or public.user_holds_position(position_id));

drop policy if exists pma_select_authenticated on public.position_module_access;
create policy pma_select_own_or_admin on public.position_module_access
for select to authenticated
using (is_platform_admin() or public.user_holds_position(position_id));

drop policy if exists pw_select_authenticated on public.position_widgets;
create policy pw_select_own_or_admin on public.position_widgets
for select to authenticated
using (is_platform_admin() or public.user_holds_position(position_id));