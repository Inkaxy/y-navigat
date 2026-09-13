-- Oslo-dag for kvoten
CREATE OR REPLACE FUNCTION public.ai_declaration_quota_consume(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_used integer;
  v_limit integer;
  v_today date := (now() at time zone 'Europe/Oslo')::date;
begin
  if p_limit is null or p_limit < 1 then
    return jsonb_build_object('allowed', false, 'used', 0, 'limit', coalesce(p_limit, 0), 'quota_date', v_today);
  end if;
  v_limit := least(p_limit, 500);

  insert into public.ai_declaration_quota as q (quota_date, used_count)
  values (v_today, 1)
  on conflict (quota_date) do update
    set used_count = q.used_count + 1,
        updated_at = now()
    where q.used_count < v_limit
  returning q.used_count into v_used;

  if v_used is null then
    select used_count into v_used from public.ai_declaration_quota where quota_date = v_today;
    return jsonb_build_object('allowed', false, 'used', coalesce(v_used, 0), 'limit', v_limit, 'quota_date', v_today);
  end if;

  return jsonb_build_object('allowed', true, 'used', v_used, 'limit', v_limit, 'quota_date', v_today);
end;
$function$;

REVOKE ALL ON FUNCTION public.ai_declaration_quota_consume(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_declaration_quota_consume(integer) TO service_role;

-- Status for Oslo-dagen
CREATE OR REPLACE FUNCTION public.ai_declaration_quota_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'quota_date', (now() at time zone 'Europe/Oslo')::date,
    'used', coalesce((
      select used_count from public.ai_declaration_quota
      where quota_date = (now() at time zone 'Europe/Oslo')::date
    ), 0)
  );
$function$;

REVOKE ALL ON FUNCTION public.ai_declaration_quota_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_declaration_quota_status() TO service_role;

-- Lås per bruksområde i nøkkelbyttet
CREATE OR REPLACE FUNCTION public.ai_config_replace_active(p_purpose text, p_provider text, p_encrypted_api_key text, p_model text, p_max_tokens integer DEFAULT 1500, p_temperature numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if coalesce(p_purpose, '') = '' or coalesce(p_provider, '') = ''
     or coalesce(p_encrypted_api_key, '') = '' or coalesce(p_model, '') = '' then
    raise exception 'purpose, provider, kryptert nokkel og modell er pakrevd';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_provider_config:' || p_purpose, 0));

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
$function$;

-- Ett atomisk lagringskall for deklarasjonsassistenten
CREATE OR REPLACE FUNCTION public.ai_declaration_config_save(
  p_model text,
  p_daily_cap integer,
  p_style_notes text,
  p_updated_by uuid,
  p_encrypted_api_key text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_purpose constant text := 'declaration_assistant';
  v_cap integer := least(greatest(coalesce(p_daily_cap, 25), 1), 500);
  v_id uuid;
  v_existing uuid;
  v_value jsonb;
begin
  if coalesce(p_model, '') = '' then
    raise exception 'modell er pakrevd';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_provider_config:' || v_purpose, 0));

  if coalesce(p_encrypted_api_key, '') <> '' then
    insert into public.ai_provider_config
      (provider, encrypted_api_key, model, max_tokens, temperature, purpose, is_active)
    values ('openai', p_encrypted_api_key, p_model, 1500, 0, v_purpose, true)
    returning id into v_id;

    update public.ai_provider_config
       set is_active = false, updated_at = now()
     where purpose = v_purpose and is_active and id <> v_id;
  else
    select id into v_existing
      from public.ai_provider_config
     where purpose = v_purpose and is_active
     order by created_at desc
     limit 1;

    if v_existing is not null then
      update public.ai_provider_config
         set model = p_model, updated_at = now()
       where id = v_existing;
      v_id := v_existing;
    end if;
  end if;

  select coalesce(value, '{}'::jsonb) into v_value
    from public.platform_settings
   where category = 'varer_ai' and key = 'declaration_assistant';

  v_value := coalesce(v_value, '{}'::jsonb) || jsonb_build_object(
    'model', p_model,
    'daily_cap', v_cap,
    'style_notes', left(coalesce(p_style_notes, ''), 2000)
  );

  insert into public.platform_settings (category, key, value, updated_by)
  values ('varer_ai', 'declaration_assistant', v_value, p_updated_by)
  on conflict (category, key) do update
    set value = excluded.value, updated_by = excluded.updated_by;

  return jsonb_build_object('config_id', v_id, 'daily_cap', v_cap, 'model', p_model);
end;
$function$;

REVOKE ALL ON FUNCTION public.ai_declaration_config_save(text, integer, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_declaration_config_save(text, integer, text, uuid, text) TO service_role;

-- Testresultat lagres atomisk sammen med oppsettet
CREATE OR REPLACE FUNCTION public.ai_declaration_record_test(p_ok boolean, p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_value jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_provider_config:declaration_assistant', 0));

  select coalesce(value, '{}'::jsonb) into v_value
    from public.platform_settings
   where category = 'varer_ai' and key = 'declaration_assistant';

  v_value := coalesce(v_value, '{}'::jsonb) || jsonb_build_object(
    'last_test_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'last_test_ok', coalesce(p_ok, false),
    'last_test_code', left(coalesce(p_code, ''), 60)
  );

  insert into public.platform_settings (category, key, value)
  values ('varer_ai', 'declaration_assistant', v_value)
  on conflict (category, key) do update set value = excluded.value;
end;
$function$;

REVOKE ALL ON FUNCTION public.ai_declaration_record_test(boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_declaration_record_test(boolean, text) TO service_role;