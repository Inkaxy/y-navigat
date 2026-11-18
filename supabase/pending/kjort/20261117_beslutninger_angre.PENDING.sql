-- =====================================================================================
-- PENDING 17.11.2026 · Variant B fase 1 · «Angre» på svar i Beslutninger
-- Kjøres av root. Bare additivt + ett md5-bundet tekstbytte. Endrer eller sletter
-- INGEN eksisterende data ved kjøring.
--
--  1. _rm_retain_price_acceptance (triggerfunksjon, live md5 35d0e2bd23aff1c85459c4299db189d9
--     lest 16.11.2026): én ny linje slik at en eksplisitt angring ikke gjenopprettes av vakten.
--     Bytte bare når md5 er uendret; ellers stopper hele filen.
--  2. Ny rm_undo_price_acceptance: gjenåpner godtatte prisavvik (samme årsaker som ble godtatt).
--     Skriverett; egne svar, eller approve/admin for andres. Låst/avstemt/godkjent/ført faktura sperrer.
--  3. Ny rm_undo_not_item: gjenåpner linjer merket «Ikke vare» via rm_link_supplier_item og fjerner
--     regelen som ble laget i SAMME svar (samme transaksjonstid, leverandør og bruker) når
--     p_remove_rule=true. Samme sperrer som over.
--  4. Ny rm_cap_beslutninger_v1(): frontend viser «Angre» bare når denne finnes.
-- =====================================================================================
begin;

do $guard$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public._rm_retain_price_acceptance'::regproc);
  if md5(v_def) <> '35d0e2bd23aff1c85459c4299db189d9' then
    raise exception 'Avbrutt: _rm_retain_price_acceptance er endret siden 16.11.2026 (md5 %). Ingenting er kjørt.', md5(v_def);
  end if;
  v_new := replace(v_def,
    '  IF acc IS NULL OR NEW.price_acceptance IS NOT NULL OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN RETURN NEW; END IF;',
    '  IF acc IS NULL OR NEW.price_acceptance IS NOT NULL OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN RETURN NEW; END IF;
  -- Variant B 17.11.2026: eksplisitt angring (rm_undo_price_acceptance) skal ikke gjenopprettes her.
  IF coalesce(current_setting(''rm.undo_price_acceptance'', true), '''') = ''on'' THEN RETURN NEW; END IF;');
  if v_new = v_def then raise exception 'Avbrutt: fant ikke linjen som skal byttes i _rm_retain_price_acceptance.'; end if;
  execute v_new;
end $guard$;

create or replace function public.rm_undo_price_acceptance(p_legal_entity_id uuid, p_line_ids uuid[], p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_approve boolean;
  v_allowed constant text[] := array['price_variance','price_increase','price_drop'];
  r record; v_acc jsonb; v_reasons text[]; v_seen uuid[] := '{}';
  v_undone jsonb := '[]'::jsonb; v_skipped jsonb := '[]'::jsonb; v_invoices uuid[] := '{}';
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.has_ravarer_invoice_access(p_legal_entity_id, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer' using errcode = '42501';
  end if;
  if p_line_ids is null or coalesce(cardinality(p_line_ids), 0) = 0 or cardinality(p_line_ids) > 500 then
    raise exception 'ugyldig_linjeutvalg' using errcode = '22023';
  end if;
  v_approve := coalesce(public.has_ravarer_invoice_approve(p_legal_entity_id), false);

  -- Faktura før linjer: samme låserekkefølge som accept_invoice_line_price_variance.
  perform 1 from public.invoices i
   where i.legal_entity_id = p_legal_entity_id
     and i.id in (select il.invoice_id from public.invoice_lines il where il.id = any(p_line_ids))
   order by i.id for update of i;

  for r in
    select il.id, il.invoice_id, il.requires_review, il.price_acceptance, i.status as inv_status, i.flagged_at,
           i.reconciled_at, i.invoice_number
      from public.invoice_lines il join public.invoices i on i.id = il.invoice_id
     where il.id = any(p_line_ids) and i.legal_entity_id = p_legal_entity_id
     order by il.invoice_id, il.id
       for update of il
  loop
    v_seen := v_seen || r.id;
    v_acc := r.price_acceptance;
    if v_acc is null then
      v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'ikke_godtatt'); continue;
    end if;
    if coalesce(r.requires_review, false) then
      v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'allerede_apen'); continue;
    end if;
    if not v_approve and (v_acc->>'accepted_by') is distinct from v_uid::text then
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

    select coalesce(array_agg(x), '{}') into v_reasons
      from jsonb_array_elements_text(case when jsonb_typeof(v_acc->'accepted_reasons') = 'array' then v_acc->'accepted_reasons' else '[]'::jsonb end) x
     where x = any(v_allowed);
    if coalesce(cardinality(v_reasons), 0) = 0 then v_reasons := array['price_variance']; end if;

    perform set_config('rm.undo_price_acceptance', 'on', true);
    update public.invoice_lines
       set requires_review = true, review_reason = array_to_string(v_reasons, ','), price_acceptance = null,
           resolution_note = null, resolved_by = null, resolved_at = null, updated_at = now()
     where id = r.id;
    perform set_config('rm.undo_price_acceptance', '', true);

    insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
    values (v_uid, 'invoice_line.price_variance_acceptance_undone', 'invoice_line', r.id, p_legal_entity_id,
            jsonb_build_object('previous_acceptance', v_acc, 'reopened_reasons', to_jsonb(v_reasons)),
            coalesce(nullif(btrim(p_reason), ''), 'Godtatt pris angret i Beslutninger'), 'ravarer');
    v_undone := v_undone || jsonb_build_object('id', r.id, 'invoice_id', r.invoice_id, 'invoice_number', r.invoice_number);
    if not (r.invoice_id = any(v_invoices)) then v_invoices := v_invoices || r.invoice_id; end if;
  end loop;

  foreach v_id in array p_line_ids loop
    if not (v_id = any(v_seen)) then v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'finnes_ikke'); end if;
  end loop;
  return jsonb_build_object('ok', true, 'undone', v_undone, 'skipped', v_skipped, 'invoice_ids', to_jsonb(v_invoices));
end
$fn$;

create or replace function public.rm_undo_not_item(p_legal_entity_id uuid, p_supplier_id uuid, p_item_key text, p_line_ids uuid[],
                                                   p_remove_rule boolean default true, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_approve boolean;
  r record; v_seen uuid[] := '{}'; v_times timestamptz[] := '{}';
  v_undone jsonb := '[]'::jsonb; v_skipped jsonb := '[]'::jsonb; v_invoices uuid[] := '{}';
  v_rules jsonb := '[]'::jsonb; v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.has_ravarer_invoice_access(p_legal_entity_id, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer' using errcode = '42501';
  end if;
  if p_supplier_id is null or p_item_key is null or p_item_key !~ '^(sku|name):' then
    raise exception 'ugyldig_varenokkel' using errcode = '22023';
  end if;
  if p_line_ids is null or coalesce(cardinality(p_line_ids), 0) = 0 or cardinality(p_line_ids) > 500 then
    raise exception 'ugyldig_linjeutvalg' using errcode = '22023';
  end if;
  v_approve := coalesce(public.has_ravarer_invoice_approve(p_legal_entity_id), false);

  perform 1 from public.invoices i
   where i.legal_entity_id = p_legal_entity_id and i.supplier_id = p_supplier_id
     and i.id in (select il.invoice_id from public.invoice_lines il where il.id = any(p_line_ids))
   order by i.id for update of i;

  for r in
    select il.id, il.invoice_id, il.match_confidence, il.resolution_note, il.resolved_by, il.resolved_at, il.excluded_at,
           i.status as inv_status, i.flagged_at, i.reconciled_at, i.invoice_number
      from public.invoice_lines il join public.invoices i on i.id = il.invoice_id
     where il.id = any(p_line_ids) and i.legal_entity_id = p_legal_entity_id and i.supplier_id = p_supplier_id
       and (case when public.rm_sku_norm(il.supplier_sku) <> '' then 'sku:' || public.rm_sku_norm(il.supplier_sku)
                 else 'name:' || public.rm_match_key(il.description) end) = p_item_key
     order by il.invoice_id, il.id
       for update of il
  loop
    v_seen := v_seen || r.id;
    if coalesce(r.match_confidence, '') <> 'not_applicable' or coalesce(r.resolution_note, '') not like 'Ikke vare:%' then
      v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'ikke_merket'); continue;
    end if;
    if r.excluded_at is not null then
      v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'holdt_utenfor'); continue;
    end if;
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
       set match_confidence = 'unmatched', raw_material_id = null, requires_review = true, review_reason = 'unmatched',
           resolution_note = null, resolved_by = null, resolved_at = null, updated_at = now()
     where id = r.id;
    if r.resolved_at is not null and not (r.resolved_at = any(v_times)) then v_times := v_times || r.resolved_at; end if;
    v_undone := v_undone || jsonb_build_object('id', r.id, 'invoice_id', r.invoice_id, 'invoice_number', r.invoice_number);
    if not (r.invoice_id = any(v_invoices)) then v_invoices := v_invoices || r.invoice_id; end if;
  end loop;

  -- Regelen rm_link_supplier_item laget i samme transaksjon har created_at = resolved_at.
  if coalesce(p_remove_rule, true) and cardinality(v_times) > 0 then
    with del as (
      delete from public.invoice_line_exclusion_patterns e
       where e.legal_entity_id = p_legal_entity_id and e.supplier_id is not distinct from p_supplier_id
         and e.created_at = any(v_times) and (e.created_by = v_uid or v_approve)
      returning e.id, e.pattern_type, e.pattern_value, e.reason)
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'pattern_type', pattern_type, 'pattern_value', pattern_value, 'reason', reason)), '[]'::jsonb)
      into v_rules from del;
  end if;

  foreach v_id in array p_line_ids loop
    if not (v_id = any(v_seen)) then v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'finnes_ikke'); end if;
  end loop;
  if jsonb_array_length(v_undone) > 0 or jsonb_array_length(v_rules) > 0 then
    insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
    values (v_uid, 'supplier_item.exclusion_undone', 'supplier', p_supplier_id, p_legal_entity_id,
            jsonb_build_object('item_key', p_item_key, 'lines', v_undone, 'removed_rules', v_rules),
            coalesce(nullif(btrim(p_reason), ''), '«Ikke vare» angret i Beslutninger'), 'ravarer');
  end if;
  return jsonb_build_object('ok', true, 'undone', v_undone, 'skipped', v_skipped, 'removed_rules', v_rules, 'invoice_ids', to_jsonb(v_invoices));
end
$fn$;

create or replace function public.rm_cap_beslutninger_v1()
returns boolean language sql stable security invoker set search_path to 'public' as $fn$ select true $fn$;

revoke all on function public.rm_undo_price_acceptance(uuid, uuid[], text) from public, anon;
revoke all on function public.rm_undo_not_item(uuid, uuid, text, uuid[], boolean, text) from public, anon;
revoke all on function public.rm_cap_beslutninger_v1() from public, anon;
grant execute on function public.rm_undo_price_acceptance(uuid, uuid[], text) to authenticated, service_role;
grant execute on function public.rm_undo_not_item(uuid, uuid, text, uuid[], boolean, text) to authenticated, service_role;
grant execute on function public.rm_cap_beslutninger_v1() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
