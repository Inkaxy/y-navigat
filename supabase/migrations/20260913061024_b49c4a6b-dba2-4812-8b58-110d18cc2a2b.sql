create table if not exists public.ai_declaration_quota (
  quota_date date primary key,
  used_count integer not null default 0,
  updated_at timestamptz not null default now()
);

revoke all on public.ai_declaration_quota from anon;
revoke all on public.ai_declaration_quota from authenticated;
grant all on public.ai_declaration_quota to service_role;
alter table public.ai_declaration_quota enable row level security;

revoke all on public.ai_provider_config from anon;
revoke all on public.ai_provider_config from authenticated;
grant all on public.ai_provider_config to service_role;

create or replace function public.ai_declaration_quota_consume(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  if p_limit is null or p_limit < 1 then
    return jsonb_build_object('allowed', false, 'used', 0, 'limit', coalesce(p_limit, 0));
  end if;

  insert into public.ai_declaration_quota as q (quota_date, used_count)
  values (current_date, 1)
  on conflict (quota_date) do update
    set used_count = q.used_count + 1,
        updated_at = now()
    where q.used_count < p_limit
  returning q.used_count into v_used;

  if v_used is null then
    select used_count into v_used from public.ai_declaration_quota where quota_date = current_date;
    return jsonb_build_object('allowed', false, 'used', coalesce(v_used, 0), 'limit', p_limit);
  end if;

  return jsonb_build_object('allowed', true, 'used', v_used, 'limit', p_limit);
end;
$$;

revoke all on function public.ai_declaration_quota_consume(integer) from public;
revoke all on function public.ai_declaration_quota_consume(integer) from anon;
revoke all on function public.ai_declaration_quota_consume(integer) from authenticated;
grant execute on function public.ai_declaration_quota_consume(integer) to service_role;

create or replace function public.ai_config_replace_active(
  p_purpose text,
  p_provider text,
  p_encrypted_api_key text,
  p_model text,
  p_max_tokens integer default 1500,
  p_temperature numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(p_purpose, '') = '' or coalesce(p_provider, '') = ''
     or coalesce(p_encrypted_api_key, '') = '' or coalesce(p_model, '') = '' then
    raise exception 'purpose, provider, kryptert nokkel og modell er pakrevd';
  end if;

  insert into public.ai_provider_config
    (provider, encrypted_api_key, model, max_tokens, temperature, purpose, is_active)
  values
    (p_provider, p_encrypted_api_key, p_model, coalesce(p_max_tokens, 1500),
     coalesce(p_temperature, 0), p_purpose, true)
  returning id into v_id;

  update public.ai_provider_config
     set is_active = false,
         updated_at = now()
   where purpose = p_purpose
     and is_active
     and id <> v_id;

  return v_id;
end;
$$;

revoke all on function public.ai_config_replace_active(text, text, text, text, integer, numeric) from public;
revoke all on function public.ai_config_replace_active(text, text, text, text, integer, numeric) from anon;
revoke all on function public.ai_config_replace_active(text, text, text, text, integer, numeric) from authenticated;
grant execute on function public.ai_config_replace_active(text, text, text, text, integer, numeric) to service_role;