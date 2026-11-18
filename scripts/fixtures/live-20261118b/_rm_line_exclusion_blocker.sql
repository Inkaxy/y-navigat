CREATE OR REPLACE FUNCTION public._rm_line_exclusion_blocker(p_line_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
