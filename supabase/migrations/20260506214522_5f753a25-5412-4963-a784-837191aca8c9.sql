
create or replace function public.negotiation_recipient_by_token(p_token text, p_password text)
returns table(recipient_id uuid, negotiation_id uuid, supplier_id uuid, status text, expires_at timestamp with time zone, negotiation_title text, response_deadline timestamp with time zone, result text)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
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
    update public.negotiation_recipients nr
       set failed_attempts = nr.failed_attempts + 1,
           locked_until = case when nr.failed_attempts + 1 >= 5 then now() + interval '24 hours' else nr.locked_until end,
           status = case when nr.failed_attempts + 1 >= 5 then 'locked'::negotiation_recipient_status else nr.status end
     where nr.id = r.id;
    return query select r.id, r.negotiation_id, r.supplier_id, r.status::text, r.expires_at, r.ntitle, r.ndl, 'wrong_password';
    return;
  end if;

  update public.negotiation_recipients nr
     set failed_attempts = 0,
         first_viewed_at = coalesce(nr.first_viewed_at, now()),
         last_viewed_at = now(),
         status = case when nr.status = 'invited' then 'viewed'::negotiation_recipient_status else nr.status end
   where nr.id = r.id;

  return query select r.id, r.negotiation_id, r.supplier_id, r.status::text, r.expires_at, r.ntitle, r.ndl, 'ok';
end $function$;
