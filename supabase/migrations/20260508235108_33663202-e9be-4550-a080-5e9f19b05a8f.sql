-- Purchase history table
CREATE TABLE public.raw_material_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL,
  raw_material_id uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  invoice_line_id uuid NOT NULL UNIQUE REFERENCES public.invoice_lines(id) ON DELETE CASCADE,
  purchase_date date NOT NULL,
  quantity numeric NOT NULL,
  unit text,
  unit_price numeric,
  price_per_base_unit numeric,
  total_amount numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rmp_rm_date ON public.raw_material_purchases (raw_material_id, purchase_date DESC);
CREATE INDEX idx_rmp_supplier_date ON public.raw_material_purchases (supplier_id, purchase_date DESC);
CREATE INDEX idx_rmp_legal_entity ON public.raw_material_purchases (legal_entity_id);

ALTER TABLE public.raw_material_purchases ENABLE ROW LEVEL SECURITY;

-- Read access mirrors raw materials module
CREATE POLICY "rmp_read" ON public.raw_material_purchases
FOR SELECT TO authenticated
USING (public.has_ravarer_access(auth.uid(), legal_entity_id, 'read'::access_level));

-- No direct insert/update/delete from clients — managed by trigger only.

-- Trigger: sync purchase row when invoice_line gets matched
CREATE OR REPLACE FUNCTION public.sync_raw_material_purchase()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.raw_material_purchases WHERE invoice_line_id = OLD.id;
    RETURN OLD;
  END IF;

  -- Match removed → delete row
  IF NEW.raw_material_id IS NULL THEN
    DELETE FROM public.raw_material_purchases WHERE invoice_line_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Skip excluded lines
  IF NEW.match_confidence = 'not_applicable' THEN
    DELETE FROM public.raw_material_purchases WHERE invoice_line_id = NEW.id;
    RETURN NEW;
  END IF;

  SELECT id, legal_entity_id, supplier_id, invoice_date
    INTO v_invoice
  FROM public.invoices WHERE id = NEW.invoice_id;

  IF v_invoice.id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.raw_material_purchases (
    legal_entity_id, raw_material_id, supplier_id, invoice_id, invoice_line_id,
    purchase_date, quantity, unit, unit_price, price_per_base_unit, total_amount
  ) VALUES (
    v_invoice.legal_entity_id, NEW.raw_material_id, v_invoice.supplier_id,
    v_invoice.id, NEW.id, v_invoice.invoice_date,
    COALESCE(NEW.quantity, 0), NEW.unit, NEW.unit_price,
    NEW.price_per_base_unit, NEW.total_amount
  )
  ON CONFLICT (invoice_line_id) DO UPDATE SET
    raw_material_id = EXCLUDED.raw_material_id,
    supplier_id = EXCLUDED.supplier_id,
    purchase_date = EXCLUDED.purchase_date,
    quantity = EXCLUDED.quantity,
    unit = EXCLUDED.unit,
    unit_price = EXCLUDED.unit_price,
    price_per_base_unit = EXCLUDED.price_per_base_unit,
    total_amount = EXCLUDED.total_amount,
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_raw_material_purchase
AFTER INSERT OR UPDATE OF raw_material_id, quantity, unit, unit_price, price_per_base_unit, total_amount, match_confidence
OR DELETE
ON public.invoice_lines
FOR EACH ROW
EXECUTE FUNCTION public.sync_raw_material_purchase();

-- Backfill from existing matched lines
INSERT INTO public.raw_material_purchases (
  legal_entity_id, raw_material_id, supplier_id, invoice_id, invoice_line_id,
  purchase_date, quantity, unit, unit_price, price_per_base_unit, total_amount
)
SELECT i.legal_entity_id, l.raw_material_id, i.supplier_id, i.id, l.id,
       i.invoice_date, COALESCE(l.quantity, 0), l.unit, l.unit_price,
       l.price_per_base_unit, l.total_amount
FROM public.invoice_lines l
JOIN public.invoices i ON i.id = l.invoice_id
WHERE l.raw_material_id IS NOT NULL
  AND COALESCE(l.match_confidence, '') <> 'not_applicable'
ON CONFLICT (invoice_line_id) DO NOTHING;

-- Trigger updated_at
CREATE TRIGGER set_rmp_updated_at
BEFORE UPDATE ON public.raw_material_purchases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();