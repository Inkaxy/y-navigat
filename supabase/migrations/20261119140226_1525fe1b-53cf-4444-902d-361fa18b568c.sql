-- 02 Bryter for «EHF først» i appen (19.11.2026). Råvarer › Innstillinger › Fakturalesing.
-- Endrer ingen data: bryteren står som den står (AV), og ingen fakturaer, linjer, varer eller priser røres.
-- Gjør to ting:
--   1) rm_reading_settings tar med «ehf_first» i svaret (ellers likt som før).
--   2) Ny rm_save_ehf_first: godkjenner/admin lagrer bare EHF-bryteren, med samme revisjon, lås og revisjonslogg
--      som de andre lesebryterne. rm_save_reading_settings er uendret og rører aldri ehf_first.
-- Kontroll: kontroll/20261127_ehf_bryter.check.sql
begin;

create or replace function public.rm_reading_settings(p_legal_entity_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare s public.invoice_reading_settings%rowtype;
begin
  perform public._rm_reading_read_guard(p_legal_entity_id);
  select * into s from public.invoice_reading_settings where legal_entity_id = p_legal_entity_id;
  if not found then
    return jsonb_build_object('catalog', false, 'profile', false, 'learning', false, 'self_check', false,
      'strong_config_id', null, 'max_examples', 8, 'ehf_first', false, 'revision', 0, 'updated_at', null, 'updated_by', null);
  end if;
  return jsonb_build_object('catalog', s.catalog_enabled, 'profile', s.profile_enabled, 'learning', s.learning_enabled,
    'self_check', s.self_check_enabled, 'strong_config_id', s.strong_config_id, 'max_examples', s.max_examples,
    'ehf_first', s.ehf_first, 'revision', s.revision, 'updated_at', s.updated_at, 'updated_by', s.updated_by);
end $function$;

create or replace function public.rm_save_ehf_first(p_legal_entity_id uuid, p_enabled boolean, p_expected_revision integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := public._rm_reading_approve_guard(p_legal_entity_id);
  v_cur integer;
  v_before jsonb;
  v_new public.invoice_reading_settings%rowtype;
begin
  if p_enabled is null then
    return jsonb_build_object('ok', false, 'code', 'ugyldig');
  end if;
  perform pg_advisory_xact_lock(hashtext('rm_reading_settings:' || p_legal_entity_id::text));
  select revision into v_cur from public.invoice_reading_settings where legal_entity_id = p_legal_entity_id;
  if coalesce(v_cur, 0) <> coalesce(p_expected_revision, -1) then
    return jsonb_build_object('ok', false, 'code', 'endret', 'revision', coalesce(v_cur, 0));
  end if;
  v_before := public.rm_reading_settings(p_legal_entity_id);
  insert into public.invoice_reading_settings as t (legal_entity_id, ehf_first, revision, updated_at, updated_by)
  values (p_legal_entity_id, p_enabled, 1, now(), v_uid)
  on conflict (legal_entity_id) do update set
      ehf_first = excluded.ehf_first, revision = t.revision + 1, updated_at = now(), updated_by = v_uid
  returning * into v_new;
  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'invoice_reading.ehf_first_saved', 'invoice_reading_settings', p_legal_entity_id, p_legal_entity_id,
    jsonb_build_object('before', v_before, 'after', public.rm_reading_settings(p_legal_entity_id)), null, 'ravarer');
  return jsonb_build_object('ok', true, 'revision', v_new.revision);
end $function$;

revoke all on function public.rm_save_ehf_first(uuid, boolean, integer) from public, anon;
grant execute on function public.rm_save_ehf_first(uuid, boolean, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
-- Linjeskift: limes filen inn med Windows-linjeskift (CR+LF), får funksjonene over et usynlig CR-tegn i kroppen.
-- Denne blokken skriver dem på nytt med bare LF. Gjør ingenting når alt allerede er LF. Rører bare funksjonene over.
do $lf$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = any (array['rm_reading_settings', 'rm_save_ehf_first'])
              and p.prokind = 'f' and strpos(p.prosrc, chr(13)) > 0 loop
    execute replace(pg_get_functiondef(r.oid), chr(13), '');
  end loop;
end $lf$;

commit;
