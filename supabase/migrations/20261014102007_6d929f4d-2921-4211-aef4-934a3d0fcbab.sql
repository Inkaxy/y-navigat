CREATE OR REPLACE FUNCTION public.rm_supplier_item_lines(p_legal_entity_id uuid, p_supplier_id uuid, p_item_key text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when auth.uid() is not null and not public.has_ravarer_invoice_access(p_legal_entity_id, 'read') then null
         else coalesce(jsonb_agg(to_jsonb(x) order by x.invoice_date desc, x.created_at desc), '[]'::jsonb) end
    from (
      select il.id, il.invoice_id, i.invoice_number, i.invoice_date, i.status invoice_status, i.flagged_at, i.is_credit_note, i.reconciled_mode,
             il.line_number, il.supplier_sku, il.description, il.quantity, il.unit, il.unit_price, il.total_amount,
             il.package_size, il.package_unit, il.count_per_package, il.base_quantity, il.price_per_base_unit,
             il.expected_price_per_base_unit, il.price_variance_pct, il.variance_status, il.price_reference_source,
             il.raw_material_id, rm.name raw_material_name, il.match_confidence, il.requires_review, il.review_reason,
             il.resolution_note, il.created_at, il.line_kind,
             exists (select 1 from public.invoice_line_cost_postings p where p.invoice_line_id = il.id and p.revoked_at is null) cost_posted,
             exists (select 1 from public.raw_material_price_history h where h.invoice_line_id = il.id and h.superseded_at is null) in_price_history,
             il.discount_amount, il.unit_price_basis, il.extraction_issues, to_jsonb(il.updated_at)#>>'{}' line_updated_at,
             rm.item_type rm_item_type, rm.base_unit rm_base_unit, i.source invoice_source, i.lines_source invoice_lines_source,
             exists (select 1 from public.invoice_internal_approvals a where a.invoice_id = i.id and a.status = 'approved' and a.revoked_at is null) invoice_approved
        from public.invoice_lines il
        join public.invoices i on i.id = il.invoice_id
        left join public.raw_materials rm on rm.id = il.raw_material_id
       where i.legal_entity_id = p_legal_entity_id and i.supplier_id = p_supplier_id
         and (case when public.rm_sku_norm(il.supplier_sku) <> '' then 'sku:' || public.rm_sku_norm(il.supplier_sku)
                   else 'name:' || public.rm_match_key(il.description) end) = p_item_key
       order by i.invoice_date desc, il.created_at desc
       limit greatest(1, least(500, p_limit))
    ) x;
$function$;