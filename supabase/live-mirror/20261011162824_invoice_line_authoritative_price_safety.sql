-- Read-only authoritative comparison status for every current line on one invoice.
CREATE OR REPLACE FUNCTION public.rm_invoice_line_price_safety(p_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public
AS $function$
DECLARE inv invoices%rowtype; invoice_read_issue boolean; result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING errcode='28000'; END IF;
 SELECT * INTO inv FROM invoices WHERE id=p_invoice_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'finnes_ikke' USING errcode='P0002'; END IF;
 IF public.has_ravarer_invoice_access(inv.legal_entity_id,'read') IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'forbidden' USING errcode='42501'; END IF;
 invoice_read_issue:=public.rm_invoice_has_read_issues(inv.id);
 WITH reads AS MATERIALIZED (
   SELECT l.id,l.updated_at,l.raw_material_id,l.price_reference_source,l.price_reference_id,
     l.expected_price_per_base_unit,l.price_per_base_unit,l.base_quantity,
     CASE WHEN inv.status IS NULL OR inv.status NOT IN ('imported','needs_review','ready','reconciled','cancelled')
       THEN 'invoice_status_unverified'
       ELSE public._rm_queue_line_read_issue(l.id,invoice_read_issue) END read_reason
   FROM invoice_lines l WHERE l.invoice_id=inv.id
 ), effects AS MATERIALIZED (
   SELECT r.*,CASE WHEN read_reason IS NULL THEN public._rm_queue_line_effect(id,true) END effect
   FROM reads r
 ), statuses AS (
   SELECT *,read_reason IS NULL AND public.rm_is_finite(effect) AND effect>=0 verified FROM effects
 )
 SELECT jsonb_build_object('invoice_id',inv.id,'checked_at',now(),'lines',
   coalesce(jsonb_agg(jsonb_build_object(
     'line_id',id,'line_version',updated_at,'can_compare',verified,
     'effect_nok',CASE WHEN verified THEN effect ELSE NULL END,
     'reason_code',CASE WHEN verified THEN NULL ELSE coalesce(read_reason,'price_reference_unverified') END,
     'raw_material_id',raw_material_id,
     'reference_source',CASE WHEN verified THEN price_reference_source ELSE NULL END,
     'reference_id',CASE WHEN verified THEN price_reference_id ELSE NULL END,
     'expected_price_per_base_unit',CASE WHEN verified THEN expected_price_per_base_unit ELSE NULL END,
     'price_per_base_unit',CASE WHEN verified THEN price_per_base_unit ELSE NULL END,
     'base_quantity',CASE WHEN verified THEN base_quantity ELSE NULL END
   ) ORDER BY id),'[]'::jsonb)) INTO result FROM statuses;
 RETURN result;
END $function$;
REVOKE ALL ON FUNCTION public.rm_invoice_line_price_safety(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rm_invoice_line_price_safety(uuid) TO authenticated;