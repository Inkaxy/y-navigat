-- VENTER PÅ ROOT. 20261120_slaa_sammen_varer.del01av07.PENDING.sql – del 1 av 7 av 20261120_slaa_sammen_varer.PENDING.sql (12971 byte tekst).
-- Legger bare teksten i mellomlagringen og kontrollerer md5. Ingen virkning på appen før del 7 («kjør»).
-- Kan kjøres på nytt (overskriver samme del). md5 for delen: e243c19959b8b8d712d377d9b4ed2e98

create table if not exists public._rm_sql_stage (file text not null, part int not null, body text not null,
  created_at timestamptz not null default now(), primary key (file, part));
alter table public._rm_sql_stage enable row level security;
revoke all on public._rm_sql_stage from public, anon, authenticated;
insert into public._rm_sql_stage (file, part, body) values ('20261120_slaa_sammen_varer', 1, $stage$-- =====================================================================================================
-- 20261120_slaa_sammen_varer.PENDING.sql — «Slå sammen varer» (Råvarer › Varer). Henrik Næss 17.11.2026.
-- VENTER PÅ ROOT. Kjøres som én transaksjon (begin/commit i filen). Kjør .check.sql etterpå.
--
-- Ved kjøring endres INGEN eksisterende rader. Data endres først når en godkjenner/admin trykker
-- «Slå sammen» (p_dry_run=false) eller «Angre sammenslåing». Standard er alltid dry_run (forhåndsvisning):
-- hele sammenslåingen kjøres og rulles tilbake, slik at forhåndsvisningen bruker nøyaktig samme kode.
--
-- Nytt (additivt):
--   * raw_materials.merged_into_id / merged_at / merge_id (nullbare) + vakt-trigger (bare sammenslåingen skriver dem)
--   * tabellen rm_material_merges (hva som ble flyttet = angreloggen; RLS: lesing for Råvarer-lesere, ingen klientskriving)
--   * _rm_merge_core / _rm_merge_undo_core (ikke kallbare fra klient), rm_merge_raw_materials, rm_undo_material_merge,
--     rm_merge_facts, rm_cap_slaa_sammen_v1, hjelpefunksjoner _rm_merge_*
-- Endret (md5-vakt mot live 17.11.2026):
--   * merge_raw_materials(uuid,uuid): delegerer til rm_merge_raw_materials (én sammenslåingsvei). Den gamle versjonen
--     slettet duplikatet uten angring; den nye setter det inaktivt og krever godkjenner/admin.
-- =====================================================================================================

do $$
begin
  if md5(pg_get_functiondef('public.merge_raw_materials(uuid,uuid)'::regprocedure)) <> '3c2ed3ccedddc6c117e3ca2899f916e4' then
    raise exception 'merge_raw_materials er endret etter 17.11.2026 – les live-definisjonen før denne filen kjøres';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'raw_materials' and column_name = 'merged_into_id') then
    raise exception 'raw_materials.merged_into_id finnes allerede – filen er kjørt før';
  end if;
end $$;

-- ---------- 1. Angrelogg ----------
create table public.rm_material_merges (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.legal_entities(id),
  keep_id uuid not null references public.raw_materials(id),
  merged_ids uuid[] not null,
  op_id uuid not null unique,
  request jsonb not null,
  result jsonb not null,
  undo_log jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid,
  undo_result jsonb,
  undo_op_id uuid unique
);
grant select on public.rm_material_merges to authenticated;
grant all on public.rm_material_merges to service_role;
alter table public.rm_material_merges enable row level security;
create policy rm_material_merges_read on public.rm_material_merges for select to authenticated
  using (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'::public.access_level));
create index rm_material_merges_keep_idx on public.rm_material_merges (keep_id);

alter table public.raw_materials
  add column merged_into_id uuid references public.raw_materials(id),
  add column merged_at timestamptz,
  add column merge_id uuid references public.rm_material_merges(id);
create index raw_materials_merged_into_idx on public.raw_materials (merged_into_id) where merged_into_id is not null;

create or replace function public._rm_merge_fields_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('rm.merge_write', true), '') = 'on' then return new; end if;
  if (new.merged_into_id, new.merged_at, new.merge_id) is distinct from (old.merged_into_id, old.merged_at, old.merge_id) then
    raise exception 'sammenslaing_felt: bruk «Slå sammen» eller «Angre sammenslåing»' using errcode = '42501';
  end if;
  if new.merged_into_id is not null and new.is_active then
    raise exception 'sammenslatt_vare: angre sammenslåingen for å bruke varen igjen' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_rm_merge_fields_guard before update on public.raw_materials
  for each row execute function public._rm_merge_fields_guard();

-- ---------- 2. Hjelpere ----------
create or replace function public._rm_merge_push(p_log jsonb, p_key text, p_items jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(p_log, '{}'::jsonb) || jsonb_build_object(p_key, coalesce(p_log -> p_key, '[]'::jsonb) || coalesce(p_items, '[]'::jsonb))
$$;

create or replace function public._rm_merge_add(p_counts jsonb, p_key text, p_n bigint) returns jsonb
language sql immutable set search_path = public as $$
  select case when coalesce(p_n, 0) = 0 then coalesce(p_counts, '{}'::jsonb)
    else coalesce(p_counts, '{}'::jsonb) || jsonb_build_object(p_key, coalesce((p_counts ->> p_key)::bigint, 0) + p_n) end
$$;

create or replace function public._rm_merge_conf(p_code text, p_text text, p_blocking boolean) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_array(jsonb_build_object('code', p_code, 'text', p_text, 'blocking', p_blocking))
$$;

-- Antall beholdt-enheter per én duplikat-enhet. Null = kan ikke regnes om (med denne stykkvekten).
create or replace function public._rm_merge_unit_factor(p_keep text, p_dup text, p_gpp numeric) returns numeric
language plpgsql immutable set search_path = public as $$
declare
  k text := lower(btrim(coalesce(p_keep, ''))); d text := lower(btrim(coalesce(p_dup, '')));
  km numeric := case k when 'kg' then 1000 when 'g' then 1 end;
  dm numeric := case d when 'kg' then 1000 when 'g' then 1 end;
  kv numeric := case k when 'l' then 1000 when 'dl' then 100 when 'cl' then 10 when 'ml' then 1 end;
  dv numeric := case d when 'l' then 1000 when 'dl' then 100 when 'cl' then 10 when 'ml' then 1 end;
begin
  if k = '' or d = '' then return null; end if;
  if k = d then return 1; end if;
  if km is not null and dm is not null then return dm / km; end if;
  if kv is not null and dv is not null then return dv / kv; end if;
  if p_gpp is null or not (p_gpp > 0) or p_gpp > 1000000 then return null; end if;
  if k = 'stk' and dm is not null then return dm / p_gpp; end if;
  if d = 'stk' and km is not null then return p_gpp / km; end if;
  return null;
end $$;

-- Vekt ↔ stk kan regnes om med stykkvekt; alt annet med ulik enhetsfamilie kan ikke.
create or replace function public._rm_merge_needs_weight(p_keep text, p_dup text) returns boolean
language sql immutable set search_path = public as $$
  select (lower(btrim(coalesce(p_keep, ''))) = 'stk' and lower(btrim(coalesce(p_dup, ''))) in ('kg', 'g'))
      or (lower(btrim(coalesce(p_dup, ''))) = 'stk' and lower(btrim(coalesce(p_keep, ''))) in ('kg', 'g'))
$$;

-- Tilbake ved angring: gammel verdi når dagens verdi fortsatt er den sammenslåingen skrev, ellers dagens verdi regnet tilbake.
create or replace function public._rm_merge_back(p_cur numeric, p_old numeric, p_f numeric, p_kind text) returns numeric
language sql immutable set search_path = public as $$
  select case
    when p_cur is null then null
    when p_f is null or p_f = 1 then p_cur
    when p_kind = 'qty' and p_cur = p_old * p_f then p_old
    when p_kind = 'price' and p_cur = p_old / p_f then p_old
    when p_kind = 'qty' then p_cur / p_f
    else p_cur * p_f end
$$;

-- ---------- 3. Sammenslåing ----------
create or replace function public._rm_merge_core(
  p_uid uuid, p_keep uuid, p_dups uuid[], p_grams_per_piece jsonb, p_fields jsonb, p_reason text, p_dry_run boolean, p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_keep public.raw_materials%rowtype;
  v_dup public.raw_materials%rowtype;
  v_le uuid; v_dups uuid[]; v_d uuid; v_f numeric; v_gpp numeric; v_gpp_used numeric;
  v_factor jsonb := '{}'::jsonb; v_log jsonb := '{}'::jsonb; v_counts jsonb := '{}'::jsonb; v_conf jsonb := '[]'::jsonb;
  v_j jsonb; v_n bigint; v_n2 bigint; v_pkg_before uuid[]; v_rms_map jsonb := '{}'::jsonb;
  v_merge_id uuid := gen_random_uuid(); v_now timestamptz := now();
  v_existing public.rm_material_merges%rowtype;
  v_before jsonb; v_after jsonb; v_cost_before jsonb; v_cost_after jsonb; v_result jsonb;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'Slått sammen like varer');
  v_blocking boolean; v_allergens_moved boolean := false; v_parent_moved boolean := false;
  v_name text; v_cat text; v_cats text[]; v_type text; v_src uuid; v_st public.alias_status; v_cb uuid; v_ca timestamptz;
  r record; kr record; x record;
begin
  if p_op_id is null then return jsonb_build_object('ok', false, 'code', 'op_id_mangler'); end if;
  if p_keep is null or p_dups is null or cardinality(p_dups) < 1 or cardinality(p_dups) > 10 then
    return jsonb_build_object('ok', false, 'code', 'ugyldig_utvalg');
  end if;
  select array_agg(distinct u order by u) into v_dups from unnest(p_dups) u where u is not null;
  if v_dups is null or cardinality(v_dups) <> cardinality(p_dups) or p_keep = any(v_dups) then
    return jsonb_build_object('ok', false, 'code', 'ugyldig_utvalg');
  end if;
  if not p_dry_run then
    select * into v_existing from public.rm_material_merges where op_id = p_op_id;
    if found then
      if v_existing.keep_id = p_keep and v_existing.merged_ids = v_dups then
        return v_existing.result || jsonb_build_object('replay', true);
      end if;
      return jsonb_build_object('ok', false, 'code', 'op_id_brukt');
    end if;
  end if;

  perform 1 from public.raw_materials where id = p_keep or id = any(v_dups) order by id for update;
  select * into v_keep from public.raw_materials where id = p_keep;
  if not found then return jsonb_build_object('ok', false, 'code', 'finnes_ikke', 'id', p_keep); end if;
  v_le := v_keep.legal_entity_id;
  if p_uid is null then
    if not p_dry_run then return jsonb_build_object('ok', false, 'code', 'ikke_innlogget'); end if;
  elsif not public.has_ravarer_access(p_uid, v_le, 'approve'::public.access_level) then
    return jsonb_build_object('ok', false, 'code', 'ingen_tilgang');
  end if;
  if v_keep.merged_into_id is not null then return jsonb_build_object('ok', false, 'code', 'beholdt_er_sammenslatt'); end if;
  if not v_keep.is_active then return jsonb_build_object('ok', false, 'code', 'beholdt_inaktiv'); end if;

  if p_fields is not null and jsonb_typeof(p_fields) <> 'object' then return jsonb_build_object('ok', false, 'code', 'ugyldige_felt'); end if;
  for x in select key, value from jsonb_each(coalesce(p_fields, '{}'::jsonb)) loop
    if x.key not in ('name', 'category', 'item_type') or jsonb_typeof(x.value) <> 'string'
       or not ((x.value #>> '{}') = p_keep::text or (x.value #>> '{}') = any(v_dups::text[])) then
      return jsonb_build_object('ok', false, 'code', 'ugyldige_felt');
    end if;
  end loop;
  if p_grams_per_piece is not null and jsonb_typeof(p_grams_per_piece) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'ugyldig_omregning');
  end if;

  foreach v_d in array v_dups loop
    select * into v_dup from public.raw_materials where id = v_d;
    if not found then return jsonb_build_object('ok', false, 'code', 'finnes_ikke', 'id', v_d); end if;
    if v_dup.legal_entity_id <> v_le then return jsonb_build_object('ok', false, 'code', 'annet_selskap', 'id', v_d); end if;
    if v_dup.merged_into_id is not null then return jsonb_build_object('ok', false, 'code', 'allerede_sammenslatt', 'id', v_d); end if;
    if exists (select 1 from public.raw_materials where merged_into_id = v_d) then
      return jsonb_build_object('ok', false, 'code', 'er_beholdt_i_annen_sammenslaing', 'id', v_d);
    end if;
    v_gpp := case when jsonb_typeof(p_grams_per_piece -> v_d::text) = 'number' then (p_grams_per_piece ->> v_d::text)::numeric end;
    v_f := public._rm_merge_unit_factor(v_keep.base_unit, v_dup.base_unit, null);
    if v_f is null then
      if not public._rm_merge_needs_weight(v_keep.base_unit, v_dup.base_unit) then
        return jsonb_build_object('ok', false, 'code', 'enhet_kan_ikke_regnes_om', 'id', v_d, 'keep_unit', v_keep.base_unit, 'dup_unit', v_dup.base_unit);
      end if;
      if v_gpp is null or not (v_gpp > 0) or v_gpp > 1000000 then
        return jsonb_build_object('ok', false, 'code', 'omregning_mangler', 'id', v_d, 'keep_unit', v_keep.base_unit, 'dup_unit', v_dup.base_unit);
      end if;
      if v_gpp_used is not null and v_gpp_used <> v_gpp then return jsonb_build_object('ok', false, 'code', 'ulik_stykkvekt'); end if;
      v_gpp_used := v_gpp;
      v_f := public._rm_merge_unit_factor(v_keep.base_unit, v_dup.base_unit, v_gpp);
      if v_keep.unit_weight_grams is not null and v_keep.unit_weight_grams <> v_gpp then
        v_conf := v_conf || public._rm_merge_conf('stykkvekt_endres',
          format('Stykkvekten på «%s» endres fra %s g til %s g.', v_keep.name, v_keep.unit_weight_grams, v_gpp), false);
      end if;
    end if;
$stage$)
  on conflict (file, part) do update set body = excluded.body, created_at = now();
do $g$ begin
  if (select md5(body) from public._rm_sql_stage where file = '20261120_slaa_sammen_varer' and part = 1) <> 'e243c19959b8b8d712d377d9b4ed2e98' then
    raise exception 'Del 01 er ikke skrevet inn riktig (md5 avviker) – skriv den inn på nytt';
  end if;
end $g$;
