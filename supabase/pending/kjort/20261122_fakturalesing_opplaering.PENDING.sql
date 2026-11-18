-- 20261122_fakturalesing_opplaering.PENDING.sql — IKKE KJØRT. Kjøres av root etter Henriks ja.
-- Forutsetter ingen av de fem filene Henrik godkjente 18.11 (rekkefølgen mellom dem og denne spiller ingen rolle).
--
-- «Opplæring» av fakturaleseren (bestilling 18.11.2026, punkt C1–C5). ALT ER AV: ingen innstilling er på før Henrik
-- slår den på under Råvarer › Innstillinger › Fakturalesing. Uten rad i invoice_reading_settings er alt av.
--
-- HVA SOM LEGGES TIL (bare nye objekter + nye, tomme kolonner):
--  Tabeller
--   1. invoice_reading_settings   – av/på per selskap: varekatalog, leverandørprofil, læring, selvkontroll, sterkere modell.
--   2. invoice_supplier_profiles  – én profil per leverandør (utkast/bekreftet). Bare bekreftede sendes med lesingen.
--   3. invoice_gold_invoices      – fasitfakturaer. Linjene FRYSES ved merkingen (senere endringer endrer ikke fasiten).
--   4. invoice_reading_log        – hvilken vei lesingen tok (første / selvkontroll / sterkere modell) og hva som ble valgt.
--  Kolonner (nye, null som standard) på invoice_extraction_examples: source_kind, invoice_id, invoice_line_id, item_key.
--   Eksisterende rader endres ikke. Ny unik indeks hindrer at samme retting lagres to ganger (gjelder bare nye rader
--   med source_kind).
--  Funksjoner (alle SECURITY DEFINER, search_path=public, ingen anon-tilgang)
--   rm_reading_settings / rm_save_reading_settings / rm_reading_model_options
--   rm_supplier_reading_catalog                      – kjente varer per leverandør (varenummer trykt/normalisert, navn,
--                                                      skrivemåter, bekreftet pakning, grunnenhet)
--   rm_supplier_profiles / rm_supplier_profile_draft_stats / rm_save_supplier_profile / rm_supplier_profile_for_reading
--   rm_record_extraction_example                     – lagrer en MENNESKELIG retting som eksempel (krever innlogget bruker,
--                                                      skrivetilgang og at «Læring» er på). Tjenestekall (samlet gjenlesing,
--                                                      import) kan ikke lagre eksempler: auth.uid() må finnes.
--   rm_extraction_examples_list / rm_extraction_examples_for_v2 (å slå eksempler av/på bruker DAGENS
--   rm_set_extraction_example_active, uendret: skrivetilgang; å slå på igjen krever begrunnelse og trygg linje)
--   rm_mark_gold_invoice / rm_unmark_gold_invoice / rm_gold_invoices
--   rm_cap_fakturalesing_v1                          – markør; appen viser bryterne først når den finnes.
--
-- HVA SOM IKKE ENDRES: ingen eksisterende funksjon, trigger, policy eller tilgang endres; ingen eksisterende rad
-- endres eller slettes; lesing, kobling, pris, kostpris, godkjenning og «Ferdig»-regelen er uendret.
-- Gjeldende fakturaleser bruker ingenting av dette før serverkoden i supabase/pending/functions er rullet ut
-- (venter på Henriks ja) OG innstillingen er slått på.
--
-- Tilgang: lese = fakturatilgang read (has_ravarer_invoice_access); endre innstillinger, profiler og fasit =
-- godkjenner/admin (has_ravarer_invoice_approve). Lagre eksempel = skrivetilgang.
-- Stopper hvis filen alt er kjørt.

begin;

do $$
begin
  if to_regprocedure('public.rm_cap_fakturalesing_v1()') is not null then
    raise exception '20261122_fakturalesing_opplaering er allerede kjørt';
  end if;
  if to_regclass('public.invoice_extraction_examples') is null or to_regclass('public.ai_provider_config') is null then
    raise exception 'forutsetning mangler: invoice_extraction_examples/ai_provider_config';
  end if;
  if to_regprocedure('public.has_ravarer_invoice_approve(uuid)') is null or to_regprocedure('public.has_ravarer_invoice_access(uuid,text)') is null then
    raise exception 'forutsetning mangler: tilgangsfunksjonene';
  end if;
end $$;

-- 1. Innstillinger ------------------------------------------------------------------------------------------------
create table public.invoice_reading_settings (
  legal_entity_id uuid primary key references public.legal_entities(id) on delete cascade,
  catalog_enabled boolean not null default false,
  profile_enabled boolean not null default false,
  learning_enabled boolean not null default false,
  self_check_enabled boolean not null default false,
  strong_config_id uuid references public.ai_provider_config(id) on delete set null,
  max_examples integer not null default 8 check (max_examples between 1 and 20),
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
grant select on public.invoice_reading_settings to authenticated;
grant all on public.invoice_reading_settings to service_role;
alter table public.invoice_reading_settings enable row level security;
create policy "Fakturatilgang kan lese leserinnstillinger" on public.invoice_reading_settings
  for select to authenticated using (public.has_ravarer_invoice_access(legal_entity_id, 'read'));

-- 2. Leverandørprofiler ------------------------------------------------------------------------------------------
create table public.invoice_supplier_profiles (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  status text not null default 'utkast' check (status in ('utkast', 'bekreftet')),
  profile jsonb not null default '{}'::jsonb check (jsonb_typeof(profile) = 'object'),
  draft_source jsonb not null default '{}'::jsonb check (jsonb_typeof(draft_source) = 'object'),
  revision integer not null default 1,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (legal_entity_id, supplier_id)
);
grant select on public.invoice_supplier_profiles to authenticated;
grant all on public.invoice_supplier_profiles to service_role;
alter table public.invoice_supplier_profiles enable row level security;
create policy "Fakturatilgang kan lese leverandørprofiler" on public.invoice_supplier_profiles
  for select to authenticated using (public.has_ravarer_invoice_access(legal_entity_id, 'read'));

-- 3. Fasitfakturaer ----------------------------------------------------------------------------------------------
create table public.invoice_gold_invoices (
  invoice_id uuid primary key references public.invoices(id) on delete cascade,
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  line_count integer not null,
  header jsonb not null default '{}'::jsonb,
  note text,
  is_active boolean not null default true,
  marked_by uuid not null,
  marked_at timestamptz not null default now(),
  unmarked_by uuid,
  unmarked_at timestamptz
);
create index invoice_gold_invoices_le_idx on public.invoice_gold_invoices (legal_entity_id) where is_active;
grant select on public.invoice_gold_invoices to authenticated;
grant all on public.invoice_gold_invoices to service_role;
alter table public.invoice_gold_invoices enable row level security;
create policy "Fakturatilgang kan lese fasitfakturaer" on public.invoice_gold_invoices
  for select to authenticated using (public.has_ravarer_invoice_access(legal_entity_id, 'read'));

-- 4. Leselogg ----------------------------------------------------------------------------------------------------
create table public.invoice_reading_log (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  source text not null check (source in ('import', 'manuell', 'gjenlesing', 'maling')),
  settings_key text,
  path text[] not null default '{}',
  chosen text,
  attempts jsonb not null default '[]'::jsonb check (jsonb_typeof(attempts) = 'array'),
  catalog_items integer,
  examples_used integer,
  profile_used boolean,
  created_at timestamptz not null default now()
);
create index invoice_reading_log_le_created_idx on public.invoice_reading_log (legal_entity_id, created_at desc);
grant select on public.invoice_reading_log to authenticated;
grant all on public.invoice_reading_log to service_role;
alter table public.invoice_reading_log enable row level security;
create policy "Fakturatilgang kan lese leseloggen" on public.invoice_reading_log
  for select to authenticated using (public.has_ravarer_invoice_access(legal_entity_id, 'read'));

-- 5. Nye kolonner på eksempler -----------------------------------------------------------------------------------
alter table public.invoice_extraction_examples
  add column if not exists source_kind text,
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null,
  add column if not exists invoice_line_id uuid references public.invoice_lines(id) on delete set null,
  add column if not exists item_key text;
create unique index if not exists invoice_extraction_examples_dedup_idx
  on public.invoice_extraction_examples (legal_entity_id, supplier_id, coalesce(item_key, ''), source_kind, md5(corrected::text))
  where source_kind is not null;

-- Funksjoner ------------------------------------------------------------------------------------------------------
create or replace function public._rm_reading_read_guard(p_legal_entity_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.has_ravarer_invoice_access(p_legal_entity_id, 'read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function public._rm_reading_approve_guard(p_legal_entity_id uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid := auth.uid();
begin
  if v is null or not public.has_ravarer_invoice_approve(p_legal_entity_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function public.rm_reading_settings(p_legal_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.invoice_reading_settings%rowtype;
begin
  perform public._rm_reading_read_guard(p_legal_entity_id);
  select * into s from public.invoice_reading_settings where legal_entity_id = p_legal_entity_id;
  if not found then
    return jsonb_build_object('catalog', false, 'profile', false, 'learning', false, 'self_check', false,
      'strong_config_id', null, 'max_examples', 8, 'revision', 0, 'updated_at', null, 'updated_by', null);
  end if;
  return jsonb_build_object('catalog', s.catalog_enabled, 'profile', s.profile_enabled, 'learning', s.learning_enabled,
    'self_check', s.self_check_enabled, 'strong_config_id', s.strong_config_id, 'max_examples', s.max_examples,
    'revision', s.revision, 'updated_at', s.updated_at, 'updated_by', s.updated_by);
end $$;

create or replace function public.rm_save_reading_settings(p_legal_entity_id uuid, p_settings jsonb, p_expected_revision integer)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := public._rm_reading_approve_guard(p_legal_entity_id);
  v_cur integer;
  v_strong uuid;
  v_new public.invoice_reading_settings%rowtype;
  v_before jsonb;
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'ugyldig');
  end if;
  perform pg_advisory_xact_lock(hashtext('rm_reading_settings:' || p_legal_entity_id::text));
  select revision into v_cur from public.invoice_reading_settings where legal_entity_id = p_legal_entity_id;
  if coalesce(v_cur, 0) <> coalesce(p_expected_revision, -1) then
    return jsonb_build_object('ok', false, 'code', 'endret', 'revision', coalesce(v_cur, 0));
  end if;
  if p_settings ? 'strong_config_id' and jsonb_typeof(p_settings->'strong_config_id') = 'string' then
    select id into v_strong from public.ai_provider_config
     where id::text = p_settings->>'strong_config_id' and purpose = 'invoice_extraction';
    if v_strong is null then
      return jsonb_build_object('ok', false, 'code', 'ukjent_modell');
    end if;
  end if;
  v_before := public.rm_reading_settings(p_legal_entity_id);
  insert into public.invoice_reading_settings as t (legal_entity_id, catalog_enabled, profile_enabled, learning_enabled, self_check_enabled,
      strong_config_id, max_examples, revision, updated_at, updated_by)
  values (p_legal_entity_id,
      coalesce(p_settings->'catalog' = 'true'::jsonb, false), coalesce(p_settings->'profile' = 'true'::jsonb, false),
      coalesce(p_settings->'learning' = 'true'::jsonb, false), coalesce(p_settings->'self_check' = 'true'::jsonb, false),
      v_strong, least(20, greatest(1, case when jsonb_typeof(p_settings->'max_examples') = 'number' then (p_settings->>'max_examples')::numeric::integer else 8 end)), 1, now(), v_uid)
  on conflict (legal_entity_id) do update set
      catalog_enabled = excluded.catalog_enabled, profile_enabled = excluded.profile_enabled,
      learning_enabled = excluded.learning_enabled, self_check_enabled = excluded.self_check_enabled,
      strong_config_id = excluded.strong_config_id, max_examples = excluded.max_examples,
      revision = t.revision + 1, updated_at = now(), updated_by = v_uid
  returning * into v_new;
  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'invoice_reading.settings_saved', 'invoice_reading_settings', p_legal_entity_id, p_legal_entity_id,
    jsonb_build_object('before', v_before, 'after', public.rm_reading_settings(p_legal_entity_id)), null, 'ravarer');
  return jsonb_build_object('ok', true, 'revision', v_new.revision);
end $$;

create or replace function public.rm_reading_model_options(p_legal_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._rm_reading_approve_guard(p_legal_entity_id);
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'provider', c.provider, 'model', c.model, 'is_active', c.is_active) order by c.is_active desc, c.model)
    from public.ai_provider_config c where c.purpose = 'invoice_extraction'), '[]'::jsonb);
end $$;

-- C1 Varekatalog
create or replace function public.rm_supplier_reading_catalog(p_legal_entity_id uuid, p_supplier_id uuid, p_limit integer default 400)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._rm_reading_read_guard(p_legal_entity_id);
  if not exists (select 1 from public.suppliers s where s.id = p_supplier_id and s.legal_entity_id = p_legal_entity_id) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb - 'ord' order by x.ord desc nulls last)
    from (
      select
        nullif(public.rm_sku_norm(rms.supplier_sku), '') as sku_norm,
        (select coalesce(array_agg(distinct v), '{}') from (
            select btrim(rms.supplier_sku) v where coalesce(btrim(rms.supplier_sku), '') <> ''
            union select btrim(a.alias_value) from public.raw_material_supplier_aliases a
             where a.raw_material_supplier_id = rms.id and a.alias_type::text = 'supplier_sku' and a.status::text = 'confirmed'
               and coalesce(btrim(a.alias_value), '') <> '') q) as sku_printed,
        coalesce(nullif(btrim(rms.supplier_product_name), ''), rm.name) as name,
        (select coalesce(array_agg(distinct v), '{}') from (
            select btrim(a.alias_value) v from public.raw_material_supplier_aliases a
             where a.raw_material_supplier_id = rms.id and a.alias_type::text = 'product_name' and a.status::text = 'confirmed'
               and coalesce(btrim(a.alias_value), '') <> ''
            union select rm.name where rm.name is distinct from rms.supplier_product_name) q) as aliases,
        case when rms.package_confirmed_at is not null and (rms.package_size is not null or rms.base_units_per_package is not null)
          then jsonb_build_object('size', rms.package_size, 'unit', rms.package_unit, 'count', null, 'base_units', rms.base_units_per_package)
          else null end as package,
        rm.base_unit,
        coalesce(rms.last_invoice_date, rms.updated_at::date) as ord
      from public.raw_material_suppliers rms
      join public.raw_materials rm on rm.id = rms.raw_material_id and rm.legal_entity_id = p_legal_entity_id
      where rms.supplier_id = p_supplier_id and coalesce(rm.is_active, true)
      order by coalesce(rms.last_invoice_date, rms.updated_at::date) desc nulls last
      limit least(greatest(coalesce(p_limit, 400), 1), 1000)
    ) x), '[]'::jsonb);
end $$;

-- C2 Leverandørprofil
create or replace function public.rm_supplier_profiles(p_legal_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._rm_reading_read_guard(p_legal_entity_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'supplier_id', s.id, 'supplier_name', s.name, 'invoice_count', coalesce(s.invoice_count, 0),
      'status', p.status, 'revision', coalesce(p.revision, 0), 'profile', p.profile, 'draft_source', p.draft_source,
      'confirmed_at', p.confirmed_at, 'confirmed_by', p.confirmed_by, 'updated_at', p.updated_at) order by coalesce(s.invoice_count, 0) desc, s.name)
    from public.suppliers s
    left join public.invoice_supplier_profiles p on p.supplier_id = s.id and p.legal_entity_id = s.legal_entity_id
    where s.legal_entity_id = p_legal_entity_id and (s.track_invoice_lines or p.id is not null)), '[]'::jsonb);
end $$;

create or replace function public.rm_supplier_profile_draft_stats(p_legal_entity_id uuid, p_supplier_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[];
begin
  perform public._rm_reading_read_guard(p_legal_entity_id);
  select coalesce(array_agg(id), '{}') into v_ids from (
    select i.id from public.invoices i
     where i.legal_entity_id = p_legal_entity_id and i.supplier_id = p_supplier_id and i.status <> 'cancelled'
       and exists (select 1 from public.invoice_lines l where l.invoice_id = i.id)
     order by (i.lines_sum_status = 'ok') desc, i.invoice_date desc nulls last, i.created_at desc
     limit 5) q;
  return (
    with l as (select * from public.invoice_lines where invoice_id = any(v_ids))
    select jsonb_build_object(
      'invoice_ids', to_jsonb(v_ids),
      'invoices', coalesce(array_length(v_ids, 1), 0),
      'lines', (select count(*) from l),
      'vare_lines', (select count(*) from l where coalesce(line_kind, 'vare') = 'vare'),
      'sku_missing', (select count(*) from l where coalesce(line_kind, 'vare') = 'vare' and coalesce(btrim(supplier_sku), '') = ''),
      'sku_examples', coalesce((select jsonb_agg(v) from (select distinct btrim(supplier_sku) v from l where coalesce(btrim(supplier_sku), '') <> '' limit 20) q), '[]'::jsonb),
      'units', coalesce((select jsonb_agg(jsonb_build_object('unit', u, 'n', n) order by n desc) from (select lower(unit) u, count(*) n from l where unit is not null group by 1) q), '[]'::jsonb),
      'line_kinds', coalesce((select jsonb_agg(jsonb_build_object('kind', k, 'n', n) order by n desc) from (select coalesce(line_kind, 'vare') k, count(*) n from l group by 1) q), '[]'::jsonb),
      'package_examples', coalesce((select jsonb_agg(v) from (select distinct substring(description from '(\d+\s*[xX]\s*\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl|dl|stk|KG|G|L|ML|CL|DL|STK))') v from l
          where description ~ '\d+\s*[xX]\s*\d' limit 10) q where v is not null), '[]'::jsonb),
      'discount_lines', (select count(*) from l where coalesce(discount_amount, 0) <> 0),
      'credit_notes', (select count(*) from public.invoices where id = any(v_ids) and is_credit_note),
      'descriptions_dpak', (select count(*) from l where description ~* '(^|[^a-z])d-?pak'),
      'descriptions_fpak', (select count(*) from l where description ~* '(^|[^a-z])f-?pak')));
end $$;

create or replace function public.rm_save_supplier_profile(p_legal_entity_id uuid, p_supplier_id uuid, p_profile jsonb, p_status text,
  p_expected_revision integer, p_draft_source jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := public._rm_reading_approve_guard(p_legal_entity_id);
  v_cur public.invoice_supplier_profiles%rowtype;
  v_rev integer;
begin
  if p_status not in ('utkast', 'bekreftet') or p_profile is null or jsonb_typeof(p_profile) <> 'object' or length(p_profile::text) > 20000 then
    return jsonb_build_object('ok', false, 'code', 'ugyldig');
  end if;
  if not exists (select 1 from public.suppliers s where s.id = p_supplier_id and s.legal_entity_id = p_legal_entity_id) then
    return jsonb_build_object('ok', false, 'code', 'ukjent_leverandor');
  end if;
  perform pg_advisory_xact_lock(hashtext('rm_supplier_profile:' || p_supplier_id::text));
  select * into v_cur from public.invoice_supplier_profiles where legal_entity_id = p_legal_entity_id and supplier_id = p_supplier_id;
  if coalesce(v_cur.revision, 0) <> coalesce(p_expected_revision, -1) then
    return jsonb_build_object('ok', false, 'code', 'endret', 'revision', coalesce(v_cur.revision, 0));
  end if;
  insert into public.invoice_supplier_profiles as t (legal_entity_id, supplier_id, status, profile, draft_source, revision,
      confirmed_by, confirmed_at, updated_at, updated_by)
  values (p_legal_entity_id, p_supplier_id, p_status, p_profile,
      case when p_draft_source is not null and jsonb_typeof(p_draft_source) = 'object' then p_draft_source else '{}'::jsonb end, 1,
      case when p_status = 'bekreftet' then v_uid end, case when p_status = 'bekreftet' then now() end, now(), v_uid)
  on conflict (legal_entity_id, supplier_id) do update set
      status = excluded.status, profile = excluded.profile,
      draft_source = case when p_draft_source is not null and jsonb_typeof(p_draft_source) = 'object' then p_draft_source else t.draft_source end,
      revision = t.revision + 1,
      confirmed_by = case when excluded.status = 'bekreftet' then v_uid else null end,
      confirmed_at = case when excluded.status = 'bekreftet' then now() else null end,
      updated_at = now(), updated_by = v_uid
  returning revision into v_rev;
  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'invoice_reading.supplier_profile_saved', 'supplier', p_supplier_id, p_legal_entity_id,
    jsonb_build_object('before', case when v_cur.id is null then null else jsonb_build_object('status', v_cur.status, 'profile', v_cur.profile) end,
      'after', jsonb_build_object('status', p_status, 'profile', p_profile)), null, 'ravarer');
  return jsonb_build_object('ok', true, 'revision', v_rev, 'status', p_status);
end $$;

create or replace function public.rm_supplier_profile_for_reading(p_legal_entity_id uuid, p_supplier_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._rm_reading_read_guard(p_legal_entity_id);
  return (select p.profile from public.invoice_supplier_profiles p
           where p.legal_entity_id = p_legal_entity_id and p.supplier_id = p_supplier_id and p.status = 'bekreftet');
end $$;

-- C3 Læring av rettinger
create or replace function public.rm_record_extraction_example(p_line_id uuid, p_kind text, p_corrected jsonb, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  l public.invoice_lines%rowtype;
  v public.invoices%rowtype;
  v_corr jsonb := '{}'::jsonb;
  v_key text;
  v_sku text;
  v_id uuid;
  k text;
  allowed constant text[] := array['supplier_sku', 'description', 'quantity', 'unit', 'package_size', 'package_unit', 'count_per_package',
    'unit_price', 'total_amount', 'line_kind', 'unit_price_basis', 'discount_amount', 'raw_material_name', 'base_unit', 'not_item', 'base_units_per_package'];
begin
  -- Bare innloggede mennesker: tjenestekall (samlet gjenlesing, import, cron) kan aldri lage eksempler.
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('kobling', 'pakning', 'varenummer', 'antall', 'ikke_vare', 'retting') then
    return jsonb_build_object('ok', false, 'code', 'ugyldig');
  end if;
  if p_corrected is null or jsonb_typeof(p_corrected) <> 'object' then return jsonb_build_object('ok', false, 'code', 'ugyldig'); end if;
  select * into l from public.invoice_lines where id = p_line_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'ukjent_linje'); end if;
  select * into v from public.invoices where id = l.invoice_id;
  if not public.has_ravarer_invoice_access(v.legal_entity_id, 'write') then raise exception 'forbidden' using errcode = '42501'; end if;
  if v.supplier_id is null then return jsonb_build_object('ok', false, 'code', 'uten_leverandor'); end if;
  if not coalesce((select learning_enabled from public.invoice_reading_settings where legal_entity_id = v.legal_entity_id), false) then
    return jsonb_build_object('ok', false, 'code', 'av');
  end if;
  for k in select jsonb_object_keys(p_corrected) loop
    if k = any(allowed) then
      v_corr := v_corr || jsonb_build_object(k, case when jsonb_typeof(p_corrected->k) = 'string' then to_jsonb(left(p_corrected->>k, 160)) else p_corrected->k end);
    end if;
  end loop;
  if v_corr = '{}'::jsonb then return jsonb_build_object('ok', false, 'code', 'tomt'); end if;
  v_sku := nullif(public.rm_sku_norm(l.supplier_sku), '');
  v_key := case when v_sku is not null then 'sku:' || v_sku else 'name:' || public.rm_match_key(l.description) end;
  insert into public.invoice_extraction_examples (legal_entity_id, supplier_id, supplier_sku_norm, description_key, original, corrected, note,
      is_active, created_by, source_kind, invoice_id, invoice_line_id, item_key)
  values (v.legal_entity_id, v.supplier_id, v_sku, nullif(public.rm_match_key(l.description), ''),
      jsonb_strip_nulls(jsonb_build_object('supplier_sku', l.supplier_sku, 'description', l.description, 'quantity', l.quantity, 'unit', l.unit,
        'package_size', l.package_size, 'package_unit', l.package_unit, 'count_per_package', l.count_per_package, 'unit_price', l.unit_price,
        'total_amount', l.total_amount, 'line_kind', l.line_kind, 'unit_price_basis', l.unit_price_basis, 'discount_amount', l.discount_amount)),
      v_corr, left(nullif(btrim(coalesce(p_note, '')), ''), 300), true, v_uid, p_kind, v.id, l.id, v_key)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.rm_extraction_examples_list(p_legal_entity_id uuid, p_supplier_id uuid default null, p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._rm_reading_read_guard(p_legal_entity_id);
  return coalesce((select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc) from (
    select e.id, e.supplier_id, s.name as supplier_name, e.source_kind, e.supplier_sku_norm, e.description_key, e.original, e.corrected, e.note,
           e.is_active, e.created_at, e.created_by, e.invoice_id, e.deactivated_at, jsonb_array_length(e.accepted_issues) > 0 as has_accepted_issues
      from public.invoice_extraction_examples e join public.suppliers s on s.id = e.supplier_id
     where e.legal_entity_id = p_legal_entity_id and (p_supplier_id is null or e.supplier_id = p_supplier_id)
     order by e.created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 500)) x), '[]'::jsonb);
end $$;

create or replace function public.rm_extraction_examples_for_v2(p_legal_entity_id uuid, p_supplier_id uuid, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._rm_reading_read_guard(p_legal_entity_id);
  return coalesce((select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc) from (
    select e.id, e.supplier_sku_norm, e.description_key, e.original, e.corrected, e.note, e.created_at, e.source_kind
      from public.invoice_extraction_examples e
      join public.suppliers s on s.id = e.supplier_id and s.legal_entity_id = e.legal_entity_id
     where e.legal_entity_id = p_legal_entity_id and e.supplier_id = p_supplier_id and e.is_active
       and jsonb_array_length(e.accepted_issues) = 0
     order by e.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100)) x), '[]'::jsonb);
end $$;

-- C5 Fasit
create or replace function public.rm_mark_gold_invoice(p_invoice_id uuid, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v public.invoices%rowtype; v_uid uuid; v_lines jsonb; v_n integer;
begin
  select * into v from public.invoices where id = p_invoice_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'ukjent_faktura'); end if;
  v_uid := public._rm_reading_approve_guard(v.legal_entity_id);
  perform 1 from public.invoices where id = p_invoice_id for update;
  select coalesce(jsonb_agg(jsonb_build_object('line_number', l.line_number, 'supplier_sku', l.supplier_sku, 'description', l.description,
           'line_kind', l.line_kind, 'quantity', l.quantity, 'unit', l.unit, 'unit_price', l.unit_price, 'total_amount', l.total_amount,
           'package_size', l.package_size, 'package_unit', l.package_unit, 'count_per_package', l.count_per_package,
           'discount_amount', l.discount_amount, 'unit_price_basis', l.unit_price_basis) order by l.line_number, l.created_at), '[]'::jsonb),
         count(*)
    into v_lines, v_n
    from public.invoice_lines l where l.invoice_id = p_invoice_id and l.excluded_at is null;
  if v_n = 0 then return jsonb_build_object('ok', false, 'code', 'ingen_linjer'); end if;
  if v.lines_sum_status = 'mismatch' then return jsonb_build_object('ok', false, 'code', 'sumavvik'); end if;
  insert into public.invoice_gold_invoices as t (invoice_id, legal_entity_id, supplier_id, lines, line_count, header, note, is_active, marked_by, marked_at)
  values (v.id, v.legal_entity_id, v.supplier_id, v_lines, v_n,
          jsonb_build_object('invoice_number', v.invoice_number, 'total_amount', v.total_amount, 'total_vat', v.total_vat, 'is_credit_note', v.is_credit_note),
          left(nullif(btrim(coalesce(p_note, '')), ''), 300), true, v_uid, now())
  on conflict (invoice_id) do update set lines = excluded.lines, line_count = excluded.line_count, header = excluded.header,
     note = excluded.note, is_active = true, marked_by = v_uid, marked_at = now(), unmarked_by = null, unmarked_at = null;
  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'invoice_reading.gold_marked', 'invoice', v.id, v.legal_entity_id, jsonb_build_object('line_count', v_n), p_note, 'ravarer');
  return jsonb_build_object('ok', true, 'line_count', v_n);
end $$;

create or replace function public.rm_unmark_gold_invoice(p_invoice_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_le uuid; v_uid uuid;
begin
  select legal_entity_id into v_le from public.invoice_gold_invoices where invoice_id = p_invoice_id;
  if v_le is null then return jsonb_build_object('ok', false, 'code', 'ukjent'); end if;
  v_uid := public._rm_reading_approve_guard(v_le);
  update public.invoice_gold_invoices set is_active = false, unmarked_by = v_uid, unmarked_at = now() where invoice_id = p_invoice_id;
  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'invoice_reading.gold_unmarked', 'invoice', p_invoice_id, v_le, null, null, 'ravarer');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.rm_gold_invoices(p_legal_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._rm_reading_read_guard(p_legal_entity_id);
  return coalesce((select jsonb_agg(jsonb_build_object('invoice_id', g.invoice_id, 'supplier_id', g.supplier_id, 'supplier_name', s.name,
      'invoice_number', g.header->>'invoice_number', 'line_count', g.line_count, 'lines', g.lines, 'header', g.header, 'note', g.note,
      'marked_at', g.marked_at, 'marked_by', g.marked_by) order by s.name, g.marked_at)
    from public.invoice_gold_invoices g left join public.suppliers s on s.id = g.supplier_id
    where g.legal_entity_id = p_legal_entity_id and g.is_active), '[]'::jsonb);
end $$;

create or replace function public.rm_cap_fakturalesing_v1()
returns boolean language sql stable security invoker set search_path = public as $$ select true $$;

-- Tilgang: hjelpere bare internt; RPC-er for innloggede og tjenesten (serverkoden), aldri anon.
revoke all on function public._rm_reading_read_guard(uuid) from public, anon, authenticated;
revoke all on function public._rm_reading_approve_guard(uuid) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'rm_reading_settings(uuid)', 'rm_save_reading_settings(uuid,jsonb,integer)', 'rm_reading_model_options(uuid)',
    'rm_supplier_reading_catalog(uuid,uuid,integer)', 'rm_supplier_profiles(uuid)', 'rm_supplier_profile_draft_stats(uuid,uuid)',
    'rm_save_supplier_profile(uuid,uuid,jsonb,text,integer,jsonb)', 'rm_supplier_profile_for_reading(uuid,uuid)',
    'rm_record_extraction_example(uuid,text,jsonb,text)', 'rm_extraction_examples_list(uuid,uuid,integer)',
    'rm_extraction_examples_for_v2(uuid,uuid,integer)',
    'rm_mark_gold_invoice(uuid,text)', 'rm_unmark_gold_invoice(uuid)', 'rm_gold_invoices(uuid)', 'rm_cap_fakturalesing_v1()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

commit;
