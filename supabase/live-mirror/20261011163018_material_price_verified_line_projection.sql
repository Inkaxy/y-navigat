-- Read-only companion to immutable raw_material_price_history. No backfill.
CREATE OR REPLACE FUNCTION public.rm_material_price_projection(p_raw_material_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public
AS $function$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING errcode='28000'; END IF;
 IF public.rm_can_read(p_raw_material_id) IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'forbidden' USING errcode='42501'; END IF;
 WITH candidates AS MATERIALIZED (
   SELECT * FROM public._rm_cost_candidates(p_raw_material_id,(now() AT TIME ZONE 'Europe/Oslo')::date)
 ), proof AS MATERIALIZED (
   SELECT c.*,h.snapshot_unit,h.snapshot_source,h.snapshot_currency,h.currency,
     rm.base_unit,l.unit line_unit,l.quantity,l.base_quantity,l.total_amount,
     l.package_size,l.package_unit,l.count_per_package,l.updated_at line_version,
     public.rm_unit_factor(l.unit,rm.base_unit) direct_factor,
     l.package_size*public.rm_unit_factor(l.package_unit,rm.base_unit)*coalesce(nullif(l.count_per_package,0),1) package_factor,
     (h.snapshot_source IN ('ved_registrering','revidert_enhetsbytte')
       AND nullif(btrim(h.snapshot_unit),'') IS NOT NULL
       AND upper(coalesce(h.snapshot_currency,h.currency,''))='NOK') IS TRUE has_recorded_snapshot
   FROM candidates c JOIN raw_material_price_history h ON h.id=c.history_id
   JOIN invoice_lines l ON l.id=c.invoice_line_id
   JOIN invoices i ON i.id=c.invoice_id
   JOIN raw_materials rm ON rm.id=p_raw_material_id
   WHERE c.source='invoice'
     AND rm.base_unit IN ('kg','g','l','ml','stk')
     -- An old posting does not certify a current match, currency or lifecycle.
     -- These explicit checks close the posting alternative in the shared selector.
     AND l.match_confidence::text IN ('manual','auto_high')
     AND i.status IN ('imported','needs_review','ready','reconciled')
     AND (i.status IN ('ready','reconciled') OR public.rm_invoice_lines_trusted(i))
     AND coalesce(i.extraction_confidence,1)>=0.6
     AND upper(i.currency)='NOK' AND upper(h.currency)='NOK'
     AND i.invoice_date=c.effective_date
     -- The shared selector includes lifecycle, review holds, source identity,
     -- package confirmation, dimensions, invoice checks and unit-change cutoffs.
     -- Also reject read warnings on posted lines and require tight line arithmetic.
     AND NOT public.rm_invoice_has_read_issues(c.invoice_id)
     AND abs(c.price*l.base_quantity-l.total_amount)<=greatest(0.05,0.000001*abs(l.total_amount))
 ), dimension_proven AS MATERIALIZED (
   SELECT * FROM proof WHERE
     (direct_factor IS NOT NULL AND direct_factor>0
       AND abs(quantity*direct_factor-base_quantity)<=greatest(0.000001,0.000001*abs(base_quantity)))
     OR (direct_factor IS NULL AND public.rm_is_finite(package_factor) AND package_factor>0
       AND abs(quantity*package_factor-base_quantity)<=greatest(0.000001,0.000001*abs(base_quantity)))
 ), ranked AS (
   SELECT *,row_number() OVER (
     PARTITION BY source,invoice_id,invoice_line_id,effective_date
     ORDER BY has_recorded_snapshot DESC,created_at DESC,history_id DESC) rn
   FROM dimension_proven
 )
 SELECT jsonb_build_object(
   'raw_material_id',p_raw_material_id,'checked_at',now(),
   'eligible_history_ids',coalesce((SELECT jsonb_agg(history_id ORDER BY effective_date DESC,created_at DESC,history_id DESC) FROM candidates),'[]'::jsonb),
   'held_history_ids',coalesce((SELECT jsonb_agg(h.id ORDER BY h.id)
     FROM raw_material_price_history h JOIN raw_material_price_review_holds q ON q.history_id=h.id
     WHERE h.raw_material_id=p_raw_material_id AND q.released_at IS NULL),'[]'::jsonb),
   'projections',coalesce((SELECT jsonb_agg(jsonb_build_object(
     'history_id',history_id,'source','invoice','provenance','currently_verified_line',
     'price',price,'effective_date',effective_date,'created_at',created_at,
     'supplier_id',supplier_id,'invoice_id',invoice_id,'invoice_line_id',invoice_line_id,
     'invoice_number',invoice_number,'unit',base_unit,'currency','NOK',
     'line_version',line_version,'line_unit',line_unit,'quantity',quantity,
     'base_quantity',base_quantity,'total_amount',total_amount,
     'package_size',package_size,'package_unit',package_unit,'count_per_package',count_per_package,
     'base_units_per_package',CASE WHEN direct_factor IS NULL THEN package_factor ELSE NULL END
   ) ORDER BY effective_date DESC,created_at DESC,history_id DESC)
     FROM ranked WHERE rn=1 AND NOT has_recorded_snapshot),'[]'::jsonb),
   'duplicate_history_ids',coalesce((SELECT jsonb_agg(history_id ORDER BY history_id) FROM ranked WHERE rn>1),'[]'::jsonb)
 ) INTO result;
 RETURN result;
END $function$;
REVOKE ALL ON FUNCTION public.rm_material_price_projection(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rm_material_price_projection(uuid) TO authenticated;
