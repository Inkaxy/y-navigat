CREATE OR REPLACE FUNCTION public._rm_cost_candidates(p_raw_material_id uuid, p_as_of date)
 RETURNS TABLE(history_id uuid, price numeric, effective_date date, created_at timestamp with time zone, source text, supplier_id uuid, invoice_id uuid, invoice_line_id uuid, invoice_number text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select h.id, h.price, h.effective_date, h.created_at, h.source, h.supplier_id, h.invoice_id, h.invoice_line_id, i.invoice_number::text
    from raw_material_price_history h
    join raw_materials rm on rm.id = h.raw_material_id
    left join invoices i on i.id = h.invoice_id
    left join invoice_lines il on il.id = h.invoice_line_id
    left join suppliers s on s.id = h.supplier_id
   where h.raw_material_id = p_raw_material_id
     and h.effective_date is not null and h.effective_date <= p_as_of
     and not exists(select 1 from raw_material_price_review_holds q where q.history_id=h.id and q.released_at is null)
     and (h.source <> 'invoice' or rm_price_line_validation_reason(h.invoice_line_id) is null)
     and (rm_unit_change_at(rm.id) is null or (h.created_at>=rm_unit_change_at(rm.id)
       and h.effective_date >= (rm_unit_change_at(rm.id) at time zone 'Europe/Oslo')::date))
     and not coalesce(h.is_credit, false) and not coalesce(h.is_legacy, false) and h.superseded_at is null
     and upper(coalesce(h.currency, 'NOK')) = 'NOK'
     and public.rm_is_finite(h.price) and h.price > 0
     and (h.supplier_id is null or s.legal_entity_id = rm.legal_entity_id)
     -- Enhetsbytte (råvare): observasjoner datert eller registrert før byttet teller ikke.
     and not exists (select 1 from audit_log a
                      where a.entity_type = 'raw_material' and a.entity_id = rm.id and a.action = 'raw_material.base_unit_changed'
                        and (h.created_at < a.occurred_at or h.effective_date < (a.occurred_at at time zone 'Europe/Oslo')::date))
     -- Enhetsbytte på leverandørkoblingen.
     and not exists (select 1 from raw_material_suppliers rms
                      where rms.raw_material_id = rm.id and rms.supplier_id = h.supplier_id and rms.start_price_unit_change_at is not null
                        and (h.created_at < rms.start_price_unit_change_at
                             or h.effective_date < (rms.start_price_unit_change_at at time zone 'Europe/Oslo')::date))
     and (
       (h.source = 'invoice' and il.id is not null and i.id is not null
         and il.invoice_id = i.id and il.raw_material_id = h.raw_material_id
         and i.legal_entity_id = rm.legal_entity_id
         and h.supplier_id is not distinct from i.supplier_id
         and not coalesce(i.is_credit_note, false) and i.flagged_at is null
         and upper(coalesce(i.currency, 'NOK')) = 'NOK'
         and coalesce(i.status, '') <> 'cancelled'
         -- Observasjonen må stemme med linjen slik den står nå.
         and public.rm_is_finite(il.total_amount) and il.total_amount > 0
         and public.rm_is_finite(il.base_quantity) and il.base_quantity > 0
         and abs(h.price * il.base_quantity - il.total_amount) <= greatest(0.05, 0.01 * il.total_amount)
         and (
           exists (select 1 from invoice_line_cost_postings pp where pp.invoice_line_id = il.id and pp.revoked_at is null)
           or (coalesce(il.match_confidence::text, '') in ('manual','auto_high')
               and not coalesce(il.requires_review, false)
               and coalesce(btrim(il.review_reason), '') = ''
               and (i.status in ('ready','reconciled') or public.rm_invoice_lines_trusted(i))
               and (i.status = 'reconciled' or coalesce(i.lines_sum_status, '') <> 'mismatch')
               and not public.rm_invoice_has_read_issues(i.id))))
       or (h.source in ('manual','agreement','price_list') and h.invoice_line_id is null and h.cost_eligible)
     )
   order by h.effective_date desc, h.price desc, h.created_at desc, h.id desc
$function$
