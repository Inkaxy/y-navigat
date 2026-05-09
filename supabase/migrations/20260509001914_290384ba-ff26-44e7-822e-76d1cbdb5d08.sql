
-- 1) Recreate raw_material_purchase_stats including 'ready' invoices
DROP MATERIALIZED VIEW IF EXISTS public.raw_material_purchase_stats CASCADE;
CREATE MATERIALIZED VIEW public.raw_material_purchase_stats AS
WITH lines_norm AS (
  SELECT il.raw_material_id,
         i.legal_entity_id,
         i.supplier_id,
         i.invoice_date,
         il.quantity,
         lower(COALESCE(il.unit, '')) AS unit_lc,
         il.total_amount,
         rm.base_unit,
         rms.package_size AS rms_pkg_size,
         rm.package_size  AS rm_pkg_size,
         CASE
           WHEN rm.base_unit = 'kg'  AND lower(COALESCE(il.unit,'')) = 'g'  THEN il.quantity / 1000.0
           WHEN rm.base_unit = 'kg'  AND lower(COALESCE(il.unit,'')) = 'kg' THEN il.quantity
           WHEN rm.base_unit = 'l'   AND lower(COALESCE(il.unit,'')) = 'ml' THEN il.quantity / 1000.0
           WHEN rm.base_unit = 'l'   AND lower(COALESCE(il.unit,'')) = 'l'  THEN il.quantity
           WHEN rm.base_unit = 'stk' AND lower(COALESCE(il.unit,'')) = ANY(ARRAY['stk','pcs','pc','st']) THEN il.quantity
           WHEN lower(COALESCE(il.unit,'')) = ANY(ARRAY['sekk','kartong','pall','pose','boks','eske','krt','spann','pk'])
             THEN il.quantity * COALESCE(rms.package_size, rm.package_size, 1)
           ELSE il.quantity
         END AS qty_base,
         CASE
           WHEN lower(COALESCE(il.unit,'')) = ANY(ARRAY['sekk','kartong','pall','pose','boks','eske','krt','spann','pk'])
                AND COALESCE(rms.package_size, rm.package_size) IS NULL THEN true
           ELSE false
         END AS package_size_missing
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    LEFT JOIN raw_materials rm ON rm.id = il.raw_material_id
    LEFT JOIN raw_material_suppliers rms ON rms.raw_material_id = il.raw_material_id AND rms.supplier_id = i.supplier_id
   WHERE il.raw_material_id IS NOT NULL
     AND il.match_confidence = ANY(ARRAY['auto_high','auto_low','manual'])
     AND i.status = ANY(ARRAY['ready','reconciled'])
)
SELECT raw_material_id,
       legal_entity_id,
       sum(CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '30 days'  THEN qty_base    ELSE 0 END) AS quantity_30d,
       sum(CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '30 days'  THEN total_amount ELSE 0 END) AS cost_30d,
       count(CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '30 days' THEN 1 END) AS invoice_count_30d,
       sum(CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '90 days'  THEN qty_base    ELSE 0 END) AS quantity_90d,
       sum(CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '90 days'  THEN total_amount ELSE 0 END) AS cost_90d,
       count(CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '90 days' THEN 1 END) AS invoice_count_90d,
       sum(CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '1 year'   THEN qty_base    ELSE 0 END) AS quantity_12m,
       sum(CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '1 year'   THEN total_amount ELSE 0 END) AS cost_12m,
       count(CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '1 year' THEN 1 END) AS invoice_count_12m,
       sum(CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '2 years'  THEN qty_base    ELSE 0 END) AS quantity_24m,
       sum(CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '2 years'  THEN total_amount ELSE 0 END) AS cost_24m,
       CASE WHEN sum(CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '1 year' THEN qty_base ELSE 0 END) > 0
            THEN sum(CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '1 year' THEN total_amount ELSE 0 END)
               / sum(CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '1 year' THEN qty_base ELSE 0 END)
            ELSE NULL END AS avg_price_per_base_unit_12m,
       CASE WHEN count(CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '1 year' THEN 1 END) > 0
            THEN sum(CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '1 year' THEN qty_base ELSE 0 END) / 12.0
            ELSE NULL END AS avg_monthly_volume,
       max(invoice_date) AS last_invoice_date,
       count(DISTINCT CASE WHEN invoice_date > CURRENT_DATE - INTERVAL '1 year' THEN supplier_id END) AS supplier_count_12m,
       bool_or(package_size_missing) AS has_package_size_warning
  FROM lines_norm
 GROUP BY raw_material_id, legal_entity_id;

CREATE UNIQUE INDEX rm_purchase_stats_pk ON public.raw_material_purchase_stats(raw_material_id, legal_entity_id);
CREATE INDEX rm_purchase_stats_le ON public.raw_material_purchase_stats(legal_entity_id);

-- 2) Recreate raw_material_monthly_purchases including 'ready' invoices
DROP MATERIALIZED VIEW IF EXISTS public.raw_material_monthly_purchases CASCADE;
CREATE MATERIALIZED VIEW public.raw_material_monthly_purchases AS
WITH lines_norm AS (
  SELECT il.raw_material_id,
         i.legal_entity_id,
         i.supplier_id,
         date_trunc('month', i.invoice_date::timestamptz)::date AS month_start,
         il.total_amount,
         CASE
           WHEN rm.base_unit = 'kg'  AND lower(COALESCE(il.unit,'')) = 'g'  THEN il.quantity / 1000.0
           WHEN rm.base_unit = 'kg'  AND lower(COALESCE(il.unit,'')) = 'kg' THEN il.quantity
           WHEN rm.base_unit = 'l'   AND lower(COALESCE(il.unit,'')) = 'ml' THEN il.quantity / 1000.0
           WHEN rm.base_unit = 'l'   AND lower(COALESCE(il.unit,'')) = 'l'  THEN il.quantity
           WHEN rm.base_unit = 'stk' AND lower(COALESCE(il.unit,'')) = ANY(ARRAY['stk','pcs','pc','st']) THEN il.quantity
           WHEN lower(COALESCE(il.unit,'')) = ANY(ARRAY['sekk','kartong','pall','pose','boks','eske','krt','spann','pk'])
             THEN il.quantity * COALESCE(rms.package_size, rm.package_size, 1)
           ELSE il.quantity
         END AS qty_base
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    LEFT JOIN raw_materials rm ON rm.id = il.raw_material_id
    LEFT JOIN raw_material_suppliers rms ON rms.raw_material_id = il.raw_material_id AND rms.supplier_id = i.supplier_id
   WHERE il.raw_material_id IS NOT NULL
     AND il.match_confidence = ANY(ARRAY['auto_high','auto_low','manual'])
     AND i.status = ANY(ARRAY['ready','reconciled'])
)
SELECT raw_material_id,
       legal_entity_id,
       COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid) AS supplier_id,
       month_start,
       sum(qty_base) AS total_quantity,
       sum(total_amount) AS total_cost,
       count(*) AS invoice_count,
       CASE WHEN sum(qty_base) > 0 THEN sum(total_amount)/sum(qty_base) ELSE NULL END AS avg_price_per_base_unit
  FROM lines_norm
 GROUP BY raw_material_id, legal_entity_id, COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), month_start;

CREATE UNIQUE INDEX rm_monthly_purchases_pk ON public.raw_material_monthly_purchases(raw_material_id, legal_entity_id, supplier_id, month_start);
CREATE INDEX rm_monthly_purchases_le_month ON public.raw_material_monthly_purchases(legal_entity_id, month_start DESC);
CREATE INDEX rm_monthly_purchases_rm ON public.raw_material_monthly_purchases(raw_material_id, month_start DESC);

REFRESH MATERIALIZED VIEW public.raw_material_purchase_stats;
REFRESH MATERIALIZED VIEW public.raw_material_monthly_purchases;

-- 3) Backfill raw_material_price_history for matched lines on ready/reconciled invoices
INSERT INTO public.raw_material_price_history
  (raw_material_id, supplier_id, price, source, invoice_id, effective_date, source_reference)
SELECT il.raw_material_id,
       i.supplier_id,
       COALESCE(il.price_per_base_unit, il.unit_price) AS price,
       'invoice',
       i.id,
       i.invoice_date,
       i.invoice_number
  FROM invoice_lines il
  JOIN invoices i ON i.id = il.invoice_id
 WHERE il.raw_material_id IS NOT NULL
   AND il.match_confidence = ANY(ARRAY['auto_high','auto_low','manual'])
   AND i.status = ANY(ARRAY['ready','reconciled'])
   AND COALESCE(il.price_per_base_unit, il.unit_price) IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.raw_material_price_history h
      WHERE h.invoice_id = i.id AND h.raw_material_id = il.raw_material_id
   );

-- 4) Trigger: auto-insert price history when invoice flips to ready/reconciled
CREATE OR REPLACE FUNCTION public.fn_invoice_status_price_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = ANY(ARRAY['ready','reconciled'])
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.raw_material_price_history
      (raw_material_id, supplier_id, price, source, invoice_id, effective_date, source_reference)
    SELECT il.raw_material_id,
           NEW.supplier_id,
           COALESCE(il.price_per_base_unit, il.unit_price),
           'invoice',
           NEW.id,
           NEW.invoice_date,
           NEW.invoice_number
      FROM invoice_lines il
     WHERE il.invoice_id = NEW.id
       AND il.raw_material_id IS NOT NULL
       AND il.match_confidence = ANY(ARRAY['auto_high','auto_low','manual'])
       AND COALESCE(il.price_per_base_unit, il.unit_price) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.raw_material_price_history h
          WHERE h.invoice_id = NEW.id AND h.raw_material_id = il.raw_material_id
       );
    PERFORM public.refresh_purchase_stats();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_status_price_history ON public.invoices;
CREATE TRIGGER trg_invoice_status_price_history
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoice_status_price_history();

-- 5) Trigger: auto-insert when invoice line gets matched on an already-ready/reconciled invoice
CREATE OR REPLACE FUNCTION public.fn_invoice_line_match_price_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv invoices%ROWTYPE;
BEGIN
  IF NEW.raw_material_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.raw_material_id IS NOT DISTINCT FROM NEW.raw_material_id
     AND OLD.match_confidence IS NOT DISTINCT FROM NEW.match_confidence THEN
    RETURN NEW;
  END IF;
  IF NEW.match_confidence IS NULL OR NEW.match_confidence NOT IN ('auto_high','auto_low','manual') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_inv FROM invoices WHERE id = NEW.invoice_id;
  IF v_inv.status NOT IN ('ready','reconciled') THEN RETURN NEW; END IF;
  IF COALESCE(NEW.price_per_base_unit, NEW.unit_price) IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.raw_material_price_history
    (raw_material_id, supplier_id, price, source, invoice_id, effective_date, source_reference)
  SELECT NEW.raw_material_id, v_inv.supplier_id,
         COALESCE(NEW.price_per_base_unit, NEW.unit_price),
         'invoice', v_inv.id, v_inv.invoice_date, v_inv.invoice_number
   WHERE NOT EXISTS (
     SELECT 1 FROM public.raw_material_price_history h
      WHERE h.invoice_id = v_inv.id AND h.raw_material_id = NEW.raw_material_id
   );
  PERFORM public.refresh_purchase_stats();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_line_match_price_history ON public.invoice_lines;
CREATE TRIGGER trg_invoice_line_match_price_history
  AFTER INSERT OR UPDATE OF raw_material_id, match_confidence ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoice_line_match_price_history();
