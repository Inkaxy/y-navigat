-- =====================================================================================
-- PENDING 19.11.2026 · Demo D «Fra faktura til vare» (D1–D5)
-- Kjøres av root etter Henriks ja. Additivt + ett md5-bundet tekstbytte. Endrer eller sletter
-- INGEN eksisterende data ved kjøring, og starter ingen jobb. Opprydding av åpne linjer ligger i
-- egen fil: 20261119_fra_faktura_opprydding.DATAENDRING.sql.
--
--  1. invoice_match_settings (alle null = dagens oppførsel):
--     * price_jump_pct            – grensen for «Prishopp» (null = 20 %).
--     * fra_faktura_quiet_prices  – true: prisendring under grensen setter ikke requires_review
--                                   (matchingen, gjennomgått kode i match-invoice-lines). null = av.
--     * fra_faktura_invoice_package – true: entydig pakning lest fra fakturaen (varenavn + regnestykke,
--                                   høy tillit) gjelder uten egen godkjenning. null = av.
--  2. raw_materials.price_jump_pct (null = selskapets grense) og raw_materials.cost_basis_rule
--     (null = 'hovedleverandor'; 'billigste' | 'avtalt') – «Kalkylen bruker».
--  3. suppliers.new_item_type (null = som foreslått; 'ravare' | 'videresalg' | 'emballasje').
--  4. Funksjoner: rm_fra_faktura_settings, rm_set_fra_faktura_settings (approve/admin),
--     rm_set_item_price_jump (approve/admin), rm_set_supplier_new_item_type (skriverett),
--     rm_remember_supplier_item_names (skriverett: alle skrivemåter blir bekreftede navnealias),
--     rm_undo_supplier_item_link (skriverett: «Angre» på koble/opprett, aldri sletting),
--     rm_set_cost_basis_rule (approve/admin; regner kost via rm_apply_derived_cost_price),
--     _rm_cost_rule_ok (hjelper), rm_cap_fra_faktura_v1().
--  5. _rm_cost_candidates (live md5 5a28cc1e868271452552b30ad1d8ea57, lest 17.11.2026): to tekstbytter
--     – regelfilter etter selskapssjekken og regelstyrt rekkefølge. Fortsatt ÉN prisvelger.
--     Stopper hele filen hvis definisjonen er endret siden 17.11.
--     Virkning ved kjøring: bare råvarer med kjøp fra flere leverandører kan få annen kostpris ved
--     neste omregning (2 råvarer 17.11.2026). Ingen kost regnes om av selve kjøringen.
-- =====================================================================================
begin;

-- 1–3 Kolonner -------------------------------------------------------------------------
alter table public.invoice_match_settings
  add column if not exists price_jump_pct numeric null,
  add column if not exists fra_faktura_quiet_prices boolean null,
  add column if not exists fra_faktura_invoice_package boolean null;
alter table public.raw_materials
  add column if not exists price_jump_pct numeric null,
  add column if not exists cost_basis_rule text null;
alter table public.suppliers
  add column if not exists new_item_type text null;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_match_settings_price_jump_pct_chk') then
    alter table public.invoice_match_settings add constraint invoice_match_settings_price_jump_pct_chk
      check (price_jump_pct is null or (price_jump_pct >= 1 and price_jump_pct <= 1000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'raw_materials_price_jump_pct_chk') then
    alter table public.raw_materials add constraint raw_materials_price_jump_pct_chk
      check (price_jump_pct is null or (price_jump_pct >= 1 and price_jump_pct <= 1000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'raw_materials_cost_basis_rule_chk') then
    alter table public.raw_materials add constraint raw_materials_cost_basis_rule_chk
      check (cost_basis_rule is null or cost_basis_rule in ('hovedleverandor', 'billigste', 'avtalt'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'suppliers_new_item_type_chk') then
    alter table public.suppliers add constraint suppliers_new_item_type_chk
      check (new_item_type is null or new_item_type in ('ravare', 'videresalg', 'emballasje'));
  end if;
end $c$;

-- 4 Innstillinger ----------------------------------------------------------------------
create or replace function public.rm_fra_faktura_settings(p_legal_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare s record;
begin
  if auth.uid() is null or not public.has_ravarer_invoice_access(p_legal_entity_id, 'read') then
    raise exception 'Mangler tilgang til fakturaer' using errcode = '42501';
  end if;
  select price_jump_pct, fra_faktura_quiet_prices, fra_faktura_invoice_package into s
    from public.invoice_match_settings where legal_entity_id = p_legal_entity_id;
  return jsonb_build_object(
    'ok', true,
    'price_jump_pct', coalesce(s.price_jump_pct, 20),
    'price_jump_is_default', s.price_jump_pct is null,
    'quiet_prices', coalesce(s.fra_faktura_quiet_prices, false),
    'invoice_package', coalesce(s.fra_faktura_invoice_package, false),
    'can_edit', coalesce(public.has_ravarer_invoice_approve(p_legal_entity_id), false));
end $$;

create or replace function public.rm_set_fra_faktura_settings(p_legal_entity_id uuid, p_price_jump_pct numeric,
  p_quiet_prices boolean default null, p_invoice_package boolean default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_old jsonb;
begin
  if v_uid is null then raise exception 'Krever pålogging' using errcode = '28000'; end if;
  if not coalesce(public.has_ravarer_invoice_approve(p_legal_entity_id), false) then
    raise exception 'Krever godkjennerrettighet' using errcode = '42501';
  end if;
  if p_price_jump_pct is not null and (p_price_jump_pct < 1 or p_price_jump_pct > 1000) then
    raise exception 'Grensen må være mellom 1 og 1000 %%' using errcode = '22023';
  end if;
  select to_jsonb(s) into v_old from public.invoice_match_settings s where legal_entity_id = p_legal_entity_id for update;
  if v_old is null then
    insert into public.invoice_match_settings (legal_entity_id, price_jump_pct, fra_faktura_quiet_prices, fra_faktura_invoice_package, updated_by, updated_at)
    values (p_legal_entity_id, p_price_jump_pct, p_quiet_prices, p_invoice_package, v_uid, now());
  else
    update public.invoice_match_settings
       set price_jump_pct = p_price_jump_pct,
           fra_faktura_quiet_prices = coalesce(p_quiet_prices, fra_faktura_quiet_prices),
           fra_faktura_invoice_package = coalesce(p_invoice_package, fra_faktura_invoice_package),
           updated_by = v_uid, updated_at = now()
     where legal_entity_id = p_legal_entity_id;
  end if;
  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'fra_faktura.settings_changed', 'legal_entity', p_legal_entity_id, p_legal_entity_id,
          jsonb_build_object('before', v_old -> 'price_jump_pct', 'price_jump_pct', p_price_jump_pct,
                             'quiet_prices', p_quiet_prices, 'invoice_package', p_invoice_package),
          'Fra faktura: innstillinger', 'ravarer');
  return public.rm_fra_faktura_settings(p_legal_entity_id);
end $$;

create or replace function public.rm_set_item_price_jump(p_raw_material_id uuid, p_pct numeric)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_rm record;
begin
  if v_uid is null then raise exception 'Krever pålogging' using errcode = '28000'; end if;
  select id, legal_entity_id, price_jump_pct into v_rm from public.raw_materials where id = p_raw_material_id for update;
  if not found or not coalesce(public.has_ravarer_invoice_approve(v_rm.legal_entity_id), false) then
    raise exception 'Krever godkjennerrettighet' using errcode = '42501';
  end if;
  if p_pct is not null and (p_pct < 1 or p_pct > 1000) then
    raise exception 'Grensen må være mellom 1 og 1000 %%' using errcode = '22023';
  end if;
  update public.raw_materials set price_jump_pct = p_pct, updated_at = now() where id = p_raw_material_id;
  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'raw_material.price_jump_changed', 'raw_material', p_raw_material_id, v_rm.legal_entity_id,
          jsonb_build_object('before', v_rm.price_jump_pct, 'after', p_pct), 'Egen prishoppgrense', 'ravarer');
  return jsonb_build_object('ok', true, 'raw_material_id', p_raw_material_id, 'price_jump_pct', p_pct);
end $$;

create or replace function public.rm_set_supplier_new_item_type(p_supplier_id uuid, p_type text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_s record;
begin
  if v_uid is null then raise exception 'Krever pålogging' using errcode = '28000'; end if;
  select id, legal_entity_id, new_item_type into v_s from public.suppliers where id = p_supplier_id for update;
  if not found or not public.has_ravarer_invoice_access(v_s.legal_entity_id, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer' using errcode = '42501';
  end if;
  if p_type is not null and p_type not in ('ravare', 'videresalg', 'emballasje') then
    raise exception 'Ukjent varetype' using errcode = '22023';
  end if;
  update public.suppliers set new_item_type = p_type, updated_at = now() where id = p_supplier_id;
  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'supplier.new_item_type_changed', 'supplier', p_supplier_id, v_s.legal_entity_id,
          jsonb_build_object('before', v_s.new_item_type, 'after', p_type), 'Fra faktura: regel for nye varer', 'ravarer');
  return jsonb_build_object('ok', true, 'supplier_id', p_supplier_id, 'new_item_type', p_type);
end $$;

-- Skrivemåter: alle navn leverandøren har brukt for samme leverandørvare blir bekreftede navnealias
-- på koblingen. Avviste alias røres ikke.
create or replace function public.rm_remember_supplier_item_names(p_legal_entity_id uuid, p_supplier_id uuid,
  p_item_key text, p_raw_material_supplier_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_added int := 0; v_names text[];
begin
  if v_uid is null then raise exception 'Krever pålogging' using errcode = '28000'; end if;
  if not public.has_ravarer_invoice_access(p_legal_entity_id, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer' using errcode = '42501';
  end if;
  if p_item_key is null or p_item_key !~ '^(sku|name):' then raise exception 'ugyldig_varenokkel' using errcode = '22023'; end if;
  perform 1 from public.raw_material_suppliers rms join public.raw_materials rm on rm.id = rms.raw_material_id
   where rms.id = p_raw_material_supplier_id and rms.supplier_id = p_supplier_id and rm.legal_entity_id = p_legal_entity_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'kobling_finnes_ikke'); end if;

  select coalesce(array_agg(distinct btrim(il.description)), '{}') into v_names
    from public.invoice_lines il join public.invoices i on i.id = il.invoice_id
   where i.legal_entity_id = p_legal_entity_id and i.supplier_id = p_supplier_id
     and coalesce(btrim(il.description), '') <> ''
     and (case when public.rm_sku_norm(il.supplier_sku) <> '' then 'sku:' || public.rm_sku_norm(il.supplier_sku)
               else 'name:' || public.rm_match_key(il.description) end) = p_item_key;

  with ins as (
    insert into public.raw_material_supplier_aliases (raw_material_supplier_id, alias_type, alias_value, status, confirmed_by, confirmed_at, match_count, last_seen_at)
    select p_raw_material_supplier_id, 'product_name', n, 'confirmed', v_uid, now(), 1, now() from unnest(v_names) n
    on conflict (alias_type, alias_value_normalized, raw_material_supplier_id) do nothing
    returning 1)
  select count(*) into v_added from ins;
  if v_added > 0 then
    insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
    values (v_uid, 'supplier_item.names_remembered', 'raw_material_supplier', p_raw_material_supplier_id, p_legal_entity_id,
            jsonb_build_object('item_key', p_item_key, 'names', to_jsonb(v_names), 'added', v_added), 'Fra faktura: skrivemåter', 'ravarer');
  end if;
  return jsonb_build_object('ok', true, 'added', v_added, 'names', cardinality(v_names));
end $$;

-- «Angre» på koble/opprett fra «Fra faktura». Gjenåpner bare linjer i utvalget som fortsatt er koblet til
-- råvaren, på åpen, ulåst, ikke godkjent faktura uten ført kost. Prisobservasjoner fra linjene får
-- superseded_at (beholdes). En råvare opprettet i samme svar settes inaktiv (aldri slettet) når den ikke er
-- brukt noe annet sted. Samme svarform som rm_undo_not_item.
create or replace function public.rm_undo_supplier_item_link(p_legal_entity_id uuid, p_supplier_id uuid, p_item_key text,
  p_line_ids uuid[], p_raw_material_id uuid, p_created boolean default false, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_approve boolean; r record; v_id uuid;
  v_seen uuid[] := '{}'; v_done uuid[] := '{}'; v_undone jsonb := '[]'::jsonb; v_skipped jsonb := '[]'::jsonb;
  v_invoices uuid[] := '{}'; v_deactivated boolean := false; v_rms uuid; v_descs text[];
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.has_ravarer_invoice_access(p_legal_entity_id, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer' using errcode = '42501';
  end if;
  if p_supplier_id is null or p_item_key is null or p_item_key !~ '^(sku|name):' then raise exception 'ugyldig_varenokkel' using errcode = '22023'; end if;
  if p_line_ids is null or coalesce(cardinality(p_line_ids), 0) = 0 or cardinality(p_line_ids) > 2000 then
    raise exception 'ugyldig_linjeutvalg' using errcode = '22023';
  end if;
  perform 1 from public.raw_materials where id = p_raw_material_id and legal_entity_id = p_legal_entity_id for update;
  if not found then raise exception 'ravare_finnes_ikke' using errcode = '22023'; end if;
  v_approve := coalesce(public.has_ravarer_invoice_approve(p_legal_entity_id), false);

  perform 1 from public.invoices i
   where i.legal_entity_id = p_legal_entity_id and i.supplier_id = p_supplier_id
     and i.id in (select il.invoice_id from public.invoice_lines il where il.id = any(p_line_ids))
   order by i.id for update of i;

  for r in
    select il.id, il.invoice_id, il.raw_material_id, il.resolved_by, il.excluded_at, il.description,
           i.status as inv_status, i.flagged_at, i.reconciled_at, i.invoice_number
      from public.invoice_lines il join public.invoices i on i.id = il.invoice_id
     where il.id = any(p_line_ids) and i.legal_entity_id = p_legal_entity_id and i.supplier_id = p_supplier_id
       and (case when public.rm_sku_norm(il.supplier_sku) <> '' then 'sku:' || public.rm_sku_norm(il.supplier_sku)
                 else 'name:' || public.rm_match_key(il.description) end) = p_item_key
     order by il.invoice_id, il.id
       for update of il
  loop
    v_seen := v_seen || r.id;
    if r.raw_material_id is distinct from p_raw_material_id then
      v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'ikke_koblet'); continue;
    end if;
    if r.excluded_at is not null then v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'holdt_utenfor'); continue; end if;
    if not v_approve and r.resolved_by is distinct from v_uid then
      v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'annen_bruker'); continue;
    end if;
    if r.inv_status is null or r.inv_status not in ('imported','needs_review','ready') or r.flagged_at is not null or r.reconciled_at is not null then
      v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'faktura_last'); continue;
    end if;
    if exists (select 1 from public.invoice_internal_approvals a where a.invoice_id = r.invoice_id and a.status = 'approved' and a.revoked_at is null) then
      v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'faktura_godkjent'); continue;
    end if;
    if exists (select 1 from public.invoice_line_cost_postings p where p.invoice_line_id = r.id and p.revoked_at is null) then
      v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'kostpris_fort'); continue;
    end if;
    update public.invoice_lines
       set raw_material_id = null, match_confidence = 'unmatched', requires_review = true, review_reason = 'unmatched',
           price_per_base_unit = null, base_quantity = null, expected_price_per_base_unit = null,
           price_variance_pct = null, variance_status = null,
           resolution_note = null, resolved_by = null, resolved_at = null, updated_at = now()
     where id = r.id;
    v_done := v_done || r.id;
    v_descs := array_append(v_descs, btrim(r.description));
    v_undone := v_undone || jsonb_build_object('id', r.id, 'invoice_id', r.invoice_id, 'invoice_number', r.invoice_number);
    if not (r.invoice_id = any(v_invoices)) then v_invoices := v_invoices || r.invoice_id; end if;
  end loop;

  if cardinality(v_done) > 0 then
    update public.raw_material_price_history set superseded_at = now()
     where invoice_line_id = any(v_done) and superseded_at is null;
    select id into v_rms from public.raw_material_suppliers where raw_material_id = p_raw_material_id and supplier_id = p_supplier_id;
    if v_rms is not null then
      update public.raw_material_supplier_aliases a
         set status = 'rejected', rejected_at = now(), rejected_by = v_uid, rejected_reason = 'Kobling angret i Fra faktura'
       where a.raw_material_supplier_id = v_rms and a.status in ('confirmed', 'pending')
         and ((a.alias_type = 'product_name' and lower(btrim(a.alias_value)) = any(select lower(x) from unnest(v_descs) x))
           or (a.alias_type = 'supplier_sku' and p_item_key = 'sku:' || public.rm_sku_norm(a.alias_value)));
    end if;
    if coalesce(p_created, false)
       and not exists (select 1 from public.invoice_lines il where il.raw_material_id = p_raw_material_id)
       and not exists (select 1 from public.recipe_lines rl where rl.raw_material_id = p_raw_material_id)
       and not exists (select 1 from public.recipe_packaging_lines pl where pl.raw_material_id = p_raw_material_id)
       and not exists (select 1 from public.raw_material_products rp where rp.raw_material_id = p_raw_material_id) then
      update public.raw_materials set is_active = false, updated_at = now() where id = p_raw_material_id;
      v_deactivated := true;
    else
      perform public.rm_apply_derived_cost_price(p_raw_material_id);
    end if;
  end if;

  foreach v_id in array p_line_ids loop
    if not (v_id = any(v_seen)) then v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'finnes_ikke'); end if;
  end loop;
  if cardinality(v_done) > 0 then
    insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
    values (v_uid, 'supplier_item.link_undone', 'supplier', p_supplier_id, p_legal_entity_id,
            jsonb_build_object('item_key', p_item_key, 'raw_material_id', p_raw_material_id, 'lines', v_undone, 'deactivated', v_deactivated),
            coalesce(nullif(btrim(p_reason), ''), 'Kobling angret i Fra faktura'), 'ravarer');
  end if;
  return jsonb_build_object('ok', true, 'undone', v_undone, 'skipped', v_skipped, 'removed_rules', '[]'::jsonb,
                            'invoice_ids', to_jsonb(v_invoices), 'deactivated', v_deactivated);
end $$;

-- «Kalkylen bruker» --------------------------------------------------------------------
create or replace function public._rm_cost_rule_ok(p_rm uuid, p_rule text, p_primary uuid, p_supplier uuid, p_source text, p_date date)
returns boolean language sql stable security definer set search_path to 'public' as $$
  with prim as (
    select p_primary is null or p_supplier is null or p_supplier = p_primary
           or not exists (select 1 from raw_material_price_history h2
                           where h2.raw_material_id = p_rm and h2.supplier_id = p_primary and h2.superseded_at is null
                             and not coalesce(h2.is_legacy, false) and not coalesce(h2.is_credit, false) and h2.price > 0) as ok)
  select case coalesce(p_rule, 'hovedleverandor')
    when 'billigste' then
      p_supplier is null or not exists (select 1 from raw_material_price_history h2
         where h2.raw_material_id = p_rm and h2.supplier_id = p_supplier and h2.superseded_at is null
           and not coalesce(h2.is_legacy, false) and not coalesce(h2.is_credit, false) and h2.price > 0
           and h2.effective_date > p_date)
    when 'avtalt' then
      p_source = 'agreement' or (select ok from prim)
    else (select ok from prim)
  end
$$;

do $guard$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public._rm_cost_candidates(uuid,date)'::regprocedure);
  if md5(v_def) <> '5a28cc1e868271452552b30ad1d8ea57' then
    raise exception 'Avbrutt: _rm_cost_candidates er endret siden 17.11.2026 (md5 %). Ingenting er kjørt.', md5(v_def);
  end if;
  v_new := replace(v_def,
    E'     and (h.supplier_id is null or s.legal_entity_id = rm.legal_entity_id)\n',
    E'     and (h.supplier_id is null or s.legal_entity_id = rm.legal_entity_id)\n'
    || E'     -- Demo D 19.11.2026: «Kalkylen bruker» (raw_materials.cost_basis_rule, null = hovedleverandør).\n'
    || E'     and public._rm_cost_rule_ok(rm.id, rm.cost_basis_rule, rm.primary_supplier_id, h.supplier_id, h.source, h.effective_date)\n');
  if v_new = v_def then raise exception 'Avbrutt: fant ikke selskapslinjen i _rm_cost_candidates.'; end if;
  v_def := v_new;
  v_new := replace(v_def,
    E'   order by h.effective_date desc, h.price desc, h.created_at desc, h.id desc\n',
    E'   order by case when rm.cost_basis_rule = \'avtalt\' and h.source = \'agreement\' then 0 else 1 end,\n'
    || E'            case when rm.cost_basis_rule = \'billigste\' then h.price end asc nulls last,\n'
    || E'            h.effective_date desc, h.price desc, h.created_at desc, h.id desc\n');
  if v_new = v_def then raise exception 'Avbrutt: fant ikke rekkefølgen i _rm_cost_candidates.'; end if;
  execute v_new;
end $guard$;

create or replace function public.rm_set_cost_basis_rule(p_raw_material_id uuid, p_rule text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_rm record; v_after record;
begin
  if v_uid is null then raise exception 'Krever pålogging' using errcode = '28000'; end if;
  select id, legal_entity_id, cost_basis_rule, current_cost_price into v_rm from public.raw_materials where id = p_raw_material_id for update;
  if not found or not coalesce(public.has_ravarer_invoice_approve(v_rm.legal_entity_id), false) then
    raise exception 'Krever godkjennerrettighet' using errcode = '42501';
  end if;
  if p_rule is not null and p_rule not in ('hovedleverandor', 'billigste', 'avtalt') then
    raise exception 'Ukjent regel' using errcode = '22023';
  end if;
  update public.raw_materials set cost_basis_rule = nullif(p_rule, 'hovedleverandor'), updated_at = now() where id = p_raw_material_id;
  perform public.rm_apply_derived_cost_price(p_raw_material_id);
  select current_cost_price into v_after from public.raw_materials where id = p_raw_material_id;
  insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'raw_material.cost_basis_rule_changed', 'raw_material', p_raw_material_id, v_rm.legal_entity_id,
          jsonb_build_object('before', coalesce(v_rm.cost_basis_rule, 'hovedleverandor'), 'after', coalesce(p_rule, 'hovedleverandor'),
                             'cost_before', v_rm.current_cost_price, 'cost_after', v_after.current_cost_price),
          'Kalkylen bruker', 'ravarer');
  return jsonb_build_object('ok', true, 'rule', coalesce(p_rule, 'hovedleverandor'),
                            'cost_before', v_rm.current_cost_price, 'cost_after', v_after.current_cost_price);
end $$;

create or replace function public.rm_cap_fra_faktura_v1() returns boolean language sql stable as $$ select true $$;

revoke all on function public.rm_fra_faktura_settings(uuid) from public, anon;
revoke all on function public.rm_set_fra_faktura_settings(uuid, numeric, boolean, boolean) from public, anon;
revoke all on function public.rm_set_item_price_jump(uuid, numeric) from public, anon;
revoke all on function public.rm_set_supplier_new_item_type(uuid, text) from public, anon;
revoke all on function public.rm_remember_supplier_item_names(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.rm_undo_supplier_item_link(uuid, uuid, text, uuid[], uuid, boolean, text) from public, anon;
revoke all on function public.rm_set_cost_basis_rule(uuid, text) from public, anon;
revoke all on function public._rm_cost_rule_ok(uuid, text, uuid, uuid, text, date) from public, anon, authenticated;
revoke all on function public.rm_cap_fra_faktura_v1() from public, anon;
grant execute on function public.rm_fra_faktura_settings(uuid) to authenticated, service_role;
grant execute on function public.rm_set_fra_faktura_settings(uuid, numeric, boolean, boolean) to authenticated, service_role;
grant execute on function public.rm_set_item_price_jump(uuid, numeric) to authenticated, service_role;
grant execute on function public.rm_set_supplier_new_item_type(uuid, text) to authenticated, service_role;
grant execute on function public.rm_remember_supplier_item_names(uuid, uuid, text, uuid) to authenticated, service_role;
grant execute on function public.rm_undo_supplier_item_link(uuid, uuid, text, uuid[], uuid, boolean, text) to authenticated, service_role;
grant execute on function public.rm_set_cost_basis_rule(uuid, text) to authenticated, service_role;
grant execute on function public._rm_cost_rule_ok(uuid, text, uuid, uuid, text, date) to service_role;
grant execute on function public.rm_cap_fra_faktura_v1() to authenticated, service_role;

commit;
