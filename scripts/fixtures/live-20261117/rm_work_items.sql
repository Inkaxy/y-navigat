CREATE OR REPLACE FUNCTION public.rm_work_items(p_legal_entity_id uuid, p_group text DEFAULT 'alle'::text, p_search text DEFAULT NULL::text, p_supplier_id uuid DEFAULT NULL::uuid, p_sort text DEFAULT 'impact'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_total int; v_items jsonb; v_counts jsonb;
begin
  if auth.uid() is not null and not public.has_ravarer_invoice_access(p_legal_entity_id, 'read') then
    raise exception 'Ingen fakturatilgang for dette selskapet' using errcode = '42501';
  end if;
  if coalesce(p_group,'alle') not in ('alle','kobling','pakning','pris','kontroll','fakturaer') then
    raise exception 'Ukjent gruppe: %', p_group using errcode = '22023';
  end if;

  with invoice_checks as materialized (
    select i.*,public.rm_invoice_has_read_issues(i.id) invoice_read_issue from invoices i
    where i.excluded_at is null and i.status is distinct from 'excluded' and i.legal_entity_id=p_legal_entity_id and (p_supplier_id is null or i.supplier_id=p_supplier_id)
  ), base_lines as materialized (
    select il.id, il.invoice_id, i.supplier_id, i.invoice_date, il.created_at,
           il.supplier_sku, il.description, il.raw_material_id, il.match_confidence,
           il.requires_review, il.review_reason, il.total_amount, il.base_quantity,
           il.price_per_base_unit, il.expected_price_per_base_unit,
           public._rm_queue_line_read_issue(il.id,i.invoice_read_issue) read_issue,
           case when public.rm_sku_norm(il.supplier_sku) <> '' then 'sku:' || public.rm_sku_norm(il.supplier_sku)
                else 'name:' || public.rm_match_key(il.description) end item_key,
           (i.status in ('imported','needs_review','ready') and i.flagged_at is null) is_open
      from invoice_lines il join invoice_checks i on i.id = il.invoice_id
     where il.excluded_at is null and i.legal_entity_id = p_legal_entity_id
       and (p_supplier_id is null or i.supplier_id = p_supplier_id)
  ), lines as materialized (
     select b.*,case when b.requires_review and b.is_open and b.read_issue is null
       then public._rm_queue_line_effect(b.id,true) end verified_effect from base_lines b
  ), agg as (
    select supplier_id, item_key,
           count(distinct invoice_id) invoice_count, max(invoice_date) last_seen, min(invoice_date) filter (where requires_review and is_open) oldest_open,
           count(*) filter (where requires_review and is_open) open_lines,
           count(distinct invoice_id) filter (where requires_review and is_open) open_invoices,
           (array_agg(id order by invoice_date desc, created_at desc, id desc))[1] last_line_id,
           (array_agg(id order by invoice_date desc, created_at desc, id desc) filter (where requires_review and is_open))[1] last_open_line_id,
           (array_agg(raw_material_id order by invoice_date desc, created_at desc, id desc)
              filter (where raw_material_id is not null and match_confidence in ('manual','auto_high','auto_medium')))[1] linked_rm_id,
           (array_agg(match_confidence order by invoice_date desc, created_at desc, id desc))[1] last_conf,
           string_agg(distinct review_reason, ',') filter (where requires_review and is_open) reasons_raw,
           coalesce(sum(abs(total_amount)) filter (where requires_review and is_open), 0) open_amount,
           sum(verified_effect) filter(where requires_review and is_open) variance_nok,
           count(*) filter(where requires_review and is_open and verified_effect is null) unknown_effect_lines,
           count(*) filter(where requires_review and is_open and read_issue is not null) read_issue_lines,
           array_remove(array_agg(distinct read_issue) filter(where requires_review and is_open),null) read_integrity_flags,
           max(supplier_sku) filter (where supplier_sku is not null and btrim(supplier_sku) <> '') supplier_sku
      from lines group by 1, 2
  ), cards as (
    select a.*, ll.description, s.name supplier_name, rm.name rm_name,
           case
             when a.last_conf = 'not_applicable' then 'ikke_vare'
             when a.linked_rm_id is null then 'ukoblet'
             when a.open_lines > 0 and coalesce(a.reasons_raw,'') ~ '(unknown_package_size|package_conflict|missing_base_unit|uncertain_cost)' then 'mangler_pakning'
             when a.open_lines > 0 and coalesce(a.reasons_raw,'') ~ '(price_variance|price_increase|price_drop|no_automatic_basis|agreement_conflict|start_price)' then 'prisavvik'
             when a.open_lines > 0 then 'kontroll'
             else 'koblet' end status
      from agg a join lines ll on ll.id = a.last_line_id
      left join suppliers s on s.id = a.supplier_id
      left join raw_materials rm on rm.id = a.linked_rm_id
  ), card_items as (
    select
      'varekort:' || c.supplier_id || ':' || c.item_key as key,
      case c.status when 'ukoblet' then 'kobling' when 'mangler_pakning' then 'pakning' when 'prisavvik' then 'pris' else 'kontroll' end as grp,
      'varekort'::text as type, c.status as kind,
      c.supplier_id, c.supplier_name, c.item_key, null::uuid as invoice_id, null::text as invoice_number,
      c.description as title, c.supplier_sku as sku, c.linked_rm_id as rm_id, c.rm_name,
      c.open_lines, c.open_invoices, c.invoice_count, c.open_amount as amount,
      case when c.status='prisavvik' and c.unknown_effect_lines=0 then round(c.variance_nok,2) else null::numeric end as impact_nok,
      case when c.status='prisavvik' and c.unknown_effect_lines=0 then 'verified_price_effect' else 'unknown' end::text as effect_status,
      case when c.status='prisavvik' and c.unknown_effect_lines=0 then 'Beregnet prisavvik' else 'Kan ikke beregnes ennå' end::text as effect_label,
      case when c.open_lines=0 then 'unknown' when c.read_issue_lines>0 then 'needs_review' else 'checked' end::text as read_integrity,
      coalesce(c.read_integrity_flags,'{}'::text[]) as read_integrity_flags,
      c.unknown_effect_lines, 'parsed_line_amount'::text as amount_kind,
      case when 'credit_note'=any(c.read_integrity_flags) then 'review_credit_note' when 'non_nok_currency'=any(c.read_integrity_flags) then 'review_currency' when 'price_observation_held'=any(c.read_integrity_flags) then 'confirm_price_basis' when c.read_integrity_flags && array['invoice_sum_not_verified','invoice_read_unverified','line_arithmetic_unverified','invalid_quantity'] then 'review_reading' when c.read_issue_lines>0 then 'complete_link_or_package' when c.status='prisavvik' and c.unknown_effect_lines>0 then 'confirm_price_basis' when c.status='prisavvik' then 'review_price' else 'complete_link_or_package' end::text as action_required,
      c.last_seen as last_date, c.oldest_open as first_open_date, c.last_open_line_id,
      coalesce(array_remove(string_to_array(c.reasons_raw, ','), ''), '{}') as reasons
      from cards c
     where c.status in ('ukoblet','mangler_pakning','prisavvik','kontroll')
  ), inv as (
    select i.*, s.name supplier_name,
           not exists (select 1 from invoice_lines l where l.invoice_id = i.id) no_lines,
           (select count(*) from invoice_lines l where l.invoice_id = i.id and l.requires_review) open_lines
      from invoice_checks i left join suppliers s on s.id = i.supplier_id
     where i.legal_entity_id = p_legal_entity_id and coalesce(i.status,'') <> 'cancelled'
       and (p_supplier_id is null or i.supplier_id = p_supplier_id)
  ), inv_items as (
    select
      'faktura:' || x.id as key, 'fakturaer'::text as grp, 'faktura'::text as type, x.kind,
      x.supplier_id, x.supplier_name, null::text as item_key, x.id as invoice_id, x.invoice_number,
      coalesce(x.supplier_name, 'Ukjent leverandør') || ' · ' || coalesce(x.invoice_number, 'uten nummer') as title,
      null::text as sku, null::uuid as rm_id, null::text as rm_name,
      x.open_lines::bigint as open_lines, 1::bigint as open_invoices, 1::bigint as invoice_count,
      abs(coalesce(x.total_amount, 0)) as amount,
      null::numeric as impact_nok, 'not_price_effect'::text as effect_status,
      'Fakturabeløp – ikke prisavvik'::text as effect_label,
      case when x.is_credit_note or upper(coalesce(x.currency,''))<>'NOK' or x.no_lines or x.flagged_at is not null or coalesce(x.lines_sum_status,'')<>'ok'
        or x.invoice_read_issue then 'needs_review' else 'checked' end::text as read_integrity,
      array_remove(array[
         case when x.is_credit_note then 'credit_note' end,
         case when upper(coalesce(x.currency,''))<>'NOK' then 'non_nok_currency' end,
         case when x.no_lines then 'missing_lines' end,
         case when coalesce(x.lines_sum_status,'')<>'ok' then 'invoice_sum_unverified' end,
         case when x.flagged_at is not null then 'invoice_flagged' end,
         case when x.invoice_read_issue then 'invoice_read_issue' end],null) as read_integrity_flags,
      x.open_lines::bigint as unknown_effect_lines, 'parsed_invoice_total'::text as amount_kind,
      case when x.is_credit_note then 'review_credit_note' when upper(coalesce(x.currency,''))<>'NOK' then 'review_currency' else 'review_invoice' end::text as action_required,
      x.invoice_date as last_date, x.invoice_date as first_open_date, null::uuid as last_open_line_id,
      case when x.kind = 'faktura_flagget' and x.flag_reason is not null then array[x.flag_reason] else '{}'::text[] end as reasons
      from (
        select inv.*,
          case
            when inv.flagged_at is not null and coalesce(inv.status,'') <> 'reconciled' then 'faktura_flagget'
            when inv.status in ('imported','needs_review','ready') and inv.flagged_at is null and inv.no_lines then 'faktura_mangler_linjer'
            when inv.status in ('imported','needs_review','ready') and inv.flagged_at is null and inv.lines_sum_status = 'mismatch' then 'faktura_sumavvik'
            when inv.status = 'ready' and inv.flagged_at is null then 'faktura_klar'
          end kind
          from inv) x
     where x.kind is not null
  ), all_items as (
    select * from card_items union all select * from inv_items
  ), searched as (
    select * from all_items a
     where p_search is null or btrim(p_search) = ''
        or a.title ilike '%' || p_search || '%'
        or coalesce(a.sku,'') ilike '%' || p_search || '%'
        or coalesce(a.rm_name,'') ilike '%' || p_search || '%'
        or coalesce(a.supplier_name,'') ilike '%' || p_search || '%'
        or coalesce(a.invoice_number,'') ilike '%' || p_search || '%'
  ), filtered as (
    select s.*, row_number() over (order by
             case when coalesce(p_sort,'impact') = 'impact' then s.impact_nok end desc nulls last,
             case when p_sort = 'frequency' then s.open_lines end desc nulls last,
             case when p_sort = 'frequency' then s.invoice_count end desc nulls last,
             case when p_sort = 'oldest' then s.first_open_date end asc nulls last,
             s.last_date desc nulls last, s.key) rn
      from searched s where coalesce(p_group,'alle') = 'alle' or s.grp = p_group
  )
  select (select count(*) from filtered),
         (select coalesce(jsonb_agg(to_jsonb(f) - 'rn' order by f.rn), '[]'::jsonb) from filtered f
           where f.rn > greatest(p_offset,0) and f.rn <= greatest(p_offset,0) + least(greatest(p_limit,1),500)),
         (select jsonb_build_object(
                   'alle', count(*),
                   'kobling', count(*) filter (where grp='kobling'),
                   'pakning', count(*) filter (where grp='pakning'),
                   'pris', count(*) filter (where grp='pris'),
                   'kontroll', count(*) filter (where grp='kontroll'),
                   'fakturaer', count(*) filter (where grp='fakturaer'),
                   'faktura_mangler_linjer', count(*) filter (where kind='faktura_mangler_linjer'),
                   'faktura_sumavvik', count(*) filter (where kind='faktura_sumavvik'),
                   'faktura_flagget', count(*) filter (where kind='faktura_flagget'),
                   'faktura_klar', count(*) filter (where kind='faktura_klar'))
            from searched)
    into v_total, v_items, v_counts;

  return jsonb_build_object('total', v_total, 'items', v_items, 'counts', v_counts, 'generated_at', now());
end;
$function$
