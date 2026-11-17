CREATE OR REPLACE FUNCTION public.rm_set_invoice_exclusion(p_invoice_id uuid, p_scope text, p_line_id uuid DEFAULT NULL::uuid, p_category text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_expected_updated_at text DEFAULT NULL::text, p_op_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_inv invoices%rowtype; v_line invoice_lines%rowtype;
  v_reason text := btrim(coalesce(p_reason, '')); v_now timestamptz := now();
  v_blocked jsonb; v_n int := 0;
begin
  if v_uid is null then raise exception 'ikke_innlogget' using errcode = '42501'; end if;
  if p_scope not in ('invoice','line') then return jsonb_build_object('ok', false, 'error', 'ugyldig_omfang'); end if;
  if p_category not in ('erstatning_produksjonstap','annet') then return jsonb_build_object('ok', false, 'error', 'ugyldig_arsak'); end if;
  if length(v_reason) < 5 or length(v_reason) > 500 then return jsonb_build_object('ok', false, 'error', 'begrunnelse_mangler'); end if;
  if p_op_id is null then return jsonb_build_object('ok', false, 'error', 'op_mangler'); end if;

  select * into v_inv from invoices where id = p_invoice_id for update;
  if not found or not public.has_ravarer_invoice_access(v_inv.legal_entity_id, 'write') then
    raise exception 'ingen_tilgang' using errcode = '42501';
  end if;

  if p_scope = 'invoice' then
    if v_inv.status = 'excluded' then
      if v_inv.exclusion_prev->>'op_id' = p_op_id::text then
        return jsonb_build_object('ok', true, 'already', true, 'scope', 'invoice', 'invoice_id', v_inv.id, 'updated_at', v_inv.updated_at::text);
      end if;
      return jsonb_build_object('ok', false, 'error', 'allerede_holdt_utenfor');
    end if;
    if v_inv.updated_at is distinct from nullif(p_expected_updated_at, '')::timestamptz then return jsonb_build_object('ok', false, 'error', 'versjon_endret'); end if;
    if v_inv.status = 'reconciled' or v_inv.reconciled_at is not null then return jsonb_build_object('ok', false, 'error', 'faktura_avstemt'); end if;
    if exists (select 1 from invoice_internal_approvals a where a.invoice_id = v_inv.id and a.status = 'approved' and a.revoked_at is null) then
      return jsonb_build_object('ok', false, 'error', 'faktura_godkjent');
    end if;
    select jsonb_agg(jsonb_build_object('line_id', l.id, 'line_number', l.line_number, 'blocker', public._rm_line_exclusion_blocker(l.id)))
      into v_blocked from invoice_lines l
     where l.invoice_id = v_inv.id and l.excluded_at is null and public._rm_line_exclusion_blocker(l.id) is not null;
    if v_blocked is not null then return jsonb_build_object('ok', false, 'error', 'reversering_kreves', 'blocked_lines', v_blocked); end if;

    perform set_config('rm.exclusion_write', 'on', true);
    update invoice_lines l set
        exclusion_prev = jsonb_build_object('raw_material_id', l.raw_material_id, 'match_confidence', l.match_confidence,
          'requires_review', l.requires_review, 'review_reason', l.review_reason, 'variance_status', l.variance_status,
          'price_variance_pct', l.price_variance_pct, 'expected_price_per_base_unit', l.expected_price_per_base_unit, 'op_id', p_op_id, 'via', 'invoice'),
        excluded_raw_material_id = l.raw_material_id, excluded_at = v_now, excluded_by = v_uid,
        exclusion_category = p_category, exclusion_reason = v_reason,
        raw_material_id = null, match_confidence = 'not_applicable', requires_review = false,
        variance_status = null, price_variance_pct = null, expected_price_per_base_unit = null
     where l.invoice_id = v_inv.id and l.excluded_at is null;
    get diagnostics v_n = row_count;
    update invoices set status = 'excluded', excluded_at = v_now, excluded_by = v_uid, exclusion_category = p_category,
        exclusion_reason = v_reason,
        exclusion_prev = jsonb_build_object('status', v_inv.status, 'op_id', p_op_id, 'lines_sum_status', v_inv.lines_sum_status)
     where id = v_inv.id returning * into v_inv;
    perform set_config('rm.exclusion_write', '', true);
    insert into audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
    values (v_uid, 'invoice.excluded', 'invoices', v_inv.id, v_inv.legal_entity_id,
      jsonb_build_object('scope', 'invoice', 'category', p_category, 'lines', v_n, 'prev_status', v_inv.exclusion_prev->>'status',
        'lines_sum_status', v_inv.lines_sum_status, 'op_id', p_op_id), v_reason, 'ravarer');
    return jsonb_build_object('ok', true, 'already', false, 'scope', 'invoice', 'invoice_id', v_inv.id, 'lines', v_n, 'updated_at', v_inv.updated_at::text);
  end if;

  select * into v_line from invoice_lines where id = p_line_id and invoice_id = v_inv.id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'linje_finnes_ikke'); end if;
  if v_line.excluded_at is not null then
    if v_line.exclusion_prev->>'op_id' = p_op_id::text then
      return jsonb_build_object('ok', true, 'already', true, 'scope', 'line', 'line_id', v_line.id, 'updated_at', v_line.updated_at::text);
    end if;
    return jsonb_build_object('ok', false, 'error', 'allerede_holdt_utenfor');
  end if;
  if v_inv.status = 'excluded' then return jsonb_build_object('ok', false, 'error', 'faktura_holdt_utenfor'); end if;
  if v_line.updated_at is distinct from nullif(p_expected_updated_at, '')::timestamptz then return jsonb_build_object('ok', false, 'error', 'versjon_endret'); end if;
  if v_inv.status = 'reconciled' or v_inv.reconciled_at is not null then return jsonb_build_object('ok', false, 'error', 'faktura_avstemt'); end if;
  if exists (select 1 from invoice_internal_approvals a where a.invoice_id = v_inv.id and a.status = 'approved' and a.revoked_at is null) then
    return jsonb_build_object('ok', false, 'error', 'faktura_godkjent');
  end if;
  if public._rm_line_exclusion_blocker(v_line.id) is not null then
    return jsonb_build_object('ok', false, 'error', 'reversering_kreves', 'blocked_lines',
      jsonb_build_array(jsonb_build_object('line_id', v_line.id, 'line_number', v_line.line_number, 'blocker', public._rm_line_exclusion_blocker(v_line.id))));
  end if;
  perform set_config('rm.exclusion_write', 'on', true);
  update invoice_lines set
      exclusion_prev = jsonb_build_object('raw_material_id', raw_material_id, 'match_confidence', match_confidence,
        'requires_review', requires_review, 'review_reason', review_reason, 'variance_status', variance_status,
        'price_variance_pct', price_variance_pct, 'expected_price_per_base_unit', expected_price_per_base_unit, 'op_id', p_op_id, 'via', 'line'),
      excluded_raw_material_id = raw_material_id, excluded_at = v_now, excluded_by = v_uid,
      exclusion_category = p_category, exclusion_reason = v_reason,
      raw_material_id = null, match_confidence = 'not_applicable', requires_review = false,
      variance_status = null, price_variance_pct = null, expected_price_per_base_unit = null
   where id = v_line.id returning * into v_line;
  perform set_config('rm.exclusion_write', '', true);
  insert into audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'invoice_line.excluded', 'invoice_lines', v_line.id, v_inv.legal_entity_id,
    jsonb_build_object('scope', 'line', 'invoice_id', v_inv.id, 'category', p_category,
      'raw_material_id', v_line.excluded_raw_material_id, 'op_id', p_op_id), v_reason, 'ravarer');
  return jsonb_build_object('ok', true, 'already', false, 'scope', 'line', 'line_id', v_line.id, 'updated_at', v_line.updated_at::text);
end $function$
