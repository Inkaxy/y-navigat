
-- =====================================================================
-- Materialisert visning: innkjøpsstatistikk pr råvare
-- =====================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS public.raw_material_purchase_stats AS
WITH lines_norm AS (
  SELECT
    il.raw_material_id,
    i.legal_entity_id,
    i.supplier_id,
    i.invoice_date,
    il.quantity,
    LOWER(COALESCE(il.unit, '')) AS unit_lc,
    il.total_amount,
    rm.base_unit,
    rms.package_size AS rms_pkg_size,
    rm.package_size  AS rm_pkg_size,
    CASE
      WHEN rm.base_unit = 'kg' AND LOWER(COALESCE(il.unit,'')) = 'g'  THEN il.quantity / 1000.0
      WHEN rm.base_unit = 'kg' AND LOWER(COALESCE(il.unit,'')) = 'kg' THEN il.quantity
      WHEN rm.base_unit = 'l'  AND LOWER(COALESCE(il.unit,'')) = 'ml' THEN il.quantity / 1000.0
      WHEN rm.base_unit = 'l'  AND LOWER(COALESCE(il.unit,'')) = 'l'  THEN il.quantity
      WHEN rm.base_unit = 'stk' AND LOWER(COALESCE(il.unit,'')) IN ('stk','pcs','pc','st') THEN il.quantity
      WHEN LOWER(COALESCE(il.unit,'')) IN ('sekk','kartong','pall','pose','boks','eske','krt','spann','pk')
        THEN il.quantity * COALESCE(rms.package_size, rm.package_size, 1)
      ELSE il.quantity
    END AS qty_base,
    CASE
      WHEN LOWER(COALESCE(il.unit,'')) IN ('sekk','kartong','pall','pose','boks','eske','krt','spann','pk')
           AND COALESCE(rms.package_size, rm.package_size) IS NULL
      THEN TRUE ELSE FALSE
    END AS package_size_missing
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

  SUM(CASE WHEN invoice_date > current_date - interval '30 days' THEN qty_base ELSE 0 END)        AS quantity_30d,
  SUM(CASE WHEN invoice_date > current_date - interval '30 days' THEN total_amount ELSE 0 END)    AS cost_30d,
  COUNT(CASE WHEN invoice_date > current_date - interval '30 days' THEN 1 END)                    AS invoice_count_30d,

  SUM(CASE WHEN invoice_date > current_date - interval '90 days' THEN qty_base ELSE 0 END)        AS quantity_90d,
  SUM(CASE WHEN invoice_date > current_date - interval '90 days' THEN total_amount ELSE 0 END)    AS cost_90d,
  COUNT(CASE WHEN invoice_date > current_date - interval '90 days' THEN 1 END)                    AS invoice_count_90d,

  SUM(CASE WHEN invoice_date > current_date - interval '12 months' THEN qty_base ELSE 0 END)      AS quantity_12m,
  SUM(CASE WHEN invoice_date > current_date - interval '12 months' THEN total_amount ELSE 0 END)  AS cost_12m,
  COUNT(CASE WHEN invoice_date > current_date - interval '12 months' THEN 1 END)                  AS invoice_count_12m,

  SUM(CASE WHEN invoice_date > current_date - interval '24 months' THEN qty_base ELSE 0 END)      AS quantity_24m,
  SUM(CASE WHEN invoice_date > current_date - interval '24 months' THEN total_amount ELSE 0 END)  AS cost_24m,

  CASE WHEN SUM(CASE WHEN invoice_date > current_date - interval '12 months' THEN qty_base ELSE 0 END) > 0
       THEN SUM(CASE WHEN invoice_date > current_date - interval '12 months' THEN total_amount ELSE 0 END)
          / SUM(CASE WHEN invoice_date > current_date - interval '12 months' THEN qty_base ELSE 0 END)
  END AS avg_price_per_base_unit_12m,

  CASE WHEN COUNT(CASE WHEN invoice_date > current_date - interval '12 months' THEN 1 END) > 0
       THEN SUM(CASE WHEN invoice_date > current_date - interval '12 months' THEN qty_base ELSE 0 END) / 12.0
  END AS avg_monthly_volume,

  MAX(invoice_date) AS last_invoice_date,
  COUNT(DISTINCT CASE WHEN invoice_date > current_date - interval '12 months' THEN supplier_id END) AS supplier_count_12m,
  BOOL_OR(package_size_missing) AS has_package_size_warning
FROM lines_norm
GROUP BY raw_material_id, legal_entity_id;

CREATE UNIQUE INDEX IF NOT EXISTS rm_purchase_stats_pk
  ON public.raw_material_purchase_stats (raw_material_id, legal_entity_id);
CREATE INDEX IF NOT EXISTS rm_purchase_stats_le
  ON public.raw_material_purchase_stats (legal_entity_id);

-- =====================================================================
-- Materialisert visning: innkjøp pr (råvare, leverandør)
-- =====================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS public.raw_material_supplier_purchase_stats AS
WITH lines_norm AS (
  SELECT
    il.raw_material_id,
    i.legal_entity_id,
    i.supplier_id,
    i.invoice_date,
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
    AND i.supplier_id IS NOT NULL
)
SELECT
  raw_material_id,
  supplier_id,
  legal_entity_id,
  SUM(CASE WHEN invoice_date > current_date - interval '12 months' THEN qty_base ELSE 0 END)     AS quantity_12m,
  SUM(CASE WHEN invoice_date > current_date - interval '12 months' THEN total_amount ELSE 0 END) AS cost_12m,
  COUNT(CASE WHEN invoice_date > current_date - interval '12 months' THEN 1 END)                 AS invoice_count_12m,
  SUM(CASE WHEN invoice_date > current_date - interval '24 months' THEN qty_base ELSE 0 END)     AS quantity_24m,
  SUM(CASE WHEN invoice_date > current_date - interval '24 months' THEN total_amount ELSE 0 END) AS cost_24m,
  MAX(invoice_date) AS last_invoice_date
FROM lines_norm
GROUP BY raw_material_id, supplier_id, legal_entity_id;

CREATE UNIQUE INDEX IF NOT EXISTS rm_supplier_purchase_stats_pk
  ON public.raw_material_supplier_purchase_stats (raw_material_id, supplier_id, legal_entity_id);
CREATE INDEX IF NOT EXISTS rm_supplier_purchase_stats_supplier
  ON public.raw_material_supplier_purchase_stats (supplier_id, legal_entity_id);

-- =====================================================================
-- Refresh-funksjon — kalt fra cron og fra reconcile-invoice
-- =====================================================================
CREATE OR REPLACE FUNCTION public.refresh_purchase_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- CONCURRENTLY krever unique index (vi har det). Faller tilbake hvis første refresh.
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_purchase_stats() TO authenticated, service_role;

-- =====================================================================
-- Tilgangskontroll: matvis bare egne legal_entities. Materialiserte visninger
-- har ikke RLS, så vi lager SECURITY DEFINER-funksjoner for tilgang.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_raw_material_purchase_stats(p_raw_material_id uuid)
RETURNS public.raw_material_purchase_stats
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_le uuid;
  v_row public.raw_material_purchase_stats;
BEGIN
  SELECT legal_entity_id INTO v_le FROM public.raw_materials WHERE id = p_raw_material_id;
  IF v_le IS NULL THEN RETURN NULL; END IF;
  IF NOT public.has_ravarer_access(auth.uid(), v_le, 'read'::access_level) THEN
    RAISE EXCEPTION 'Ikke tilgang';
  END IF;
  SELECT * INTO v_row FROM public.raw_material_purchase_stats
   WHERE raw_material_id = p_raw_material_id AND legal_entity_id = v_le;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_raw_material_purchase_stats(p_legal_entity_id uuid)
RETURNS SETOF public.raw_material_purchase_stats
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
    SELECT * FROM public.raw_material_purchase_stats
     WHERE legal_entity_id = p_legal_entity_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_supplier_purchase_stats(p_supplier_id uuid)
RETURNS SETOF public.raw_material_supplier_purchase_stats
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_le uuid;
BEGIN
  SELECT legal_entity_id INTO v_le FROM public.suppliers WHERE id = p_supplier_id;
  IF v_le IS NULL THEN RETURN; END IF;
  IF NOT public.has_ravarer_access(auth.uid(), v_le, 'read'::access_level) THEN
    RAISE EXCEPTION 'Ikke tilgang';
  END IF;
  RETURN QUERY
    SELECT * FROM public.raw_material_supplier_purchase_stats
     WHERE supplier_id = p_supplier_id AND legal_entity_id = v_le;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_raw_material_purchase_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_raw_material_purchase_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_supplier_purchase_stats(uuid) TO authenticated;

-- Initial fyll
SELECT public.refresh_purchase_stats();
