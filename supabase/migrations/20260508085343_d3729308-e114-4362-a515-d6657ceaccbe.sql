create or replace function public.is_platform_owner(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_positions up
    join public.positions p on p.id = up.position_id
    where up.user_id = _user_id
      and p.is_owner = true
      and up.valid_from <= current_date
      and (up.valid_to is null or up.valid_to > current_date)
  );
$$;

grant execute on function public.is_platform_owner(uuid) to authenticated;