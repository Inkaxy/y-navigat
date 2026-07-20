
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS bakes_own_products boolean NOT NULL DEFAULT false;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_bakeable_raw boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS baked_product_id uuid NULL REFERENCES public.products(id);

CREATE TABLE IF NOT EXISTS public.customer_bake_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  raw_product_id uuid NOT NULL REFERENCES public.products(id),
  baked_product_id uuid NULL REFERENCES public.products(id),
  bake_date date NOT NULL DEFAULT CURRENT_DATE,
  qty numeric NOT NULL CHECK (qty >= 0),
  registered_by_user_id uuid NULL,
  source text NOT NULL DEFAULT 'portal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, raw_product_id, bake_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_bake_logs TO authenticated;
GRANT ALL ON public.customer_bake_logs TO service_role;

ALTER TABLE public.customer_bake_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bake_logs_admin_read"
  ON public.customer_bake_logs FOR SELECT
  TO authenticated
  USING (public.is_ordre_admin() OR public.is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_customer_bake_logs_customer_date
  ON public.customer_bake_logs (customer_id, bake_date);

CREATE OR REPLACE FUNCTION public._customer_bake_logs_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_customer_bake_logs_touch ON public.customer_bake_logs;
CREATE TRIGGER trg_customer_bake_logs_touch
  BEFORE UPDATE ON public.customer_bake_logs
  FOR EACH ROW EXECUTE FUNCTION public._customer_bake_logs_touch();

CREATE OR REPLACE FUNCTION public.portal_can_bake_own()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT c.bakes_own_products FROM customers c WHERE c.id = public.current_portal_customer_id()),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.portal_list_bakeable_products()
RETURNS TABLE (
  id uuid, display_number integer, code text, display_name text,
  unit_of_sale text, baked_product_id uuid, baked_display_name text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cust AS (
    SELECT c.id, c.default_price_list_id AS price_list_id, c.bakes_own_products
    FROM customers c WHERE c.id = public.current_portal_customer_id()
  )
  SELECT DISTINCT ON (p.id)
    p.id, p.display_number::int, p.code, p.display_name, p.unit_of_sale,
    p.baked_product_id, bp.display_name
  FROM cust
  JOIN price_list_items pli
    ON pli.price_list_id = cust.price_list_id
   AND pli.price > 0.10
   AND pli.valid_from <= CURRENT_DATE
   AND (pli.valid_to IS NULL OR pli.valid_to >= CURRENT_DATE)
  JOIN products p
    ON p.id = pli.product_id
   AND p.is_bakeable_raw = true
   AND p.status <> 'discontinued'
  LEFT JOIN products bp ON bp.id = p.baked_product_id
  WHERE cust.bakes_own_products = true
  ORDER BY p.id, p.display_number DESC;
$$;

CREATE OR REPLACE FUNCTION public.portal_upsert_bake_log(
  p_raw_product_id uuid, p_qty numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id uuid := public.current_portal_customer_id();
  v_can boolean; v_is_bakeable boolean; v_baked_id uuid; v_id uuid;
BEGIN
  IF v_customer_id IS NULL THEN RAISE EXCEPTION 'No portal customer context'; END IF;
  SELECT bakes_own_products INTO v_can FROM customers WHERE id = v_customer_id;
  IF NOT COALESCE(v_can, false) THEN RAISE EXCEPTION 'Customer not enabled for self-baking'; END IF;
  SELECT is_bakeable_raw, baked_product_id INTO v_is_bakeable, v_baked_id
    FROM products WHERE id = p_raw_product_id;
  IF NOT COALESCE(v_is_bakeable, false) THEN RAISE EXCEPTION 'Product is not marked as bakeable'; END IF;

  IF p_qty IS NULL OR p_qty <= 0 THEN
    DELETE FROM customer_bake_logs
     WHERE customer_id = v_customer_id AND raw_product_id = p_raw_product_id AND bake_date = CURRENT_DATE
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  INSERT INTO customer_bake_logs (
    customer_id, raw_product_id, baked_product_id, bake_date, qty, registered_by_user_id, source
  ) VALUES (
    v_customer_id, p_raw_product_id, v_baked_id, CURRENT_DATE, p_qty, auth.uid(), 'portal'
  )
  ON CONFLICT (customer_id, raw_product_id, bake_date)
  DO UPDATE SET qty = EXCLUDED.qty, baked_product_id = EXCLUDED.baked_product_id,
                registered_by_user_id = EXCLUDED.registered_by_user_id, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.portal_list_bake_logs(p_date date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  id uuid, raw_product_id uuid, raw_display_name text,
  baked_product_id uuid, baked_display_name text, qty numeric, bake_date date
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.raw_product_id, p.display_name, l.baked_product_id, bp.display_name, l.qty, l.bake_date
  FROM customer_bake_logs l
  JOIN products p ON p.id = l.raw_product_id
  LEFT JOIN products bp ON bp.id = l.baked_product_id
  WHERE l.customer_id = public.current_portal_customer_id()
    AND l.bake_date = p_date;
$$;

GRANT EXECUTE ON FUNCTION public.portal_can_bake_own() TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_bakeable_products() TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_upsert_bake_log(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_bake_logs(date) TO authenticated;
