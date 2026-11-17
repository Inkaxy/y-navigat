CREATE OR REPLACE FUNCTION public.rm_undo_not_item(p_legal_entity_id uuid, p_supplier_id uuid, p_item_key text, p_line_ids uuid[], p_remove_rule boolean DEFAULT true, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
