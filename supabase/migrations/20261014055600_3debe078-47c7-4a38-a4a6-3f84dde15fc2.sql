-- Varig «Hold utenfor råvarebehandling» for faktura/kreditnota og enkeltlinje.
alter table public.invoices
  add column if not exists excluded_at timestamptz,
  add column if not exists excluded_by uuid,
  add column if not exists exclusion_category text,
  add column if not exists exclusion_reason text,
  add column if not exists exclusion_prev jsonb;
alter table public.invoice_lines
  add column if not exists excluded_at timestamptz,
  add column if not exists excluded_by uuid,
  add column if not exists exclusion_category text,
  add column if not exists exclusion_reason text,
  add column if not exists excluded_raw_material_id uuid,
  add column if not exists exclusion_prev jsonb;

alter table public.invoices drop constraint invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status = any (array['imported','needs_review','ready','reconciled','flagged','excluded']));
alter table public.invoices add constraint invoices_exclusion_category_check
  check (exclusion_category is null or exclusion_category in ('erstatning_produksjonstap','annet'));
alter table public.invoice_lines add constraint invoice_lines_exclusion_category_check
  check (exclusion_category is null or exclusion_category in ('erstatning_produksjonstap','annet'));
alter table public.invoices add constraint invoices_excluded_consistent
  check ((status = 'excluded') = (excluded_at is not null));

create or replace function public._rm_invoice_exclusion_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('rm.exclusion_write', true), '') = 'on' then return new; end if;
  if new.excluded_at is distinct from old.excluded_at or new.excluded_by is distinct from old.excluded_by
     or new.exclusion_category is distinct from old.exclusion_category or new.exclusion_reason is distinct from old.exclusion_reason
     or new.exclusion_prev is distinct from old.exclusion_prev or (coalesce(new.status,'') = 'excluded') <> (coalesce(old.status,'') = 'excluded') then
    if auth.uid() is not null then
      raise exception 'faktura_holdt_utenfor: bruk Hold utenfor/Gjenåpne' using errcode = 'P0001';
    end if;
    new.excluded_at := old.excluded_at; new.excluded_by := old.excluded_by;
    new.exclusion_category := old.exclusion_category; new.exclusion_reason := old.exclusion_reason;
    new.exclusion_prev := old.exclusion_prev;
    new.status := case when old.status = 'excluded' then 'excluded'
                       when new.status = 'excluded' then old.status else new.status end;
  end if;
  return new;
end $$;
drop trigger if exists zzz_rm_invoice_exclusion_guard on public.invoices;
create trigger zzz_rm_invoice_exclusion_guard before update on public.invoices
  for each row execute function public._rm_invoice_exclusion_guard();

create or replace function public._rm_line_exclusion_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_inv record;
begin
  if coalesce(current_setting('rm.exclusion_write', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.excluded_at is not null and exists (select 1 from invoices where id = old.invoice_id) then
      raise exception 'linje_holdt_utenfor: linjen er holdt utenfor råvarebehandling og kan ikke slettes' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.excluded_at := null; new.excluded_by := null; new.exclusion_category := null;
    new.exclusion_reason := null; new.excluded_raw_material_id := null; new.exclusion_prev := null;
    select status, excluded_at, excluded_by, exclusion_category, exclusion_reason into v_inv from invoices where id = new.invoice_id;
    if v_inv.status = 'excluded' then
      new.exclusion_prev := jsonb_build_object('raw_material_id', new.raw_material_id, 'match_confidence', new.match_confidence,
        'requires_review', new.requires_review, 'review_reason', new.review_reason, 'inserted_while_excluded', true, 'via', 'invoice');
      new.excluded_raw_material_id := new.raw_material_id;
      new.excluded_at := v_inv.excluded_at; new.excluded_by := v_inv.excluded_by;
      new.exclusion_category := v_inv.exclusion_category; new.exclusion_reason := v_inv.exclusion_reason;
      new.raw_material_id := null; new.match_confidence := 'not_applicable'; new.requires_review := false;
      new.variance_status := null; new.price_variance_pct := null; new.expected_price_per_base_unit := null;
    end if;
    return new;
  end if;
  if new.excluded_at is distinct from old.excluded_at or new.excluded_by is distinct from old.excluded_by
     or new.exclusion_category is distinct from old.exclusion_category or new.exclusion_reason is distinct from old.exclusion_reason
     or new.excluded_raw_material_id is distinct from old.excluded_raw_material_id or new.exclusion_prev is distinct from old.exclusion_prev then
    if auth.uid() is not null then raise exception 'linje_holdt_utenfor: bruk Hold utenfor/Gjenåpne' using errcode = 'P0001'; end if;
    new.excluded_at := old.excluded_at; new.excluded_by := old.excluded_by; new.exclusion_category := old.exclusion_category;
    new.exclusion_reason := old.exclusion_reason; new.excluded_raw_material_id := old.excluded_raw_material_id;
    new.exclusion_prev := old.exclusion_prev;
  end if;
  if old.excluded_at is not null and (new.raw_material_id is distinct from old.raw_material_id
       or new.match_confidence is distinct from old.match_confidence or new.requires_review is distinct from old.requires_review
       or new.variance_status is distinct from old.variance_status) then
    if auth.uid() is not null then
      raise exception 'linje_holdt_utenfor: linjen er holdt utenfor råvarebehandling. Gjenåpne den først.' using errcode = 'P0001';
    end if;
    new.raw_material_id := old.raw_material_id; new.match_confidence := old.match_confidence;
    new.requires_review := old.requires_review; new.review_reason := old.review_reason;
    new.variance_status := old.variance_status; new.price_variance_pct := old.price_variance_pct;
    new.expected_price_per_base_unit := old.expected_price_per_base_unit;
  end if;
  return new;
end $$;
drop trigger if exists zzz_rm_line_exclusion_guard on public.invoice_lines;
create trigger zzz_rm_line_exclusion_guard before insert or update or delete on public.invoice_lines
  for each row execute function public._rm_line_exclusion_guard();

create or replace function public._rm_line_exclusion_blocker(p_line_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from invoice_line_cost_postings p where p.invoice_line_id = p_line_id and p.revoked_at is null)
      then 'kostpris_fort'
    when exists (select 1 from stock_movements s where s.source_table = 'invoice_lines' and s.source_id = p_line_id)
      then 'lagerbevegelse'
    when exists (select 1 from rm_goods_receipts g where g.invoice_line_id = p_line_id) then 'varemottak'
    when exists (select 1 from rm_stock_lots s where s.invoice_line_id = p_line_id) then 'lagerparti'
    when exists (select 1 from raw_material_price_history h where h.invoice_line_id = p_line_id and h.superseded_at is null)
      then 'prisobservasjon'
    else null end
$$;

create or replace function public.rm_set_invoice_exclusion(
  p_invoice_id uuid, p_scope text, p_line_id uuid, p_category text, p_reason text,
  p_expected_updated_at text, p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
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
    if v_inv.updated_at::text is distinct from p_expected_updated_at then return jsonb_build_object('ok', false, 'error', 'versjon_endret'); end if;
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
  if v_line.updated_at::text is distinct from p_expected_updated_at then return jsonb_build_object('ok', false, 'error', 'versjon_endret'); end if;
  if v_inv.status = 'reconciled' or v_inv.reconciled_at is not null then return jsonb_build_object('ok', false, 'error', 'faktura_avstemt'); end if;
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
end $$;

create or replace function public.rm_reopen_invoice_exclusion(
  p_invoice_id uuid, p_scope text, p_line_id uuid, p_expected_updated_at text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_inv invoices%rowtype; v_line invoice_lines%rowtype; v_n int := 0;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_uid is null then raise exception 'ikke_innlogget' using errcode = '42501'; end if;
  if p_scope not in ('invoice','line') then return jsonb_build_object('ok', false, 'error', 'ugyldig_omfang'); end if;
  select * into v_inv from invoices where id = p_invoice_id for update;
  if not found or not public.has_ravarer_invoice_access(v_inv.legal_entity_id, 'write') then
    raise exception 'ingen_tilgang' using errcode = '42501';
  end if;
  if p_scope = 'invoice' then
    if v_inv.status <> 'excluded' then
      return jsonb_build_object('ok', true, 'already', true, 'scope', 'invoice', 'updated_at', v_inv.updated_at::text);
    end if;
    if v_inv.updated_at::text is distinct from p_expected_updated_at then
      return jsonb_build_object('ok', false, 'error', 'versjon_endret');
    end if;
    perform set_config('rm.exclusion_write', 'on', true);
    update invoice_lines set excluded_at = null, excluded_by = null, exclusion_category = null, exclusion_reason = null,
        exclusion_prev = null, excluded_raw_material_id = null, raw_material_id = null,
        match_confidence = case when exclusion_prev->>'match_confidence' = 'not_applicable' then 'not_applicable' else 'unmatched' end,
        requires_review = case when exclusion_prev->>'match_confidence' = 'not_applicable' then coalesce((exclusion_prev->>'requires_review')::boolean, false) else true end,
        review_reason = case when exclusion_prev->>'match_confidence' = 'not_applicable' then exclusion_prev->>'review_reason' else 'reopened_exclusion' end
     where invoice_id = v_inv.id and excluded_at is not null and coalesce(exclusion_prev->>'via', 'invoice') = 'invoice';
    get diagnostics v_n = row_count;
    update invoices set status = 'needs_review', excluded_at = null, excluded_by = null, exclusion_category = null,
        exclusion_reason = null, exclusion_prev = null where id = v_inv.id returning * into v_inv;
    perform set_config('rm.exclusion_write', '', true);
    insert into audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
    values (v_uid, 'invoice.exclusion_reopened', 'invoices', v_inv.id, v_inv.legal_entity_id,
      jsonb_build_object('scope', 'invoice', 'lines', v_n), nullif(v_reason, ''), 'ravarer');
    return jsonb_build_object('ok', true, 'already', false, 'scope', 'invoice', 'lines', v_n, 'updated_at', v_inv.updated_at::text);
  end if;
  select * into v_line from invoice_lines where id = p_line_id and invoice_id = v_inv.id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'linje_finnes_ikke'); end if;
  if v_line.excluded_at is null then
    return jsonb_build_object('ok', true, 'already', true, 'scope', 'line', 'updated_at', v_line.updated_at::text);
  end if;
  if v_inv.status = 'excluded' then return jsonb_build_object('ok', false, 'error', 'faktura_holdt_utenfor'); end if;
  if v_line.updated_at::text is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'error', 'versjon_endret');
  end if;
  perform set_config('rm.exclusion_write', 'on', true);
  update invoice_lines set excluded_at = null, excluded_by = null, exclusion_category = null, exclusion_reason = null,
      exclusion_prev = null, excluded_raw_material_id = null, raw_material_id = null,
      match_confidence = 'unmatched', requires_review = true, review_reason = 'reopened_exclusion'
   where id = v_line.id returning * into v_line;
  perform set_config('rm.exclusion_write', '', true);
  insert into audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'invoice_line.exclusion_reopened', 'invoice_lines', v_line.id, v_inv.legal_entity_id,
    jsonb_build_object('scope', 'line', 'invoice_id', v_inv.id), nullif(v_reason, ''), 'ravarer');
  return jsonb_build_object('ok', true, 'already', false, 'scope', 'line', 'updated_at', v_line.updated_at::text);
end $$;

revoke all on function public.rm_set_invoice_exclusion(uuid, text, uuid, text, text, text, uuid) from public, anon;
revoke all on function public.rm_reopen_invoice_exclusion(uuid, text, uuid, text, text) from public, anon;
revoke all on function public._rm_line_exclusion_blocker(uuid) from public, anon, authenticated;
revoke all on function public._rm_invoice_exclusion_guard() from public, anon, authenticated;
revoke all on function public._rm_line_exclusion_guard() from public, anon, authenticated;
grant execute on function public.rm_set_invoice_exclusion(uuid, text, uuid, text, text, text, uuid) to authenticated, service_role;
grant execute on function public.rm_reopen_invoice_exclusion(uuid, text, uuid, text, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.invoice_approval_blockers(p_invoice_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v invoices%rowtype; b text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN ARRAY['finnes_ikke']::text[]; END IF;
  IF v.status = 'excluded' THEN b := array_append(b, 'holdt_utenfor'); END IF;
  IF v.flagged_at IS NOT NULL THEN b := array_append(b, 'flagget'); END IF;
  IF v.status = 'cancelled' THEN b := array_append(b, 'kansellert'); END IF;
  IF v.supplier_id IS NULL THEN b := array_append(b, 'leverandor_mangler'); END IF;
  IF NOT rm_is_finite(v.total_amount) THEN b := array_append(b, 'belop_mangler'); END IF;
  IF NOT rm_is_finite(v.total_vat) THEN b := array_append(b, 'mva_ukjent'); END IF;
  IF coalesce(trim(v.currency),'') = '' THEN b := array_append(b, 'valuta_mangler'); END IF;
  IF NOT EXISTS (SELECT 1 FROM invoice_lines WHERE invoice_id = v.id) THEN
    b := array_append(b, 'mangler_linjer');
  ELSIF v.lines_sum_status = 'mismatch' THEN
    b := array_append(b, 'sumavvik');
  ELSIF coalesce(v.lines_sum_status,'') <> 'ok' THEN
    b := array_append(b, 'sum_ukontrollert');
  END IF;
  IF v.extraction_confidence IS NOT NULL AND v.extraction_confidence < 0.6 THEN b := array_append(b, 'lavt_uttrekk'); END IF;
  IF rm_invoice_has_read_issues(v.id) THEN b := array_append(b, 'lesefeil'); END IF;
  IF EXISTS (SELECT 1 FROM invoices o WHERE o.id <> v.id AND o.legal_entity_id = v.legal_entity_id
             AND o.supplier_id IS NOT DISTINCT FROM v.supplier_id AND o.invoice_number = v.invoice_number
             AND coalesce(o.is_credit_note,false) = coalesce(v.is_credit_note,false) AND coalesce(o.status,'') <> 'cancelled') THEN
    b := array_append(b, 'duplikat');
  END IF;
  IF EXISTS (SELECT 1 FROM invoice_lines il WHERE il.invoice_id = v.id
             AND coalesce(il.match_confidence::text,'') <> 'not_applicable'
             AND (il.review_reason ~ '(extraction_issue|extraction_unresolved|zero_quantity)'
               OR (rm_is_finite(il.quantity) AND rm_is_finite(il.unit_price) AND rm_is_finite(il.total_amount)
                   AND il.quantity > 0 AND il.total_amount <> 0
                   AND abs(il.quantity * il.unit_price - il.total_amount) > 0.015 * abs(il.total_amount)
                   AND NOT (rm_is_finite(il.base_quantity) AND il.base_quantity > 0
                            AND abs(il.base_quantity * il.unit_price - il.total_amount) <= 0.015 * abs(il.total_amount))))) THEN
    b := array_append(b, 'mengde');
  END IF;
  IF EXISTS (SELECT 1 FROM invoice_lines il WHERE il.invoice_id = v.id AND coalesce(il.requires_review,false)
             AND il.review_reason ~ '(price_variance|price_increase|price_drop|agreement_conflict)'
             AND NOT public.invoice_line_credit_covered(il.id)) THEN
    b := array_append(b, 'prisavvik');
  END IF;
  IF EXISTS (SELECT 1 FROM supplier_deviation_case_lines l JOIN supplier_deviation_cases c ON c.id = l.case_id
             WHERE l.invoice_id = v.id AND c.status = 'open'
             AND public.supplier_case_invoice_remaining(c.id, v.id) > 0.005) THEN
    b := array_append(b, 'leverandorsak');
  END IF;
  RETURN b;
END $function$;