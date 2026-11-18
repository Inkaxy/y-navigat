CREATE OR REPLACE FUNCTION public.rm_extraction_examples_for(p_legal_entity_id uuid, p_supplier_id uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, supplier_sku_norm text, description_key text, original jsonb, corrected jsonb, note text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and not has_ravarer_invoice_access(p_legal_entity_id, 'read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select e.id, e.supplier_sku_norm, e.description_key, e.original, e.corrected, e.note, e.created_at
      from invoice_extraction_examples e
      join suppliers s on s.id = e.supplier_id and s.legal_entity_id = e.legal_entity_id
     where e.legal_entity_id = p_legal_entity_id and e.supplier_id = p_supplier_id and e.is_active
     order by e.created_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $function$
