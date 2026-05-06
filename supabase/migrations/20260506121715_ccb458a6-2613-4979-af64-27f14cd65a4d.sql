create or replace function public.user_has_invoice_access()
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
      and up.valid_from <= current_date
      and (up.valid_to is null or up.valid_to >= current_date)
  )
$$;