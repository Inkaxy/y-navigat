-- Teststatus bindes til det testede oppsettet via en revisjonsteller.
CREATE OR REPLACE FUNCTION public.ai_declaration_config_save(p_model text, p_daily_cap integer, p_style_notes text, p_updated_by uuid, p_encrypted_api_key text DEFAULT NULL::text)
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
  v_prev_model text;
  v_revision integer;
  v_reset boolean := false;
begin
  if coalesce(p_model, '') = '' then
    raise exception 'modell er pakrevd';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_provider_config:' || v_purpose, 0));

  select coalesce(value, '{}'::jsonb) into v_value
    from public.platform_settings
   where category = 'varer_ai' and key = 'declaration_assistant';

  v_value := coalesce(v_value, '{}'::jsonb);
  v_prev_model := nullif(v_value ->> 'model', '');
  v_revision := coalesce((v_value ->> 'config_revision')::int, 0);

  if coalesce(p_encrypted_api_key, '') <> '' then
    -- Deaktiver forst pga unikt indeks pa (purpose) where is_active.
    update public.ai_provider_config
       set is_active = false, updated_at = now()
     where purpose = v_purpose and is_active;

    insert into public.ai_provider_config
      (provider, encrypted_api_key, model, max_tokens, temperature, purpose, is_active)
    values ('openai', p_encrypted_api_key, p_model, 1500, 0, v_purpose, true)
    returning id into v_id;

    v_reset := true;
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

  if v_prev_model is distinct from p_model then
    v_reset := true;
  end if;

  v_value := v_value || jsonb_build_object(
    'model', p_model,
    'daily_cap', v_cap,
    'style_notes', left(coalesce(p_style_notes, ''), 2000)
  );

  if v_reset then
    -- Ny nokkel eller ny modell: den gamle testen sier ingenting om dette oppsettet.
    v_revision := v_revision + 1;
    v_value := v_value || jsonb_build_object(
      'config_revision', v_revision,
      'last_test_at', null,
      'last_test_ok', false,
      'last_test_code', null,
      'last_test_revision', null
    );
  else
    v_value := v_value || jsonb_build_object('config_revision', v_revision);
  end if;

  insert into public.platform_settings (category, key, value, updated_by)
  values ('varer_ai', 'declaration_assistant', v_value, p_updated_by)
  on conflict (category, key) do update
    set value = excluded.value, updated_by = excluded.updated_by;

  return jsonb_build_object(
    'config_id', v_id,
    'daily_cap', v_cap,
    'model', p_model,
    'config_revision', v_revision,
    'test_reset', v_reset
  );
end;
$function$;

-- Frakobling: deaktiver aktiv nokkel og nullstill teststatus i samme lasing.
CREATE OR REPLACE FUNCTION public.ai_declaration_config_disconnect()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_purpose constant text := 'declaration_assistant';
  v_value jsonb;
  v_revision integer;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_provider_config:' || v_purpose, 0));

  update public.ai_provider_config
     set is_active = false, updated_at = now()
   where purpose = v_purpose and is_active;
  get diagnostics v_count = row_count;

  select coalesce(value, '{}'::jsonb) into v_value
    from public.platform_settings
   where category = 'varer_ai' and key = 'declaration_assistant';

  v_value := coalesce(v_value, '{}'::jsonb);
  v_revision := coalesce((v_value ->> 'config_revision')::int, 0) + 1;
  v_value := v_value || jsonb_build_object(
    'config_revision', v_revision,
    'last_test_at', null,
    'last_test_ok', false,
    'last_test_code', null,
    'last_test_revision', null
  );

  insert into public.platform_settings (category, key, value)
  values ('varer_ai', 'declaration_assistant', v_value)
  on conflict (category, key) do update set value = excluded.value;

  return jsonb_build_object('deactivated', v_count, 'config_revision', v_revision);
end;
$function$;

DROP FUNCTION IF EXISTS public.ai_declaration_record_test(boolean, text);

-- Resultatet lagres bare nar oppsettet er uendret siden testen startet.
CREATE OR REPLACE FUNCTION public.ai_declaration_record_test(p_ok boolean, p_code text, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_value jsonb;
  v_revision integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_provider_config:declaration_assistant', 0));

  select coalesce(value, '{}'::jsonb) into v_value
    from public.platform_settings
   where category = 'varer_ai' and key = 'declaration_assistant';

  v_value := coalesce(v_value, '{}'::jsonb);
  v_revision := coalesce((v_value ->> 'config_revision')::int, 0);

  if p_expected_revision is null or p_expected_revision <> v_revision then
    return jsonb_build_object('recorded', false, 'stale', true, 'config_revision', v_revision);
  end if;

  v_value := v_value || jsonb_build_object(
    'last_test_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'last_test_ok', coalesce(p_ok, false),
    'last_test_code', left(coalesce(p_code, ''), 60),
    'last_test_revision', v_revision
  );

  insert into public.platform_settings (category, key, value)
  values ('varer_ai', 'declaration_assistant', v_value)
  on conflict (category, key) do update set value = excluded.value;

  return jsonb_build_object('recorded', true, 'stale', false, 'config_revision', v_revision);
end;
$function$;

REVOKE ALL ON FUNCTION public.ai_declaration_record_test(boolean, text, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_declaration_record_test(boolean, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.ai_declaration_config_disconnect() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_declaration_config_disconnect() TO service_role;
REVOKE ALL ON FUNCTION public.ai_declaration_config_save(text, integer, text, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_declaration_config_save(text, integer, text, uuid, text) TO service_role;