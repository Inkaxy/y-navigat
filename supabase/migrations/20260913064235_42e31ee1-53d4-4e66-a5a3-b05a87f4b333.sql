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

  -- Deaktiver forst: unikt indeks ai_provider_config_active_purpose_idx tillater
  -- kun en aktiv rad per purpose. Alt skjer i samme transaksjon, sa en feil
  -- ruller tilbake til forrige aktive oppsett.
  update public.ai_provider_config
     set is_active = false,
         updated_at = now()
   where purpose = p_purpose
     and is_active;

  insert into public.ai_provider_config
    (provider, encrypted_api_key, model, max_tokens, temperature, purpose, is_active)
  values
    (p_provider, p_encrypted_api_key, p_model, coalesce(p_max_tokens, 1500),
     coalesce(p_temperature, 0), p_purpose, true)
  returning id into v_id;

  return v_id;
end;
$function$;

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
begin
  if coalesce(p_model, '') = '' then
    raise exception 'modell er pakrevd';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_provider_config:' || v_purpose, 0));

  if coalesce(p_encrypted_api_key, '') <> '' then
    -- Deaktiver forst pga unikt indeks pa (purpose) where is_active.
    update public.ai_provider_config
       set is_active = false, updated_at = now()
     where purpose = v_purpose and is_active;

    insert into public.ai_provider_config
      (provider, encrypted_api_key, model, max_tokens, temperature, purpose, is_active)
    values ('openai', p_encrypted_api_key, p_model, 1500, 0, v_purpose, true)
    returning id into v_id;
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