-- =====================================================================================================
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
begin;

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
    v_factor := v_factor || jsonb_build_object(v_d::text, v_f);

    select count(*) into v_n from public.invoice_lines il where il.raw_material_id = v_d
       and exists (select 1 from public.invoice_line_cost_postings p where p.invoice_line_id = il.id and p.revoked_at is null);
    if v_n > 0 then
      v_conf := v_conf || public._rm_merge_conf('kostpris_fort', format('«%s» har %s fakturalinjer med ført kostpris. De er låst og kan ikke flyttes.', v_dup.name, v_n), true);
    end if;
    select count(*) into v_n from public.vt_count_lines l join public.vt_counts c on c.id = l.count_id
     where l.raw_material_id = v_d and c.status in ('pagar', 'til_kontroll');
    if v_n > 0 then
      v_conf := v_conf || public._rm_merge_conf('apen_telling', format('«%s» står i en åpen varetelling. Avslutt tellingen først.', v_dup.name), true);
    end if;
    if v_f <> 1 then
      select count(*) into v_n from public.recipe_packaging_lines where raw_material_id = v_d;
      if v_n > 0 then
        v_conf := v_conf || public._rm_merge_conf('emballasje_annen_enhet', format('«%s» brukes som emballasje i %s kalkyler med en annen enhet. Bytt dem først.', v_dup.name, v_n), true);
      end if;
    end if;
    if exists (select 1 from public.raw_material_components c
                where (c.parent_raw_material_id = p_keep and c.component_raw_material_id = v_d)
                   or (c.parent_raw_material_id = v_d and c.component_raw_material_id = p_keep)) then
      v_conf := v_conf || public._rm_merge_conf('komponent', format('«%s» og «%s» inngår i hverandres sammensetning.', v_dup.name, v_keep.name), true);
    end if;
    if v_dup.produced_by_recipe_id is not null then
      v_conf := v_conf || public._rm_merge_conf('lages_av_oppskrift', format('«%s» lages av en egen oppskrift og kan ikke slås sammen her.', v_dup.name), true);
    end if;
    if v_keep.declaration_name is not null and v_dup.declaration_name is not null
       and lower(btrim(v_keep.declaration_name)) <> lower(btrim(v_dup.declaration_name)) then
      v_conf := v_conf || public._rm_merge_conf('deklarasjonsnavn_ulikt',
        format('Deklarasjonsnavnet er ulikt («%s» / «%s»). «%s» beholder sitt.', v_keep.declaration_name, v_dup.declaration_name, v_keep.name), false);
    end if;
  end loop;

  v_blocking := exists (select 1 from jsonb_array_elements(v_conf) c where (c ->> 'blocking')::boolean);
  v_cost_before := jsonb_build_object('price', v_keep.current_cost_price, 'status', v_keep.cost_basis_status, 'unit', v_keep.base_unit);
  if v_blocking then
    if not p_dry_run then return jsonb_build_object('ok', false, 'code', 'konflikt', 'conflicts', v_conf); end if;
    -- Forhåndsvisning med sperre: ingen simulering, bare hva som stopper.
    return jsonb_build_object('ok', true, 'dry_run', true, 'can_apply', false, 'merge_id', null, 'keep_id', p_keep,
      'merged_ids', to_jsonb(v_dups), 'counts', '{}'::jsonb, 'conflicts', v_conf,
      'cost', jsonb_build_object('before', v_cost_before, 'after', null), 'factors', v_factor, 'grams_per_piece', v_gpp_used);
  end if;

  begin
    foreach v_d in array v_dups loop
      select * into v_dup from public.raw_materials where id = v_d;
      v_f := (v_factor ->> v_d::text)::numeric;

      -- Koblingsforslag
      with del as (
        delete from public.invoice_line_match_suggestions s where s.raw_material_id = v_d
           and exists (select 1 from public.invoice_line_match_suggestions k where k.invoice_line_id = s.invoice_line_id and k.raw_material_id = p_keep)
        returning s.*)
      select coalesce(jsonb_agg(to_jsonb(del)), '[]') into v_j from del;
      v_log := public._rm_merge_push(v_log, 'suggestions_deleted', v_j);
      with upd as (update public.invoice_line_match_suggestions set raw_material_id = p_keep where raw_material_id = v_d returning id)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]') into v_j from upd;
      v_log := public._rm_merge_push(v_log, 'suggestions_moved', v_j);

      -- Lager (før fakturalinjene, slik at fakturabevegelsene oppdateres i stedet for å slettes)
      with upd as (
        update public.stock_movements m set raw_material_id = p_keep, quantity_base = o.quantity_base * v_f
          from public.stock_movements o
         where o.id = m.id and m.raw_material_id = v_d
           and not (o.source_id is not null and exists (select 1 from public.stock_movements k where k.raw_material_id = p_keep
                      and k.source_table is not distinct from o.source_table and k.source_id = o.source_id))
        returning m.id, o.quantity_base q)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'q', q)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'movements', v_j); v_counts := public._rm_merge_add(v_counts, 'lagerbevegelser', v_n);
      select count(*) into v_n from public.stock_movements where raw_material_id = v_d;
      if v_n > 0 then
        v_conf := v_conf || public._rm_merge_conf('lagerbevegelse_blir_staende', format('%s lagerbevegelser på «%s» gjelder samme kilde som en bevegelse på beholdt vare og blir stående.', v_n, v_dup.name), false);
      end if;
      with upd as (
        update public.rm_stock_lots l set raw_material_id = p_keep, quantity_base = o.quantity_base * v_f, remaining_base = o.remaining_base * v_f
          from public.rm_stock_lots o where o.id = l.id and l.raw_material_id = v_d
        returning l.id, o.quantity_base q, o.remaining_base rb)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'q', q, 'rb', rb)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'lots', v_j); v_counts := public._rm_merge_add(v_counts, 'partier', v_n);
      with upd as (
        update public.rm_goods_receipts g set raw_material_id = p_keep, quantity_base = o.quantity_base * v_f
          from public.rm_goods_receipts o where o.id = g.id and g.raw_material_id = v_d
        returning g.id, o.quantity_base q)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'q', q)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'receipts', v_j); v_counts := public._rm_merge_add(v_counts, 'varemottak', v_n);

      -- Prishistorikk (før fakturalinjene; observasjoner i annen enhet teller ikke for kost, men vises)
      with upd as (
        update public.raw_material_price_history h set raw_material_id = p_keep
          from public.raw_material_price_history o where o.id = h.id and h.raw_material_id = v_d
        returning h.id, o.superseded_at s, o.superseded_reason rs)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 's', s, 'r', rs)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'history', v_j); v_counts := public._rm_merge_add(v_counts, 'prishistorikk', v_n);
      if v_f <> 1 then
        update public.raw_material_price_history set superseded_at = v_now, superseded_reason = 'sammenslatt_annen_enhet'
         where id in (select (e ->> 'id')::uuid from jsonb_array_elements(v_j) e) and superseded_at is null;
      end if;

      -- Leverandørkoblinger, varenumre, skrivemåter, pakninger og avtalepriser
      for r in select * from public.raw_material_suppliers where raw_material_id = v_d order by created_at, id loop
        select * into kr from public.raw_material_suppliers where raw_material_id = p_keep and supplier_id = r.supplier_id;
        if not found then
          if v_f <> 1 then
            with upd as (
              update public.raw_material_supplier_packages p set base_units_per_package = o.base_units_per_package * v_f
                from public.raw_material_supplier_packages o where o.id = p.id and p.raw_material_supplier_id = r.id
              returning p.id, o.base_units_per_package b)
            select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'b', b)), '[]') into v_j from upd;
            v_log := public._rm_merge_push(v_log, 'packages_converted', v_j);
          end if;
          select coalesce(array_agg(id), '{}') into v_pkg_before from public.raw_material_supplier_packages where raw_material_supplier_id = r.id;
          if v_f = 1 then
            update public.raw_material_suppliers s set raw_material_id = p_keep,
                   is_primary = s.is_primary and not exists (select 1 from public.raw_material_suppliers k where k.raw_material_id = p_keep and k.is_primary)
             where s.id = r.id;
          else
            perform set_config('app.rm_start_price_rpc', '1', true);
            update public.raw_material_suppliers s set raw_material_id = p_keep,
                   is_primary = s.is_primary and not exists (select 1 from public.raw_material_suppliers k where k.raw_material_id = p_keep and k.is_primary),
                   base_units_per_package = s.base_units_per_package * v_f,
                   agreed_price_per_base_unit = s.agreed_price_per_base_unit / v_f,
                   start_price_per_base_unit = s.start_price_per_base_unit / v_f,
                   start_price_base_units_per_package = s.start_price_base_units_per_package * v_f,
                   start_price_base_unit = case when s.start_price_base_unit is null then null else v_keep.base_unit end
             where s.id = r.id;
            perform set_config('app.rm_start_price_rpc', '', true);
            -- Pakningsvariant-triggeren lagrer den gamle (uomregnede) pakningen: den gjelder ikke beholdt enhet.
            delete from public.raw_material_supplier_packages
             where raw_material_supplier_id = r.id and id <> all(v_pkg_before) and base_units_per_package = r.base_units_per_package;
          end if;
          select coalesce(jsonb_agg(to_jsonb(id)), '[]') into v_j from public.raw_material_supplier_packages
           where raw_material_supplier_id = r.id and id <> all(v_pkg_before);
          v_log := public._rm_merge_push(v_log, 'packages_created', v_j);
          v_log := public._rm_merge_push(v_log, 'suppliers_moved', jsonb_build_array(jsonb_build_object(
            'id', r.id, 'd', v_d, 'p', r.is_primary, 'b', r.base_units_per_package, 'a', r.agreed_price_per_base_unit,
            'sp', r.start_price_per_base_unit, 'spb', r.start_price_base_units_per_package, 'spu', r.start_price_base_unit)));
          v_counts := public._rm_merge_add(v_counts, 'leverandorkoblinger', 1);
        else
          v_rms_map := v_rms_map || jsonb_build_object(r.id::text, kr.id);
          with upd as (
            update public.raw_material_supplier_aliases a set raw_material_supplier_id = kr.id
             where a.raw_material_supplier_id = r.id and a.status in ('confirmed', 'pending')
               and not exists (select 1 from public.raw_material_supplier_aliases k where k.raw_material_supplier_id = kr.id
                                and k.alias_type = a.alias_type and k.alias_value_normalized = a.alias_value_normalized)
            returning a.id)
          select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', r.id)), '[]'), count(*) into v_j, v_n from upd;
          v_log := public._rm_merge_push(v_log, 'aliases_moved', v_j); v_counts := public._rm_merge_add(v_counts, 'skrivemater', v_n);
          -- Lær leverandørens varenummer og varenavn på beholdt kobling (to varenumre hos samme leverandør er lov).
          for x in select q.t, q.v from (values ('supplier_sku'::public.alias_type, r.supplier_sku), ('product_name'::public.alias_type, r.supplier_product_name)) q(t, v) loop
            continue when x.v is null or btrim(x.v) = '';
            continue when x.t = 'supplier_sku' and public.rm_sku_norm(x.v) = public.rm_sku_norm(kr.supplier_sku);
            continue when x.t = 'product_name' and lower(btrim(x.v)) = lower(btrim(coalesce(kr.supplier_product_name, '')));
            v_src := null;
            select id, status, confirmed_by, confirmed_at into v_src, v_st, v_cb, v_ca from public.raw_material_supplier_aliases
             where raw_material_supplier_id = kr.id and alias_type = x.t and alias_value_normalized = lower(btrim(x.v));
            if v_src is null then
              insert into public.raw_material_supplier_aliases (raw_material_supplier_id, alias_type, alias_value, status, match_count, confirmed_by, confirmed_at, last_seen_at)
              values (kr.id, x.t, btrim(x.v), 'confirmed', 0, p_uid, v_now, v_now) returning id into v_src;
              v_log := public._rm_merge_push(v_log, 'aliases_created', jsonb_build_array(to_jsonb(v_src)));
              v_counts := public._rm_merge_add(v_counts, case when x.t = 'supplier_sku' then 'varenumre_laert' else 'skrivemater' end, 1);
            elsif v_st = 'rejected' then
              v_conf := v_conf || public._rm_merge_conf('avvist_pa_beholdt',
                format('%s «%s» er avvist på «%s» hos denne leverandøren og læres ikke.', case when x.t = 'supplier_sku' then 'Varenummeret' else 'Varenavnet' end, x.v, v_keep.name), false);
            elsif v_st in ('pending', 'superseded') then
              update public.raw_material_supplier_aliases set status = 'confirmed', confirmed_by = p_uid, confirmed_at = v_now where id = v_src;
              v_log := public._rm_merge_push(v_log, 'aliases_status', jsonb_build_array(jsonb_build_object('id', v_src, 's', v_st, 'cb', v_cb, 'ca', v_ca)));
              v_counts := public._rm_merge_add(v_counts, case when x.t = 'supplier_sku' then 'varenumre_laert' else 'skrivemater' end, 1);
            end if;
          end loop;
          with upd as (
            update public.raw_material_supplier_packages p set raw_material_supplier_id = kr.id, base_units_per_package = o.base_units_per_package * v_f
              from public.raw_material_supplier_packages o
             where o.id = p.id and p.raw_material_supplier_id = r.id
               and not exists (select 1 from public.raw_material_supplier_packages k where k.raw_material_supplier_id = kr.id
                     and k.supplier_sku_norm = o.supplier_sku_norm and coalesce(k.package_size, -1) = coalesce(o.package_size, -1)
                     and coalesce(lower(k.package_unit), '') = coalesce(lower(o.package_unit), '') and k.base_units_per_package = o.base_units_per_package * v_f)
            returning p.id, o.base_units_per_package b)
          select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'from', r.id, 'b', b)), '[]'), count(*) into v_j, v_n from upd;
          v_log := public._rm_merge_push(v_log, 'packages_moved', v_j); v_counts := public._rm_merge_add(v_counts, 'pakninger', v_n);
          if r.agreed_price_per_base_unit is not null then
            if kr.agreed_price_per_base_unit is null then
              update public.raw_material_suppliers set agreed_price_per_base_unit = r.agreed_price_per_base_unit / v_f,
                     agreement_valid_from = r.agreement_valid_from, agreement_valid_to = r.agreement_valid_to,
                     agreement_document_url = coalesce(agreement_document_url, r.agreement_document_url)
               where id = kr.id;
              v_log := public._rm_merge_push(v_log, 'agreement_copied', jsonb_build_array(jsonb_build_object(
                'id', kr.id, 'a', kr.agreed_price_per_base_unit, 'vf', kr.agreement_valid_from, 'vt', kr.agreement_valid_to,
                'u', kr.agreement_document_url, 'na', r.agreed_price_per_base_unit / v_f)));
              v_counts := public._rm_merge_add(v_counts, 'avtalepriser', 1);
            else
              v_conf := v_conf || public._rm_merge_conf('avtalepris_finnes', format('Begge varene har avtalepris hos samme leverandør. «%s» beholder sin.', v_keep.name), false);
            end if;
          end if;
          v_conf := v_conf || public._rm_merge_conf('samme_leverandor',
            format('«%s» og «%s» har samme leverandør. Varenummer og varenavn læres på beholdt vare; den gamle koblingen blir stående på varen som slås sammen.', v_dup.name, v_keep.name), false);
        end if;
      end loop;

      -- Fakturalinjer (grunnmengde og pris per grunnenhet regnes om ved ulik enhet; trykte tall endres ikke)
      perform set_config('rm.exclusion_write', 'on', true);
      perform set_config('rm.defer_stats', 'on', true);
      with o as (select id, base_quantity, price_per_base_unit, package_source_rms_id from public.invoice_lines where raw_material_id = v_d),
      upd as (
        update public.invoice_lines il set raw_material_id = p_keep,
               base_quantity = case when v_f <> 1 then o.base_quantity * v_f else il.base_quantity end,
               price_per_base_unit = case when v_f <> 1 then o.price_per_base_unit / v_f else il.price_per_base_unit end,
               package_source_rms_id = coalesce((v_rms_map ->> o.package_source_rms_id::text)::uuid, il.package_source_rms_id)
          from o where il.id = o.id
        returning il.id, o.base_quantity bq, o.price_per_base_unit pp, o.package_source_rms_id ps)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'bq', bq, 'pp', pp, 'ps', ps)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'lines', v_j); v_counts := public._rm_merge_add(v_counts, 'fakturalinjer', v_n);
      with o as (select id, excluded_raw_material_id e, exclusion_prev ep from public.invoice_lines
                  where excluded_raw_material_id = v_d or exclusion_prev ->> 'raw_material_id' = v_d::text),
      upd as (
        update public.invoice_lines il set
               excluded_raw_material_id = case when o.e = v_d then p_keep else il.excluded_raw_material_id end,
               exclusion_prev = case when o.ep ->> 'raw_material_id' = v_d::text then jsonb_set(o.ep, '{raw_material_id}', to_jsonb(p_keep)) else il.exclusion_prev end
          from o where il.id = o.id
        returning il.id, o.e, o.ep)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'e', e, 'ep', ep)), '[]') into v_j from upd;
      v_log := public._rm_merge_push(v_log, 'lines_excluded', v_j);
      perform set_config('rm.exclusion_write', '', true);
      if v_f <> 1 then
        select count(*) into v_n from public.invoice_lines where raw_material_id = p_keep and price_acceptance is not null
           and id in (select (e ->> 'id')::uuid from jsonb_array_elements(v_log -> 'lines') e where e ->> 'd' = v_d::text);
        if v_n > 0 then
          v_conf := v_conf || public._rm_merge_conf('godtatt_pris_annen_enhet', format('%s fakturalinjer har godtatt pris i gammel enhet. Prisvarsel kan komme tilbake.', v_n), false);
        end if;
      end if;
      with upd as (update public.raw_material_purchases set raw_material_id = p_keep where raw_material_id = v_d returning id)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]') into v_j from upd;
      v_log := public._rm_merge_push(v_log, 'purchases', v_j);

      -- Bruk i oppskrifter og kalkyler
      with upd as (update public.recipe_lines set raw_material_id = p_keep where raw_material_id = v_d returning id, recipe_id)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]'), count(*), count(distinct recipe_id) into v_j, v_n, v_n2 from upd;
      v_log := public._rm_merge_push(v_log, 'recipe_lines', v_j);
      v_counts := public._rm_merge_add(public._rm_merge_add(v_counts, 'oppskriftslinjer', v_n), 'oppskrifter', v_n2);
      with upd as (update public.recipe_packaging_lines set raw_material_id = p_keep where raw_material_id = v_d returning id)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'packaging_lines', v_j); v_counts := public._rm_merge_add(v_counts, 'emballasjelinjer', v_n);
      with upd as (update public.product_cost_additions set raw_material_id = p_keep where raw_material_id = v_d returning id)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'cost_additions', v_j); v_counts := public._rm_merge_add(v_counts, 'kalkyletillegg', v_n);

      -- Handelsvare-kobling (påslag og prislister følger produktet)
      with upd as (
        update public.raw_material_products p set raw_material_id = p_keep, base_units_per_sold_unit = o.base_units_per_sold_unit * v_f
          from public.raw_material_products o
         where o.id = p.id and p.raw_material_id = v_d
           and not exists (select 1 from public.raw_material_products k where k.raw_material_id = p_keep and k.product_id = o.product_id)
        returning p.id, o.base_units_per_sold_unit b)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'b', b)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'products', v_j); v_counts := public._rm_merge_add(v_counts, 'handelsvarekoblinger', v_n);
      select count(*) into v_n from public.raw_material_products where raw_material_id = v_d;
      if v_n > 0 then
        v_conf := v_conf || public._rm_merge_conf('produkt_finnes', format('%s salgsprodukter er koblet til begge varene; koblingen på «%s» blir stående.', v_n, v_dup.name), false);
      end if;

      -- Enheter
      with upd as (
        update public.raw_material_units u set raw_material_id = p_keep, units_in_base = o.units_in_base * v_f,
               is_default_purchase = o.is_default_purchase and not exists (select 1 from public.raw_material_units k where k.raw_material_id = p_keep and k.is_default_purchase),
               is_default_count = o.is_default_count and not exists (select 1 from public.raw_material_units k where k.raw_material_id = p_keep and k.is_default_count),
               is_sales_unit = o.is_sales_unit and not exists (select 1 from public.raw_material_units k where k.raw_material_id = p_keep and k.is_sales_unit)
          from public.raw_material_units o
         where o.id = u.id and u.raw_material_id = v_d
           and not exists (select 1 from public.raw_material_units k where k.raw_material_id = p_keep and lower(k.unit_label) = lower(o.unit_label))
        returning u.id, o.units_in_base b, o.is_default_purchase dp, o.is_default_count dc, o.is_sales_unit su)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'b', b, 'dp', dp, 'dc', dc, 'su', su)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'units', v_j); v_counts := public._rm_merge_add(v_counts, 'enheter', v_n);

      -- Forhandlinger (bare samme enhet), sammensetning, tellemaler
      if v_f = 1 then
        with upd as (
          update public.negotiation_items n set raw_material_id = p_keep
           where n.raw_material_id = v_d
             and not exists (select 1 from public.negotiation_items k where k.negotiation_id = n.negotiation_id and k.raw_material_id = p_keep)
          returning n.id)
        select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]'), count(*) into v_j, v_n from upd;
        v_log := public._rm_merge_push(v_log, 'negotiation_items', v_j); v_counts := public._rm_merge_add(v_counts, 'forhandlinger', v_n);
      end if;
      select count(*) into v_n from public.negotiation_items where raw_material_id = v_d;
      if v_n > 0 then
        v_conf := v_conf || public._rm_merge_conf('forhandling_blir_staende', format('%s forhandlingslinjer på «%s» blir stående (annen enhet eller samme forhandling).', v_n, v_dup.name), false);
      end if;
      with upd as (update public.raw_material_components set component_raw_material_id = p_keep where component_raw_material_id = v_d returning id)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'components_child', v_j); v_counts := public._rm_merge_add(v_counts, 'komponenter', v_n);
      if not exists (select 1 from public.raw_material_components where parent_raw_material_id = p_keep) then
        with upd as (update public.raw_material_components set parent_raw_material_id = p_keep where parent_raw_material_id = v_d returning id)
        select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]'), count(*) into v_j, v_n from upd;
        v_log := public._rm_merge_push(v_log, 'components_parent', v_j); v_counts := public._rm_merge_add(v_counts, 'komponenter', v_n);
        if v_n > 0 then v_parent_moved := true; end if;
      elsif exists (select 1 from public.raw_material_components where parent_raw_material_id = v_d) then
        v_conf := v_conf || public._rm_merge_conf('sammensetning_finnes', format('Begge varene har sammensetning. «%s» beholder sin.', v_keep.name), false);
      end if;
      with upd as (
        update public.vt_template_lines t set raw_material_id = p_keep
         where t.raw_material_id = v_d
           and not exists (select 1 from public.vt_template_lines k where k.template_id = t.template_id and k.raw_material_id = p_keep
                            and coalesce(k.location_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(t.location_id, '00000000-0000-0000-0000-000000000000'::uuid))
        returning t.id)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'template_lines', v_j); v_counts := public._rm_merge_add(v_counts, 'tellemaler', v_n);
      select count(*) into v_n from public.vt_count_lines where raw_material_id = v_d;
      if v_n > 0 then
        v_conf := v_conf || public._rm_merge_conf('tellinger_blir_staende', format('%s linjer i avsluttede tellinger har låst grunnlag og blir stående på «%s».', v_n, v_dup.name), false);
      end if;

      -- Næring, allergener, datablad: bare der beholdt vare mangler det
      if exists (select 1 from public.raw_material_nutrition where raw_material_id = v_d) then
        if not exists (select 1 from public.raw_material_nutrition where raw_material_id = p_keep) then
          update public.raw_material_nutrition set raw_material_id = p_keep where raw_material_id = v_d;
          v_log := public._rm_merge_push(v_log, 'nutrition', jsonb_build_array(jsonb_build_object('d', v_d)));
          v_counts := public._rm_merge_add(v_counts, 'naering', 1);
        else
          v_conf := v_conf || public._rm_merge_conf('naering_finnes', format('Begge varene har næringsinnhold. «%s» beholder sitt.', v_keep.name), false);
        end if;
      end if;
      if exists (select 1 from public.raw_material_allergens where raw_material_id = v_d) or v_dup.allergens_reviewed_at is not null then
        if not exists (select 1 from public.raw_material_allergens where raw_material_id = p_keep)
           and (select allergens_reviewed_at from public.raw_materials where id = p_keep) is null and not v_allergens_moved then
          with upd as (update public.raw_material_allergens set raw_material_id = p_keep where raw_material_id = v_d returning id)
          select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d)), '[]'), count(*) into v_j, v_n from upd;
          v_log := public._rm_merge_push(v_log, 'allergens', v_j); v_counts := public._rm_merge_add(v_counts, 'allergener', v_n);
          v_allergens_moved := true;
        elsif exists (
          (select allergen::text, presence::text from public.raw_material_allergens where raw_material_id = v_d
           except select allergen::text, presence::text from public.raw_material_allergens where raw_material_id = p_keep)
          union
          (select allergen::text, presence::text from public.raw_material_allergens where raw_material_id = p_keep
           except select allergen::text, presence::text from public.raw_material_allergens where raw_material_id = v_d)) then
          v_conf := v_conf || public._rm_merge_conf('allergener_ulike', format('Allergenene er ulike på «%s» og «%s». «%s» beholder sine – kontroller dem.', v_dup.name, v_keep.name, v_keep.name), false);
        end if;
      end if;
      with upd as (
        update public.raw_material_datasheets s
           set raw_material_id = p_keep,
               is_current = o.is_current and not exists (select 1 from public.raw_material_datasheets k where k.raw_material_id = p_keep and k.is_current)
          from public.raw_material_datasheets o where o.id = s.id and s.raw_material_id = v_d
        returning s.id, o.is_current c)
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'd', v_d, 'c', c)), '[]'), count(*) into v_j, v_n from upd;
      v_log := public._rm_merge_push(v_log, 'datasheets', v_j); v_counts := public._rm_merge_add(v_counts, 'datablad', v_n);
    end loop;

    -- Beholdt vare: valgt navn/kategori/type, stykkvekt, og felt som bare mangler fylles fra varene som slås sammen
    v_before := jsonb_build_object('name', v_keep.name, 'category', v_keep.category, 'categories', to_jsonb(v_keep.categories),
      'item_type', v_keep.item_type, 'unit_weight_grams', v_keep.unit_weight_grams, 'declaration_name', v_keep.declaration_name,
      'grain_classification', v_keep.grain_classification, 'cereal_type', v_keep.cereal_type, 'water_content_pct', v_keep.water_content_pct,
      'density_g_per_ml', v_keep.density_g_per_ml, 'allergens_reviewed_at', v_keep.allergens_reviewed_at, 'is_composite', v_keep.is_composite,
      'components_reviewed_at', v_keep.components_reviewed_at, 'primary_supplier_id', v_keep.primary_supplier_id);
    select name into v_name from public.raw_materials where id = coalesce((p_fields ->> 'name')::uuid, p_keep);
    select category, categories into v_cat, v_cats from public.raw_materials where id = coalesce((p_fields ->> 'category')::uuid, p_keep);
    select item_type into v_type from public.raw_materials where id = coalesce((p_fields ->> 'item_type')::uuid, p_keep);
    update public.raw_materials k set
      name = v_name, category = v_cat, categories = v_cats, item_type = v_type,
      unit_weight_grams = coalesce(v_gpp_used, k.unit_weight_grams),
      declaration_name = coalesce(k.declaration_name, (select d.declaration_name from public.raw_materials d where d.id = any(v_dups) and d.declaration_name is not null order by d.id limit 1)),
      grain_classification = coalesce(k.grain_classification, (select d.grain_classification from public.raw_materials d where d.id = any(v_dups) and d.grain_classification is not null order by d.id limit 1)),
      cereal_type = coalesce(k.cereal_type, (select d.cereal_type from public.raw_materials d where d.id = any(v_dups) and d.cereal_type is not null order by d.id limit 1)),
      water_content_pct = coalesce(k.water_content_pct, (select d.water_content_pct from public.raw_materials d where d.id = any(v_dups) and d.water_content_pct is not null order by d.id limit 1)),
      density_g_per_ml = coalesce(k.density_g_per_ml, (select d.density_g_per_ml from public.raw_materials d where d.id = any(v_dups) and d.density_g_per_ml is not null order by d.id limit 1)),
      allergens_reviewed_at = case when v_allergens_moved then coalesce(k.allergens_reviewed_at, (select max(d.allergens_reviewed_at) from public.raw_materials d where d.id = any(v_dups))) else k.allergens_reviewed_at end,
      is_composite = k.is_composite or v_parent_moved,
      components_reviewed_at = case when v_parent_moved then coalesce(k.components_reviewed_at, (select max(d.components_reviewed_at) from public.raw_materials d where d.id = any(v_dups))) else k.components_reviewed_at end,
      primary_supplier_id = coalesce(k.primary_supplier_id, (select d.primary_supplier_id from public.raw_materials d where d.id = any(v_dups) and d.primary_supplier_id is not null order by d.id limit 1))
    where k.id = p_keep
    returning jsonb_build_object('name', k.name, 'category', k.category, 'categories', to_jsonb(k.categories),
      'item_type', k.item_type, 'unit_weight_grams', k.unit_weight_grams, 'declaration_name', k.declaration_name,
      'grain_classification', k.grain_classification, 'cereal_type', k.cereal_type, 'water_content_pct', k.water_content_pct,
      'density_g_per_ml', k.density_g_per_ml, 'allergens_reviewed_at', k.allergens_reviewed_at, 'is_composite', k.is_composite,
      'components_reviewed_at', k.components_reviewed_at, 'primary_supplier_id', k.primary_supplier_id) into v_after;

    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'a', is_active)), '[]') into v_j from public.raw_materials where id = any(v_dups);
    v_log := public._rm_merge_push(v_log, 'dups', v_j)
      || jsonb_build_object('keep_before', v_before, 'keep_after', v_after, 'factors', v_factor, 'grams_per_piece', v_gpp_used, 'rms_map', v_rms_map);

    -- Kostpris etter gjeldende regel
    perform public.rm_apply_derived_cost_price(p_keep);
    foreach v_d in array v_dups loop perform public.rm_apply_derived_cost_price(v_d); end loop;
    perform set_config('rm.defer_stats', '', true);
    perform public.refresh_purchase_stats();
    select jsonb_build_object('price', current_cost_price, 'status', cost_basis_status, 'unit', base_unit) into v_cost_after
      from public.raw_materials where id = p_keep;

    v_result := jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'can_apply', not v_blocking,
      'merge_id', case when p_dry_run then null else v_merge_id end, 'keep_id', p_keep, 'merged_ids', to_jsonb(v_dups),
      'counts', v_counts, 'conflicts', v_conf, 'cost', jsonb_build_object('before', v_cost_before, 'after', v_cost_after),
      'factors', v_factor, 'grams_per_piece', v_gpp_used);

    insert into public.rm_material_merges (id, legal_entity_id, keep_id, merged_ids, op_id, request, result, undo_log, created_by)
    values (v_merge_id, v_le, p_keep, v_dups, p_op_id,
            jsonb_build_object('grams_per_piece', p_grams_per_piece, 'fields', p_fields, 'reason', v_reason), v_result, v_log,
            coalesce(p_uid, '00000000-0000-0000-0000-000000000000'::uuid));
    perform set_config('rm.merge_write', 'on', true);
    update public.raw_materials set is_active = false, merged_into_id = p_keep, merged_at = v_now, merge_id = v_merge_id where id = any(v_dups);
    perform set_config('rm.merge_write', '', true);

    insert into public.audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
    select p_uid, case when rm.id = p_keep then 'raw_material.merged' else 'raw_material.merged_into' end, 'raw_material', rm.id, rm.name, v_le,
           jsonb_build_object('merge_id', v_merge_id, 'keep_id', p_keep, 'merged_ids', to_jsonb(v_dups), 'counts', v_counts,
                              'factors', v_factor, 'grams_per_piece', v_gpp_used, 'cost', v_result -> 'cost'),
           v_reason, 'ravarer'
      from public.raw_materials rm where rm.id = p_keep or rm.id = any(v_dups);

    if p_dry_run then raise exception using errcode = 'RMDRY', message = 'dry_run'; end if;
  exception when sqlstate 'RMDRY' then
    null;
  end;
  return v_result;
end $$;

-- ---------- 4. Angre ----------
create or replace function public._rm_merge_undo_core(p_uid uuid, p_merge_id uuid, p_dry_run boolean, p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.rm_material_merges%rowtype;
  v_keep uuid; v_dups uuid[]; v_log jsonb; v_f jsonb; v_d uuid;
  v_counts jsonb := '{}'::jsonb; v_conf jsonb := '[]'::jsonb; v_n bigint;
  v_lines uuid[]; v_back uuid[]; v_hist uuid[]; v_result jsonb; v_now timestamptz := now();
  v_cur jsonb; v_restore jsonb := '{}'::jsonb; v_k text; v_pkg_before uuid[]; v_bcur numeric; v_blocking boolean;
  v_label jsonb := '{"name":"Navn","category":"Kategori","categories":"Kategorier","item_type":"Varetype","unit_weight_grams":"Stykkvekt","declaration_name":"Deklarasjonsnavn","grain_classification":"Grovhet","cereal_type":"Korntype","water_content_pct":"Vanninnhold","density_g_per_ml":"Tetthet","allergens_reviewed_at":"Allergenvurdering","is_composite":"Sammensatt","components_reviewed_at":"Sammensetning vurdert","primary_supplier_id":"Primærleverandør"}'::jsonb;
  x record; e jsonb; v_ff numeric;
begin
  if p_op_id is null then return jsonb_build_object('ok', false, 'code', 'op_id_mangler'); end if;
  select * into m from public.rm_material_merges where id = p_merge_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'finnes_ikke'); end if;
  if p_uid is null then
    if not p_dry_run then return jsonb_build_object('ok', false, 'code', 'ikke_innlogget'); end if;
  elsif not public.has_ravarer_access(p_uid, m.legal_entity_id, 'approve'::public.access_level) then
    return jsonb_build_object('ok', false, 'code', 'ingen_tilgang');
  end if;
  if m.undone_at is not null then
    if not p_dry_run and m.undo_op_id = p_op_id then return m.undo_result || jsonb_build_object('replay', true); end if;
    return jsonb_build_object('ok', false, 'code', 'allerede_angret');
  end if;
  v_keep := m.keep_id; v_dups := m.merged_ids; v_log := m.undo_log; v_f := coalesce(v_log -> 'factors', '{}'::jsonb);
  perform 1 from public.raw_materials where id = v_keep or id = any(v_dups) order by id for update;
  if exists (select 1 from unnest(v_dups) d where not exists (
        select 1 from public.raw_materials r where r.id = d and r.merged_into_id = v_keep and r.merge_id = m.id)) then
    return jsonb_build_object('ok', false, 'code', 'endret_siden');
  end if;

  select coalesce(array_agg((j ->> 'id')::uuid), '{}') into v_lines from jsonb_array_elements(coalesce(v_log -> 'lines', '[]')) j;
  select coalesce(array_agg(id), '{}') into v_back from public.invoice_lines where id = any(v_lines) and raw_material_id = v_keep;
  select count(*) into v_n from public.invoice_line_cost_postings p where p.invoice_line_id = any(v_back) and p.revoked_at is null;
  if v_n > 0 then
    v_conf := v_conf || public._rm_merge_conf('kostpris_fort_etterpa', format('%s flyttede fakturalinjer har fått ført kostpris etter sammenslåingen. Angring er sperret.', v_n), true);
  end if;
  if cardinality(v_back) < cardinality(v_lines) then
    v_conf := v_conf || public._rm_merge_conf('linjer_endret', format('%s fakturalinjer er koblet om etter sammenslåingen og blir der de er.', cardinality(v_lines) - cardinality(v_back)), false);
  end if;
  v_blocking := exists (select 1 from jsonb_array_elements(v_conf) c where (c ->> 'blocking')::boolean);
  if v_blocking then
    if not p_dry_run then return jsonb_build_object('ok', false, 'code', 'konflikt', 'conflicts', v_conf); end if;
    return jsonb_build_object('ok', true, 'dry_run', true, 'can_apply', false, 'merge_id', m.id, 'keep_id', m.keep_id,
      'merged_ids', to_jsonb(m.merged_ids), 'counts', '{}'::jsonb, 'conflicts', v_conf);
  end if;
  select coalesce(array_agg((j ->> 'id')::uuid), '{}') into v_hist from jsonb_array_elements(coalesce(v_log -> 'history', '[]')) j;

  begin
    -- Varene som ble slått sammen
    perform set_config('rm.merge_write', 'on', true);
    update public.raw_materials r set is_active = (j ->> 'a')::boolean, merged_into_id = null, merged_at = null, merge_id = null
      from jsonb_array_elements(v_log -> 'dups') j where r.id = (j ->> 'id')::uuid;
    perform set_config('rm.merge_write', '', true);

    -- Beholdt vare: bare felt som fortsatt har verdien sammenslåingen satte
    select to_jsonb(r) into v_cur from public.raw_materials r where r.id = v_keep;
    for v_k in select jsonb_object_keys(coalesce(v_log -> 'keep_before', '{}'::jsonb)) loop
      continue when (v_log -> 'keep_before' -> v_k) is not distinct from (v_log -> 'keep_after' -> v_k);
      if (v_cur -> v_k) is not distinct from (v_log -> 'keep_after' -> v_k) then
        v_restore := v_restore || jsonb_build_object(v_k, v_log -> 'keep_before' -> v_k);
      else
        v_conf := v_conf || public._rm_merge_conf('felt_endret', format('%s på beholdt vare er endret etter sammenslåingen og beholdes.', coalesce(v_label ->> v_k, v_k)), false);
      end if;
    end loop;
    if v_restore <> '{}'::jsonb then
      update public.raw_materials r set
        (name, category, categories, item_type, unit_weight_grams, declaration_name, grain_classification, cereal_type, water_content_pct,
         density_g_per_ml, allergens_reviewed_at, is_composite, components_reviewed_at, primary_supplier_id) =
        (select p.name, p.category, p.categories, p.item_type, p.unit_weight_grams, p.declaration_name, p.grain_classification, p.cereal_type,
                p.water_content_pct, p.density_g_per_ml, p.allergens_reviewed_at, p.is_composite, p.components_reviewed_at, p.primary_supplier_id
           from jsonb_populate_record(null::public.raw_materials, v_cur || v_restore) p)
       where r.id = v_keep;
    end if;

    -- Datablad, allergener, næring
    update public.raw_material_datasheets s set raw_material_id = (j ->> 'd')::uuid, is_current = (j ->> 'c')::boolean
      from jsonb_array_elements(coalesce(v_log -> 'datasheets', '[]')) j where s.id = (j ->> 'id')::uuid and s.raw_material_id = v_keep;
    update public.raw_material_allergens a set raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'allergens', '[]')) j
     where a.id = (j ->> 'id')::uuid and a.raw_material_id = v_keep
       and not exists (select 1 from public.raw_material_allergens z where z.raw_material_id = (j ->> 'd')::uuid and z.allergen = a.allergen);
    for e in select j from jsonb_array_elements(coalesce(v_log -> 'nutrition', '[]')) j loop
      if not exists (select 1 from public.raw_material_nutrition where raw_material_id = (e ->> 'd')::uuid) then
        update public.raw_material_nutrition set raw_material_id = (e ->> 'd')::uuid where raw_material_id = v_keep;
      end if;
    end loop;

    -- Tellemaler, sammensetning, forhandlinger, enheter, handelsvarer
    update public.vt_template_lines t set raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'template_lines', '[]')) j
     where t.id = (j ->> 'id')::uuid and t.raw_material_id = v_keep
       and not exists (select 1 from public.vt_template_lines k where k.template_id = t.template_id and k.raw_material_id = (j ->> 'd')::uuid
                        and coalesce(k.location_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(t.location_id, '00000000-0000-0000-0000-000000000000'::uuid));
    update public.raw_material_components c set parent_raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'components_parent', '[]')) j where c.id = (j ->> 'id')::uuid and c.parent_raw_material_id = v_keep;
    update public.raw_material_components c set component_raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'components_child', '[]')) j where c.id = (j ->> 'id')::uuid and c.component_raw_material_id = v_keep;
    update public.negotiation_items n set raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'negotiation_items', '[]')) j
     where n.id = (j ->> 'id')::uuid and n.raw_material_id = v_keep
       and not exists (select 1 from public.negotiation_items k where k.negotiation_id = n.negotiation_id and k.raw_material_id = (j ->> 'd')::uuid);
    update public.raw_material_units u set raw_material_id = (j ->> 'd')::uuid,
           units_in_base = public._rm_merge_back(u.units_in_base, (j ->> 'b')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty'),
           is_default_purchase = (j ->> 'dp')::boolean, is_default_count = (j ->> 'dc')::boolean, is_sales_unit = (j ->> 'su')::boolean
      from jsonb_array_elements(coalesce(v_log -> 'units', '[]')) j
     where u.id = (j ->> 'id')::uuid and u.raw_material_id = v_keep
       and not exists (select 1 from public.raw_material_units k where k.raw_material_id = (j ->> 'd')::uuid and lower(k.unit_label) = lower(u.unit_label));
    update public.raw_material_products p set raw_material_id = (j ->> 'd')::uuid,
           base_units_per_sold_unit = public._rm_merge_back(p.base_units_per_sold_unit, (j ->> 'b')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty')
      from jsonb_array_elements(coalesce(v_log -> 'products', '[]')) j
     where p.id = (j ->> 'id')::uuid and p.raw_material_id = v_keep
       and not exists (select 1 from public.raw_material_products k where k.raw_material_id = (j ->> 'd')::uuid and k.product_id = p.product_id);

    -- Oppskrifter og kalkyler
    with upd as (
      update public.recipe_lines l set raw_material_id = (j ->> 'd')::uuid
        from jsonb_array_elements(coalesce(v_log -> 'recipe_lines', '[]')) j where l.id = (j ->> 'id')::uuid and l.raw_material_id = v_keep
      returning l.id)
    select count(*) into v_n from upd;
    v_counts := public._rm_merge_add(v_counts, 'oppskriftslinjer', v_n);
    update public.recipe_packaging_lines l set raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'packaging_lines', '[]')) j where l.id = (j ->> 'id')::uuid and l.raw_material_id = v_keep;
    update public.product_cost_additions l set raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'cost_additions', '[]')) j where l.id = (j ->> 'id')::uuid and l.raw_material_id = v_keep;

    -- Leverandørkoblinger: lærte varenumre fjernes, skrivemåter og pakninger flyttes tilbake
    with del as (
      delete from public.raw_material_supplier_aliases
       where id in (select (j #>> '{}')::uuid from jsonb_array_elements(coalesce(v_log -> 'aliases_created', '[]')) j)
      returning id)
    select count(*) into v_n from del;
    v_counts := public._rm_merge_add(v_counts, 'laerte_fjernet', v_n);
    update public.raw_material_supplier_aliases a set status = (j ->> 's')::public.alias_status, confirmed_by = (j ->> 'cb')::uuid, confirmed_at = (j ->> 'ca')::timestamptz
      from jsonb_array_elements(coalesce(v_log -> 'aliases_status', '[]')) j where a.id = (j ->> 'id')::uuid;
    update public.raw_material_supplier_aliases a set raw_material_supplier_id = (j ->> 'from')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'aliases_moved', '[]')) j
     where a.id = (j ->> 'id')::uuid
       and not exists (select 1 from public.raw_material_supplier_aliases z where z.raw_material_supplier_id = (j ->> 'from')::uuid
                        and z.alias_type = a.alias_type and z.alias_value_normalized = a.alias_value_normalized);
    update public.raw_material_supplier_packages p set raw_material_supplier_id = (j ->> 'from')::uuid,
           base_units_per_package = public._rm_merge_back(p.base_units_per_package, (j ->> 'b')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty')
      from jsonb_array_elements(coalesce(v_log -> 'packages_moved', '[]')) j
     where p.id = (j ->> 'id')::uuid
       and not exists (select 1 from public.raw_material_supplier_packages k where k.raw_material_supplier_id = (j ->> 'from')::uuid
             and k.supplier_sku_norm = p.supplier_sku_norm and coalesce(k.package_size, -1) = coalesce(p.package_size, -1)
             and coalesce(lower(k.package_unit), '') = coalesce(lower(p.package_unit), '')
             and k.base_units_per_package = public._rm_merge_back(p.base_units_per_package, (j ->> 'b')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty'));
    update public.raw_material_suppliers s set agreed_price_per_base_unit = (j ->> 'a')::numeric, agreement_valid_from = (j ->> 'vf')::date,
           agreement_valid_to = (j ->> 'vt')::date, agreement_document_url = j ->> 'u'
      from jsonb_array_elements(coalesce(v_log -> 'agreement_copied', '[]')) j
     where s.id = (j ->> 'id')::uuid and s.agreed_price_per_base_unit is not distinct from (j ->> 'na')::numeric;
    update public.raw_material_supplier_packages p
       set base_units_per_package = public._rm_merge_back(p.base_units_per_package, (j ->> 'b')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty')
      from jsonb_array_elements(coalesce(v_log -> 'packages_converted', '[]')) j where p.id = (j ->> 'id')::uuid;
    delete from public.raw_material_supplier_packages
     where id in (select (j #>> '{}')::uuid from jsonb_array_elements(coalesce(v_log -> 'packages_created', '[]')) j);
    for e in select j from jsonb_array_elements(coalesce(v_log -> 'suppliers_moved', '[]')) j loop
      continue when not exists (select 1 from public.raw_material_suppliers where id = (e ->> 'id')::uuid and raw_material_id = v_keep);
      if exists (select 1 from public.raw_material_suppliers z where z.raw_material_id = (e ->> 'd')::uuid
                   and z.supplier_id = (select supplier_id from public.raw_material_suppliers where id = (e ->> 'id')::uuid)) then
        v_conf := v_conf || public._rm_merge_conf('kobling_finnes', 'En leverandørkobling kunne ikke flyttes tilbake fordi varen har fått en ny kobling til samme leverandør.', false);
        continue;
      end if;
      v_ff := (v_f ->> (e ->> 'd'))::numeric;
      if v_ff is null or v_ff = 1 then
        update public.raw_material_suppliers set raw_material_id = (e ->> 'd')::uuid, is_primary = (e ->> 'p')::boolean where id = (e ->> 'id')::uuid;
      else
        select coalesce(array_agg(id), '{}') into v_pkg_before from public.raw_material_supplier_packages where raw_material_supplier_id = (e ->> 'id')::uuid;
        select base_units_per_package into v_bcur from public.raw_material_suppliers where id = (e ->> 'id')::uuid;
        perform set_config('app.rm_start_price_rpc', '1', true);
        update public.raw_material_suppliers s set raw_material_id = (e ->> 'd')::uuid, is_primary = (e ->> 'p')::boolean,
               base_units_per_package = public._rm_merge_back(s.base_units_per_package, (e ->> 'b')::numeric, v_ff, 'qty'),
               agreed_price_per_base_unit = public._rm_merge_back(s.agreed_price_per_base_unit, (e ->> 'a')::numeric, v_ff, 'price'),
               start_price_per_base_unit = public._rm_merge_back(s.start_price_per_base_unit, (e ->> 'sp')::numeric, v_ff, 'price'),
               start_price_base_units_per_package = public._rm_merge_back(s.start_price_base_units_per_package, (e ->> 'spb')::numeric, v_ff, 'qty'),
               start_price_base_unit = case when s.start_price_base_unit is null then null else coalesce(e ->> 'spu', s.start_price_base_unit) end
         where s.id = (e ->> 'id')::uuid;
        perform set_config('app.rm_start_price_rpc', '', true);
        delete from public.raw_material_supplier_packages
         where raw_material_supplier_id = (e ->> 'id')::uuid and id <> all(v_pkg_before) and base_units_per_package = v_bcur;
      end if;
      v_counts := public._rm_merge_add(v_counts, 'leverandorkoblinger', 1);
    end loop;

    -- Lager (før fakturalinjene)
    update public.stock_movements s set raw_material_id = (j ->> 'd')::uuid,
           quantity_base = public._rm_merge_back(s.quantity_base, (j ->> 'q')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty')
      from jsonb_array_elements(coalesce(v_log -> 'movements', '[]')) j
     where s.id = (j ->> 'id')::uuid and s.raw_material_id = v_keep
       and not (s.source_id is not null and exists (select 1 from public.stock_movements k where k.raw_material_id = (j ->> 'd')::uuid
                  and k.source_table is not distinct from s.source_table and k.source_id = s.source_id));
    update public.rm_stock_lots l set raw_material_id = (j ->> 'd')::uuid,
           quantity_base = public._rm_merge_back(l.quantity_base, (j ->> 'q')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty'),
           remaining_base = public._rm_merge_back(l.remaining_base, (j ->> 'rb')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty')
      from jsonb_array_elements(coalesce(v_log -> 'lots', '[]')) j where l.id = (j ->> 'id')::uuid and l.raw_material_id = v_keep;
    update public.rm_goods_receipts g set raw_material_id = (j ->> 'd')::uuid,
           quantity_base = public._rm_merge_back(g.quantity_base, (j ->> 'q')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty')
      from jsonb_array_elements(coalesce(v_log -> 'receipts', '[]')) j where g.id = (j ->> 'id')::uuid and g.raw_material_id = v_keep;

    -- Prishistorikk (før linjene): rader laget etter sammenslåingen for linjene som går tilbake avsluttes, originalene gjenopprettes
    update public.raw_material_price_history set superseded_at = v_now, superseded_reason = 'sammenslaing_angret'
     where invoice_line_id = any(v_back) and superseded_at is null and id <> all(v_hist);
    with upd as (
      update public.raw_material_price_history h set raw_material_id = (j ->> 'd')::uuid,
             superseded_at = case when h.invoice_line_id is null or h.invoice_line_id = any(v_back) then (j ->> 's')::timestamptz else h.superseded_at end,
             superseded_reason = case when h.invoice_line_id is null or h.invoice_line_id = any(v_back) then j ->> 'r' else h.superseded_reason end
        from jsonb_array_elements(coalesce(v_log -> 'history', '[]')) j where h.id = (j ->> 'id')::uuid and h.raw_material_id = v_keep
      returning h.id)
    select count(*) into v_n from upd;
    v_counts := public._rm_merge_add(v_counts, 'prishistorikk', v_n);

    -- Fakturalinjer
    perform set_config('rm.exclusion_write', 'on', true);
    perform set_config('rm.defer_stats', 'on', true);
    with upd as (
      update public.invoice_lines il set raw_material_id = (j ->> 'd')::uuid,
             base_quantity = public._rm_merge_back(il.base_quantity, (j ->> 'bq')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'qty'),
             price_per_base_unit = public._rm_merge_back(il.price_per_base_unit, (j ->> 'pp')::numeric, (v_f ->> (j ->> 'd'))::numeric, 'price'),
             package_source_rms_id = case
               when il.package_source_rms_id is not distinct from coalesce((v_log -> 'rms_map' ->> (j ->> 'ps'))::uuid, (j ->> 'ps')::uuid) then (j ->> 'ps')::uuid
               else il.package_source_rms_id end
        from jsonb_array_elements(coalesce(v_log -> 'lines', '[]')) j where il.id = (j ->> 'id')::uuid and il.id = any(v_back)
      returning il.id)
    select count(*) into v_n from upd;
    v_counts := public._rm_merge_add(v_counts, 'fakturalinjer', v_n);
    update public.invoice_lines il set
           excluded_raw_material_id = case when il.excluded_raw_material_id = v_keep and (j ->> 'e') is not null then (j ->> 'e')::uuid else il.excluded_raw_material_id end,
           exclusion_prev = case when il.exclusion_prev ->> 'raw_material_id' = v_keep::text and (j -> 'ep') is not null and jsonb_typeof(j -> 'ep') = 'object' then j -> 'ep' else il.exclusion_prev end
      from jsonb_array_elements(coalesce(v_log -> 'lines_excluded', '[]')) j where il.id = (j ->> 'id')::uuid;
    perform set_config('rm.exclusion_write', '', true);
    update public.raw_material_purchases p set raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'purchases', '[]')) j where p.id = (j ->> 'id')::uuid and p.raw_material_id = v_keep;

    -- Koblingsforslag
    update public.invoice_line_match_suggestions s set raw_material_id = (j ->> 'd')::uuid
      from jsonb_array_elements(coalesce(v_log -> 'suggestions_moved', '[]')) j
     where s.id = (j ->> 'id')::uuid and s.raw_material_id = v_keep
       and not exists (select 1 from public.invoice_line_match_suggestions k where k.invoice_line_id = s.invoice_line_id and k.raw_material_id = (j ->> 'd')::uuid);
    insert into public.invoice_line_match_suggestions
    select s.* from jsonb_populate_recordset(null::public.invoice_line_match_suggestions, coalesce(v_log -> 'suggestions_deleted', '[]')) s
     where exists (select 1 from public.invoice_lines l where l.id = s.invoice_line_id)
    on conflict do nothing;

    perform public.rm_apply_derived_cost_price(v_keep);
    foreach v_d in array v_dups loop perform public.rm_apply_derived_cost_price(v_d); end loop;
    perform set_config('rm.defer_stats', '', true);
    perform public.refresh_purchase_stats();

    v_result := jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'can_apply', not v_blocking, 'merge_id', m.id,
      'keep_id', v_keep, 'merged_ids', to_jsonb(v_dups), 'counts', v_counts, 'conflicts', v_conf);
    update public.rm_material_merges set undone_at = v_now, undone_by = coalesce(p_uid, '00000000-0000-0000-0000-000000000000'::uuid),
           undo_result = v_result, undo_op_id = p_op_id
     where id = m.id;
    insert into public.audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
    select p_uid, 'raw_material.merge_undone', 'raw_material', rm.id, rm.name, m.legal_entity_id,
           jsonb_build_object('merge_id', m.id, 'keep_id', v_keep, 'merged_ids', to_jsonb(v_dups), 'counts', v_counts),
           'Sammenslåing angret', 'ravarer'
      from public.raw_materials rm where rm.id = v_keep or rm.id = any(v_dups);

    if p_dry_run then raise exception using errcode = 'RMDRY', message = 'dry_run'; end if;
  exception when sqlstate 'RMDRY' then
    null;
  end;
  return v_result;
end $$;

-- ---------- 5. Klientinnganger ----------
create or replace function public.rm_merge_raw_materials(
  p_keep uuid, p_dups uuid[], p_grams_per_piece jsonb default null, p_fields jsonb default null,
  p_reason text default null, p_dry_run boolean default true, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'ikke_innlogget'); end if;
  return public._rm_merge_core(auth.uid(), p_keep, p_dups, p_grams_per_piece, p_fields, p_reason, coalesce(p_dry_run, true),
    coalesce(p_op_id, case when coalesce(p_dry_run, true) then gen_random_uuid() end));
end $$;

create or replace function public.rm_undo_material_merge(p_merge_id uuid, p_dry_run boolean default true, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'ikke_innlogget'); end if;
  return public._rm_merge_undo_core(auth.uid(), p_merge_id, coalesce(p_dry_run, true),
    coalesce(p_op_id, case when coalesce(p_dry_run, true) then gen_random_uuid() end));
end $$;

-- Fakta side om side for dialogen (lesing).
create or replace function public.rm_merge_facts(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_le uuid; v_out jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'ikke_innlogget'); end if;
  if p_ids is null or cardinality(p_ids) < 1 or cardinality(p_ids) > 11 then return jsonb_build_object('ok', false, 'code', 'ugyldig_utvalg'); end if;
  if (select count(distinct legal_entity_id) from public.raw_materials where id = any(p_ids)) <> 1 then
    return jsonb_build_object('ok', false, 'code', 'annet_selskap');
  end if;
  select legal_entity_id into v_le from public.raw_materials where id = any(p_ids) limit 1;
  if not public.has_ravarer_access(auth.uid(), v_le, 'read'::public.access_level) then return jsonb_build_object('ok', false, 'code', 'ingen_tilgang'); end if;
  select jsonb_agg(jsonb_build_object(
      'id', rm.id, 'name', rm.name, 'sku', rm.sku, 'item_type', rm.item_type, 'category', rm.category, 'base_unit', rm.base_unit,
      'cost', rm.current_cost_price, 'cost_status', rm.cost_basis_status, 'created_at', rm.created_at, 'is_active', rm.is_active,
      'unit_weight_grams', rm.unit_weight_grams, 'merged_into_id', rm.merged_into_id, 'merge_id', rm.merge_id,
      'declaration_name', rm.declaration_name, 'current_stock', rm.current_stock, 'stock_tracking', rm.stock_tracking,
      'suppliers', (select coalesce(jsonb_agg(jsonb_build_object(
            'supplier_id', s.supplier_id, 'supplier_name', su.name, 'sku', s.supplier_sku, 'product_name', s.supplier_product_name,
            'package_size', s.package_size, 'package_unit', s.package_unit, 'base_units_per_package', s.base_units_per_package,
            'package_confirmed', s.package_confirmed_at is not null,
            'sku_aliases', (select coalesce(jsonb_agg(distinct a.alias_value), '[]') from public.raw_material_supplier_aliases a
                             where a.raw_material_supplier_id = s.id and a.alias_type = 'supplier_sku' and a.status = 'confirmed'))
            order by su.name), '[]')
          from public.raw_material_suppliers s join public.suppliers su on su.id = s.supplier_id where s.raw_material_id = rm.id),
      'invoice_lines', (select count(*) from public.invoice_lines where raw_material_id = rm.id),
      'recipes', (select count(distinct q.recipe_id) from (select recipe_id from public.recipe_lines where raw_material_id = rm.id
                   union select recipe_id from public.recipe_packaging_lines where raw_material_id = rm.id) q),
      'calc_additions', (select count(*) from public.product_cost_additions where raw_material_id = rm.id),
      'products', (select count(*) from public.raw_material_products where raw_material_id = rm.id),
      'price_lists', (select count(distinct pli.price_list_id) from public.raw_material_products p join public.price_list_items pli on pli.product_id = p.product_id where p.raw_material_id = rm.id),
      'stock_movements', (select count(*) from public.stock_movements where raw_material_id = rm.id),
      'count_templates', (select count(*) from public.vt_template_lines where raw_material_id = rm.id),
      'has_nutrition', exists (select 1 from public.raw_material_nutrition where raw_material_id = rm.id),
      'allergens', (select count(*) from public.raw_material_allergens where raw_material_id = rm.id),
      'datasheets', (select count(*) from public.raw_material_datasheets where raw_material_id = rm.id),
      'cost_posted_lines', (select count(*) from public.invoice_lines il where il.raw_material_id = rm.id
                             and exists (select 1 from public.invoice_line_cost_postings p where p.invoice_line_id = il.id and p.revoked_at is null)))
    order by array_position(p_ids, rm.id)) into v_out
  from public.raw_materials rm where rm.id = any(p_ids);
  return jsonb_build_object('ok', true, 'items', coalesce(v_out, '[]'::jsonb));
end $$;

create or replace function public.rm_cap_slaa_sammen_v1() returns boolean language sql stable set search_path = public as $$ select true $$;

-- ---------- 6. Eldre sammenslåing: én vei ----------
CREATE OR REPLACE FUNCTION public.merge_raw_materials(p_keep uuid, p_dup uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
BEGIN
  -- Erstattet 20.11.2026: delegerer til rm_merge_raw_materials (godkjenner/admin, inaktiv i stedet for sletting, kan angres).
  v := public.rm_merge_raw_materials(p_keep, ARRAY[p_dup], NULL, NULL, 'Slått sammen (eldre kall)', false, gen_random_uuid());
  IF coalesce((v->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Sammenslåing avvist: %', coalesce(v->>'code', 'ukjent') USING ERRCODE = 'P0001';
  END IF;
END;
$function$;

-- ---------- 7. Rettigheter ----------
revoke all on function public._rm_merge_core(uuid, uuid, uuid[], jsonb, jsonb, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public._rm_merge_undo_core(uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public._rm_merge_core(uuid, uuid, uuid[], jsonb, jsonb, text, boolean, uuid) to service_role;
grant execute on function public._rm_merge_undo_core(uuid, uuid, boolean, uuid) to service_role;
revoke all on function public.rm_merge_raw_materials(uuid, uuid[], jsonb, jsonb, text, boolean, uuid) from public, anon;
revoke all on function public.rm_undo_material_merge(uuid, boolean, uuid) from public, anon;
revoke all on function public.rm_merge_facts(uuid[]) from public, anon;
revoke all on function public.rm_cap_slaa_sammen_v1() from public, anon;
grant execute on function public.rm_merge_raw_materials(uuid, uuid[], jsonb, jsonb, text, boolean, uuid) to authenticated, service_role;
grant execute on function public.rm_undo_material_merge(uuid, boolean, uuid) to authenticated, service_role;
grant execute on function public.rm_merge_facts(uuid[]) to authenticated, service_role;
grant execute on function public.rm_cap_slaa_sammen_v1() to authenticated, service_role;
revoke all on function public._rm_merge_fields_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
