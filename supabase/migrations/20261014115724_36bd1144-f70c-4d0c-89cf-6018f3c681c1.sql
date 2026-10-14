CREATE OR REPLACE FUNCTION public.rm_work_item_plan_lines(p_legal_entity_id uuid, p_keys jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with k as (
    select distinct (e->>'supplier_id')::uuid supplier_id, e->>'item_key' item_key
      from jsonb_array_elements(case when jsonb_typeof(p_keys) = 'array' then p_keys else '[]'::jsonb end) with ordinality t(e, n)
     where n <= 60 and e->>'supplier_id' ~* '^[0-9a-f-]{36}$' and coalesce(e->>'item_key','') <> ''
  ),
  l as (
    select k.supplier_id, k.item_key, il.*, i.invoice_number, i.invoice_date, i.status invoice_status, i.flagged_at, i.is_credit_note, i.reconciled_mode,
           rm.name raw_material_name, rm.item_type rm_item_type, rm.base_unit rm_base_unit, i.source invoice_source, i.lines_source invoice_lines_source,
           row_number() over (partition by k.supplier_id, k.item_key order by i.invoice_date asc nulls last, il.line_number asc nulls last, il.id) rn,
           count(*) over (partition by k.supplier_id, k.item_key) open_count
      from k
      join public.invoices i on i.legal_entity_id = p_legal_entity_id and i.supplier_id = k.supplier_id
      join public.invoice_lines il on il.invoice_id = i.id
      left join public.raw_materials rm on rm.id = il.raw_material_id
     where il.requires_review is true
       and i.status <> 'excluded' and coalesce(il.match_confidence,'') <> 'not_applicable'
       and (case when public.rm_sku_norm(il.supplier_sku) <> '' then 'sku:' || public.rm_sku_norm(il.supplier_sku)
                 else 'name:' || public.rm_match_key(il.description) end) = k.item_key
  )
  select case when auth.uid() is null or not public.has_ravarer_invoice_access(p_legal_entity_id, 'read') then null
    else coalesce((
      select jsonb_object_agg(g.key, g.val) from (
        select k.supplier_id::text || '|' || k.item_key key,
               jsonb_build_object(
                 'open_lines', coalesce((select max(open_count) from l where l.supplier_id = k.supplier_id and l.item_key = k.item_key), 0),
                 'lines', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', l.id, 'invoice_id', l.invoice_id, 'invoice_number', l.invoice_number, 'invoice_date', l.invoice_date,
                    'invoice_status', l.invoice_status, 'flagged_at', l.flagged_at, 'is_credit_note', l.is_credit_note, 'reconciled_mode', l.reconciled_mode,
                    'line_number', l.line_number, 'supplier_sku', l.supplier_sku, 'description', l.description, 'quantity', l.quantity, 'unit', l.unit,
                    'unit_price', l.unit_price, 'total_amount', l.total_amount, 'package_size', l.package_size, 'package_unit', l.package_unit,
                    'count_per_package', l.count_per_package, 'base_quantity', l.base_quantity, 'price_per_base_unit', l.price_per_base_unit,
                    'expected_price_per_base_unit', l.expected_price_per_base_unit, 'price_variance_pct', l.price_variance_pct, 'variance_status', l.variance_status,
                    'price_reference_source', l.price_reference_source, 'raw_material_id', l.raw_material_id, 'raw_material_name', l.raw_material_name,
                    'match_confidence', l.match_confidence, 'requires_review', l.requires_review, 'review_reason', l.review_reason,
                    'resolution_note', l.resolution_note, 'created_at', l.created_at, 'line_kind', l.line_kind,
                    'cost_posted', exists (select 1 from public.invoice_line_cost_postings p where p.invoice_line_id = l.id and p.revoked_at is null),
                    'in_price_history', exists (select 1 from public.raw_material_price_history h where h.invoice_line_id = l.id and h.superseded_at is null),
                    'discount_amount', l.discount_amount, 'unit_price_basis', l.unit_price_basis, 'extraction_issues', l.extraction_issues,
                    'line_updated_at', to_jsonb(l.updated_at)#>>'{}', 'rm_item_type', l.rm_item_type, 'rm_base_unit', l.rm_base_unit,
                    'invoice_source', l.invoice_source, 'invoice_lines_source', l.invoice_lines_source,
                    'invoice_approved', exists (select 1 from public.invoice_internal_approvals a where a.invoice_id = l.invoice_id and a.status = 'approved' and a.revoked_at is null)
                  ) order by l.rn) from l where l.supplier_id = k.supplier_id and l.item_key = k.item_key and l.rn <= 3), '[]'::jsonb)
               ) val
          from k
      ) g), '{}'::jsonb) end;
$function$;
REVOKE ALL ON FUNCTION public.rm_work_item_plan_lines(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rm_work_item_plan_lines(uuid, jsonb) TO authenticated;