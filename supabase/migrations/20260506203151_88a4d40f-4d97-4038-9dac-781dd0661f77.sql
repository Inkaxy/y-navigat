
-- =====================================================================
-- Milepæl A1: Månedlig kjøpsdata-visning + refresh
-- =====================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS public.raw_material_monthly_purchases AS
WITH lines_norm AS (
  SELECT
    il.raw_material_id,
    i.legal_entity_id,
    i.supplier_id,
    DATE_TRUNC('month', i.invoice_date)::date AS month_start,
    il.total_amount,
    CASE
      WHEN rm.base_unit = 'kg' AND LOWER(COALESCE(il.unit,'')) = 'g'  THEN il.quantity / 1000.0
      WHEN rm.base_unit = 'kg' AND LOWER(COALESCE(il.unit,'')) = 'kg' THEN il.quantity
      WHEN rm.base_unit = 'l'  AND LOWER(COALESCE(il.unit,'')) = 'ml' THEN il.quantity / 1000.0
      WHEN rm.base_unit = 'l'  AND LOWER(COALESCE(il.unit,'')) = 'l'  THEN il.quantity
      WHEN rm.base_unit = 'stk' AND LOWER(COALESCE(il.unit,'')) IN ('stk','pcs','pc','st') THEN il.quantity
      WHEN LOWER(COALESCE(il.unit,'')) IN ('sekk','kartong','pall','pose','boks','eske','krt','spann','pk')
        THEN il.quantity * COALESCE(rms.package_size, rm.package_size, 1)
      ELSE il.quantity
    END AS qty_base
  FROM public.invoice_lines il
  JOIN public.invoices i ON i.id = il.invoice_id
  LEFT JOIN public.raw_materials rm ON rm.id = il.raw_material_id
  LEFT JOIN public.raw_material_suppliers rms
    ON rms.raw_material_id = il.raw_material_id
   AND rms.supplier_id = i.supplier_id
  WHERE il.raw_material_id IS NOT NULL
    AND il.match_confidence IN ('auto_high','auto_low','manual')
    AND i.status = 'reconciled'
)
SELECT
  raw_material_id,
  legal_entity_id,
  COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid) AS supplier_id,
  month_start,
  SUM(qty_base) AS total_quantity,
  SUM(total_amount) AS total_cost,
  COUNT(*) AS invoice_count,
  CASE WHEN SUM(qty_base) > 0 THEN SUM(total_amount) / SUM(qty_base) END AS avg_price_per_base_unit
FROM lines_norm
GROUP BY raw_material_id, legal_entity_id, COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), month_start;

CREATE UNIQUE INDEX IF NOT EXISTS rm_monthly_purchases_pk
  ON public.raw_material_monthly_purchases (raw_material_id, legal_entity_id, supplier_id, month_start);
CREATE INDEX IF NOT EXISTS rm_monthly_purchases_le_month
  ON public.raw_material_monthly_purchases (legal_entity_id, month_start DESC);
CREATE INDEX IF NOT EXISTS rm_monthly_purchases_rm
  ON public.raw_material_monthly_purchases (raw_material_id, month_start DESC);

-- Inkluder i refresh-funksjonen
CREATE OR REPLACE FUNCTION public.refresh_purchase_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.raw_material_purchase_stats;
  EXCEPTION WHEN OTHERS THEN
    REFRESH MATERIALIZED VIEW public.raw_material_purchase_stats;
  END;
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.raw_material_supplier_purchase_stats;
  EXCEPTION WHEN OTHERS THEN
    REFRESH MATERIALIZED VIEW public.raw_material_supplier_purchase_stats;
  END;
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.raw_material_monthly_purchases;
  EXCEPTION WHEN OTHERS THEN
    REFRESH MATERIALIZED VIEW public.raw_material_monthly_purchases;
  END;
END;
$$;

-- Tilgangsfunksjon: returner månedlige rader for et scope (raw_material eller supplier eller legal_entity)
CREATE OR REPLACE FUNCTION public.list_monthly_purchases(
  p_legal_entity_id uuid,
  p_raw_material_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_month_from date DEFAULT NULL,
  p_month_to date DEFAULT NULL
)
RETURNS TABLE (
  raw_material_id uuid,
  supplier_id uuid,
  month_start date,
  total_quantity numeric,
  total_cost numeric,
  invoice_count bigint,
  avg_price_per_base_unit numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_ravarer_access(auth.uid(), p_legal_entity_id, 'read'::access_level) THEN
    RAISE EXCEPTION 'Ikke tilgang';
  END IF;
  RETURN QUERY
    SELECT m.raw_material_id, NULLIF(m.supplier_id,'00000000-0000-0000-0000-000000000000'::uuid),
           m.month_start, m.total_quantity, m.total_cost, m.invoice_count, m.avg_price_per_base_unit
    FROM public.raw_material_monthly_purchases m
    WHERE m.legal_entity_id = p_legal_entity_id
      AND (p_raw_material_id IS NULL OR m.raw_material_id = p_raw_material_id)
      AND (p_supplier_id IS NULL OR m.supplier_id = p_supplier_id)
      AND (p_month_from IS NULL OR m.month_start >= DATE_TRUNC('month', p_month_from)::date)
      AND (p_month_to IS NULL OR m.month_start <= DATE_TRUNC('month', p_month_to)::date);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_monthly_purchases(uuid, uuid, uuid, date, date) TO authenticated;

-- Førstegangsoppdatering
SELECT public.refresh_purchase_stats();
