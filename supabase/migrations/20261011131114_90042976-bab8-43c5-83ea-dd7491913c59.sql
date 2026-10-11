CREATE OR REPLACE FUNCTION public.rm_repair_invoice_vat(p_invoice_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v invoices%rowtype; v_sum numeric; v_n int; v_ratio numeric; v_factor numeric; v_expected numeric;
begin
  -- Endrer ALDRI beløp eller mva. Et mva-lignende forhold kan like gjerne være en manglende linje;
  -- funksjonen gir bare forslag og kontrollbehov (dokumentkontroll mot originalen).
  select * into v from public.invoices where id = p_invoice_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'finnes_ikke'); end if;
  if auth.uid() is not null and not public.has_ravarer_invoice_access(v.legal_entity_id, 'read') then
    raise exception 'Mangler tilgang til fakturaer' using errcode = '42501';
  end if;
  if v.status in ('reconciled') then return jsonb_build_object('ok', false, 'reason', 'avstemt'); end if;
  select coalesce(sum(total_amount), 0), count(*) into v_sum, v_n from public.invoice_lines where invoice_id = v.id;
  if v_n = 0 or v_sum = 0 or v.total_amount is null or v.total_amount = 0 then
    return jsonb_build_object('ok', false, 'reason', 'ingen_linjer_eller_sum');
  end if;
  if v.total_vat is not null then
    v_expected := v.total_amount - v.total_vat;
    if v_expected = 0 then return jsonb_build_object('ok', false, 'reason', 'netto_null'); end if;
    v_ratio := v_sum / v_expected;
  else
    v_ratio := v_sum / v.total_amount;
  end if;
  v_factor := case when abs(v_ratio - 1/1.15) < 0.004 then 1.15 when abs(v_ratio - 1/1.25) < 0.004 then 1.25 end;
  if v_factor is null then return jsonb_build_object('ok', false, 'reason', 'ikke_mva_monster', 'ratio', round(v_ratio, 4)); end if;
  return jsonb_build_object('ok', false, 'reason', 'kontroll_trengs',
    'suggestion', case when v.total_vat is not null then 'linjer_skalert' else 'mva_utledet' end,
    'factor', v_factor, 'ratio', round(v_ratio, 4), 'lines', v_n);
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.rm_repair_invoice_vat_candidates(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rm_read_unit_factor(text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rm_line_read_issues(numeric,text,numeric,numeric,numeric,text,numeric,boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rm_lines_sum_check(numeric,integer,numeric,numeric) FROM anon;

-- E-postkø: claim bare ventende rader; aldri replay av sendt; uklart utfall sendes ikke blindt på nytt.
CREATE OR REPLACE FUNCTION public.claim_email_outbox_batch(p_limit integer DEFAULT 20)
 RETURNS SETOF email_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.email_outbox
     SET status = 'failed',
         error_message = 'Ukjent leveringsutfall (avbrutt under sending). Kontroller i postkassen før ny sending.'
   WHERE status = 'sending' AND last_attempt_at < now() - interval '15 minutes';
  RETURN QUERY
  UPDATE public.email_outbox o
     SET status = 'sending', last_attempt_at = now(), attempt_count = o.attempt_count + 1
   WHERE o.id IN (
     SELECT e.id FROM public.email_outbox e
      WHERE e.status = 'pending' AND e.attempt_count < 5
      ORDER BY e.created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT GREATEST(LEAST(p_limit, 50), 1))
  RETURNING o.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_email_outbox_one(p_id uuid)
 RETURNS SETOF email_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.email_outbox o
     SET status = 'sending', last_attempt_at = now(), attempt_count = o.attempt_count + 1
   WHERE o.id = p_id AND o.status = 'pending' AND o.attempt_count < 5
  RETURNING o.*;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.claim_email_outbox_batch(integer) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_email_outbox_one(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_outbox_batch(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_email_outbox_one(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._email_outbox_guard_henrik_draft()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.related_entity_type = 'supplier_case_email_draft' THEN
    IF lower(NEW.recipient_email) <> 'henrik@nottero-bakeri.no' OR NEW.template_key <> 'supplier_case_draft_internal' THEN
      RAISE EXCEPTION 'Leverandørkladder kan bare sendes internt til Henrik' USING errcode = '42501';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.related_entity_type = 'supplier_case_email_draft'
     AND (NEW.recipient_email IS DISTINCT FROM OLD.recipient_email OR NEW.related_entity_type IS DISTINCT FROM OLD.related_entity_type
          OR NEW.variables IS DISTINCT FROM OLD.variables OR NEW.template_key IS DISTINCT FROM OLD.template_key) THEN
    RAISE EXCEPTION 'Mottaker og innhold i en kø-lagt kladd kan ikke endres' USING errcode = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._email_outbox_guard_henrik_draft() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS trg_email_outbox_guard_henrik_draft ON public.email_outbox;
CREATE TRIGGER trg_email_outbox_guard_henrik_draft BEFORE INSERT OR UPDATE ON public.email_outbox
  FOR EACH ROW EXECUTE FUNCTION public._email_outbox_guard_henrik_draft();

-- Nye tabeller: bare lesing for innloggede (RLS avgjør rader); skriving kun via RPC-er.
REVOKE ALL ON public.invoice_line_corrections, public.invoice_extraction_examples, public.supplier_case_email_drafts FROM anon, authenticated;
GRANT SELECT ON public.invoice_line_corrections, public.invoice_extraction_examples, public.supplier_case_email_drafts TO authenticated;
GRANT ALL ON public.invoice_line_corrections, public.invoice_extraction_examples, public.supplier_case_email_drafts TO service_role;

-- Felles tellerdefinisjon for Godkjenning: samme som listen (ikke kansellert, ikke godkjent, ingen blokkere).
CREATE OR REPLACE FUNCTION public.rm_work_summary(p_legal_entity_id uuid, p_include_approval boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_items jsonb := null; v_inv jsonb := null; v_dq jsonb; v_other jsonb; v_appr jsonb := null; v_lines int := null;
  v_inv_access boolean := auth.uid() is null or public.has_ravarer_invoice_access(p_legal_entity_id, 'read');
  c_open constant text[] := array['imported','needs_review','ready'];
begin
  if not v_inv_access and public.app_access_level('ravarer') = 'none' then
    raise exception 'Ingen tilgang til Råvarer' using errcode = '42501';
  end if;
  if v_inv_access then
    v_items := coalesce((public.rm_supplier_items(p_legal_entity_id, null, null, null, 1, 0))->'counts', '{}'::jsonb);
    select jsonb_build_object(
        'open_total',       count(*) filter (where i.status = any(c_open) and i.flagged_at is null),
        'missing_lines',    count(*) filter (where i.status = any(c_open) and i.flagged_at is null and not exists (select 1 from invoice_lines l where l.invoice_id = i.id)),
        'sum_mismatch',     count(*) filter (where i.status = any(c_open) and i.flagged_at is null and i.lines_sum_status = 'mismatch'),
        'needs_review',     count(*) filter (where i.status = 'needs_review' and i.flagged_at is null),
        'ready_to_reconcile', count(*) filter (where i.status = 'ready' and i.flagged_at is null),
        'credit_notes_open',count(*) filter (where i.status = any(c_open) and i.flagged_at is null and coalesce(i.is_credit_note,false)),
        'flagged',          count(*) filter (where i.flagged_at is not null and coalesce(i.status,'') not in ('reconciled','cancelled')),
        'reconciled_total', count(*) filter (where i.status = 'reconciled'),
        'reconciled_auto',  count(*) filter (where i.status = 'reconciled' and i.reconciled_mode = 'auto'),
        'reconciled_7d',    count(*) filter (where i.status = 'reconciled' and i.reconciled_at > now() - interval '7 days'),
        'reconciled_auto_7d', count(*) filter (where i.status = 'reconciled' and i.reconciled_mode = 'auto' and i.reconciled_at > now() - interval '7 days'),
        'imported_7d',      count(*) filter (where coalesce(i.imported_from_tripletex_at, i.created_at) > now() - interval '7 days'))
      into v_inv
      from invoices i where i.legal_entity_id = p_legal_entity_id and coalesce(i.status,'') <> 'cancelled';
    select count(*) into v_lines
      from invoice_lines il join invoices i on i.id = il.invoice_id
     where i.legal_entity_id = p_legal_entity_id and il.requires_review
       and i.status = any(c_open) and i.flagged_at is null;
    if p_include_approval then
      select jsonb_build_object(
          'ready_to_approve', count(*) filter (where a.id is null and coalesce(array_length(public.invoice_approval_blockers(i.id),1),0) = 0),
          'approved_total',   count(*) filter (where a.id is not null))
        into v_appr
        from invoices i
        left join invoice_internal_approvals a on a.invoice_id = i.id and a.status = 'approved'
       where i.legal_entity_id = p_legal_entity_id and coalesce(i.status,'') <> 'cancelled';
    end if;
  end if;
  select jsonb_build_object(
      'missing_package',     (select count(*) from raw_material_package_worklist w where w.legal_entity_id = p_legal_entity_id and w.status = 'mangler_pakning'),
      'unconfirmed_package', (select count(*) from raw_material_package_worklist w where w.legal_entity_id = p_legal_entity_id and w.status = 'ikke_bekreftet'),
      'unstable_price',      (select count(*) from raw_material_package_worklist w where w.legal_entity_id = p_legal_entity_id and w.status = 'ustabil_pris'),
      'missing_declaration', (select count(*) from raw_material_declaration_worklist d where d.legal_entity_id = p_legal_entity_id and d.missing_declaration_name),
      'missing_nutrition',   (select count(*) from raw_material_declaration_worklist d where d.legal_entity_id = p_legal_entity_id and d.missing_nutrition),
      'datasheet_changes',   (select count(*) from raw_material_changelog c where c.legal_entity_id = p_legal_entity_id and not c.acknowledged and c.severity in ('high','medium')),
      'active_items',        (select count(*) from raw_materials r where r.legal_entity_id = p_legal_entity_id and r.is_active))
    into v_dq;
  select jsonb_build_object(
      'cases_open',          case when v_inv_access then (select count(*) from supplier_deviation_cases c where c.legal_entity_id = p_legal_entity_id and c.status = 'open') end,
      'agreements_expiring_90d', (select count(*) from raw_material_suppliers s join raw_materials r on r.id = s.raw_material_id
                                   where r.legal_entity_id = p_legal_entity_id and s.agreed_price_per_base_unit is not null
                                     and s.agreement_valid_to between current_date and current_date + 90),
      'agreements_expiring_30d', (select count(*) from raw_material_suppliers s join raw_materials r on r.id = s.raw_material_id
                                   where r.legal_entity_id = p_legal_entity_id and s.agreed_price_per_base_unit is not null
                                     and s.agreement_valid_to between current_date and current_date + 30),
      'stock_below_min',     (select count(*) from raw_material_stock_status s where s.legal_entity_id = p_legal_entity_id and s.min_stock is not null and s.current_stock < s.min_stock),
      'rematch_pending',     case when v_inv_access then (select count(*) from rm_rematch_queue q where q.legal_entity_id = p_legal_entity_id and q.status in ('queued','dispatched')) end)
    into v_other;
  return jsonb_build_object(
    'invoice_access', v_inv_access, 'supplier_items', v_items, 'invoices', v_inv, 'lines_to_review', v_lines,
    'approval', v_appr, 'data_quality', v_dq, 'other', v_other,
    'todo_total', case when not v_inv_access then null else
        coalesce((v_items->>'ukoblet')::int,0) + coalesce((v_items->>'mangler_pakning')::int,0)
      + coalesce((v_items->>'prisavvik')::int,0) + coalesce((v_items->>'kontroll')::int,0)
      + coalesce((v_inv->>'missing_lines')::int,0) + coalesce((v_inv->>'sum_mismatch')::int,0)
      + coalesce((v_inv->>'ready_to_reconcile')::int,0) + coalesce((v_inv->>'flagged')::int,0) end,
    'generated_at', now());
end;
$function$;