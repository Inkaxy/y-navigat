
-- Drop old signatures (DEFAULT-arg gjør at vi ikke kan CREATE OR REPLACE med ny aritet)
DROP FUNCTION IF EXISTS public.get_customer_unit_price(UUID, UUID, DATE);
DROP FUNCTION IF EXISTS public.get_customer_unit_prices_batch(UUID, UUID[], DATE);

CREATE OR REPLACE FUNCTION public.get_customer_unit_price(
  p_customer_id UUID,
  p_product_id UUID,
  p_date DATE DEFAULT CURRENT_DATE,
  p_caller TEXT DEFAULT 'unknown'
)
RETURNS TABLE(
  unit_price_excl_mva NUMERIC,
  vat_rate NUMERIC,
  source TEXT,
  special_price_id UUID,
  price_list_id UUID,
  is_fallback BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eff RECORD;
  v_vat_rate NUMERIC;
  v_price_excl NUMERIC;
  v_pl_includes_mva BOOLEAN;
  v_attempted_sources TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT COALESCE(p.mva_rate, 15) INTO v_vat_rate
  FROM public.products p WHERE p.id = p_product_id;

  IF v_vat_rate IS NULL THEN
    RETURN QUERY SELECT 0::NUMERIC, 0::NUMERIC, 'fallback_zero'::TEXT,
      NULL::UUID, NULL::UUID, true;
    RETURN;
  END IF;

  SELECT * INTO v_eff
  FROM public.get_effective_price(p_product_id, p_customer_id, NULL, p_date);

  IF v_eff.source IS NULL OR v_eff.source = 'none' OR v_eff.price IS NULL THEN
    v_attempted_sources := ARRAY['special_customer','customer_default_price_list','system_default_price_list'];
    BEGIN
      INSERT INTO public.audit_log (
        action, entity_type, entity_id, source_app, changes
      ) VALUES (
        'price_fallback_zero', 'order_line', NULL, 'ordre',
        jsonb_build_object(
          'customer_id', p_customer_id,
          'product_id', p_product_id,
          'delivery_date', p_date,
          'attempted_sources', to_jsonb(v_attempted_sources),
          'fallback_to', 'fallback_zero',
          'resolved_unit_price_excl_mva', 0,
          'vat_rate', v_vat_rate,
          'rpc', p_caller
        )
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN QUERY SELECT 0::NUMERIC, v_vat_rate, 'fallback_zero'::TEXT,
      NULL::UUID, NULL::UUID, true;
    RETURN;
  END IF;

  IF v_eff.source LIKE 'special_%' THEN
    IF v_eff.is_net THEN
      v_price_excl := v_eff.price;
    ELSE
      v_price_excl := ROUND(v_eff.price / (1 + v_vat_rate / 100.0), 4);
    END IF;
  ELSE
    SELECT pl.prices_include_mva INTO v_pl_includes_mva
    FROM public.price_lists pl WHERE pl.id = v_eff.price_list_id;
    IF COALESCE(v_pl_includes_mva, false) THEN
      v_price_excl := ROUND(v_eff.price / (1 + v_vat_rate / 100.0), 4);
    ELSE
      v_price_excl := v_eff.price;
    END IF;
  END IF;

  RETURN QUERY SELECT v_price_excl, v_vat_rate, v_eff.source,
    v_eff.special_price_id, v_eff.price_list_id, false;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_unit_prices_batch(
  p_customer_id UUID,
  p_product_ids UUID[],
  p_date DATE DEFAULT CURRENT_DATE,
  p_caller TEXT DEFAULT 'unknown'
)
RETURNS TABLE(
  product_id UUID,
  unit_price_excl_mva NUMERIC,
  vat_rate NUMERIC,
  source TEXT,
  special_price_id UUID,
  price_list_id UUID,
  is_fallback BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid UUID;
  v_row RECORD;
BEGIN
  FOREACH v_pid IN ARRAY p_product_ids LOOP
    SELECT * INTO v_row FROM public.get_customer_unit_price(p_customer_id, v_pid, p_date, p_caller);
    product_id := v_pid;
    unit_price_excl_mva := v_row.unit_price_excl_mva;
    vat_rate := v_row.vat_rate;
    source := v_row.source;
    special_price_id := v_row.special_price_id;
    price_list_id := v_row.price_list_id;
    is_fallback := v_row.is_fallback;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_unit_price(UUID,UUID,DATE,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_unit_prices_batch(UUID,UUID[],DATE,TEXT) TO authenticated;
