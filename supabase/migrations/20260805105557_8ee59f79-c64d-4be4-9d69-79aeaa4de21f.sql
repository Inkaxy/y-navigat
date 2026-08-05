create or replace function public.increment_cake_image_print(p_ids uuid[])
returns setof public.cake_images
language sql
volatile
set search_path = public
as $$
  update public.cake_images
     set status = 'skrevet_ut',
         printed_at = now(),
         print_count = coalesce(print_count, 0) + 1
   where id = any(p_ids)
  returning *;
$$;

revoke all on function public.increment_cake_image_print(uuid[]) from public, anon;
grant execute on function public.increment_cake_image_print(uuid[]) to authenticated;