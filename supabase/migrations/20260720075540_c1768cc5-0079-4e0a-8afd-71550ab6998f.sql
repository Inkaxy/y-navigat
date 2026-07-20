CREATE OR REPLACE FUNCTION public.portal_upsert_bake_log(
  p_raw_product_id uuid,
  p_qty numeric,
  p_bake_date date DEFAULT CURRENT_DATE
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_is_bakeable boolean;
  v_log_id uuid;
BEGIN
  -- Finn kundens aktive customer_id via portal_active_customer
  SELECT customer_id INTO v_customer_id
  FROM public.portal_active_customer
  WHERE user_id = auth.uid();

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Ingen aktiv kunde valgt';
  END IF;

  -- Sjekk at kunden har lov til å registrere selvsteking
  IF NOT EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = v_customer_id AND bakes_own_products = true
  ) THEN
    RAISE EXCEPTION 'Selv-steking er ikke aktivert for denne kunden';
  END IF;

  -- Sjekk at produktet er markert som stekbar råvare
  SELECT is_bakeable_raw INTO v_is_bakeable
  FROM public.products
  WHERE id = p_raw_product_id;

  IF NOT COALESCE(v_is_bakeable, false) THEN
    RAISE EXCEPTION 'Produktet er ikke merket som stekbar råvare';
  END IF;

  -- Datovalidering: tillat i dag og fram i tid (maks 30 dager)
  IF p_bake_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Kan ikke registrere steking bakover i tid';
  END IF;
  IF p_bake_date > CURRENT_DATE + INTERVAL '30 days' THEN
    RAISE EXCEPTION 'Kan ikke registrere steking mer enn 30 dager fram i tid';
  END IF;

  -- qty = 0 → slett eksisterende logg (idempotent)
  IF p_qty <= 0 THEN
    DELETE FROM public.customer_bake_logs
    WHERE customer_id = v_customer_id
      AND raw_product_id = p_raw_product_id
      AND bake_date = p_bake_date;
    RETURN NULL;
  END IF;

  -- Upsert på (customer_id, raw_product_id, bake_date)
  INSERT INTO public.customer_bake_logs (customer_id, raw_product_id, bake_date, qty, created_by)
  VALUES (v_customer_id, p_raw_product_id, p_bake_date, p_qty, auth.uid())
  ON CONFLICT (customer_id, raw_product_id, bake_date)
  DO UPDATE SET qty = EXCLUDED.qty, updated_at = now()
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_upsert_bake_log(uuid, numeric, date) TO authenticated;