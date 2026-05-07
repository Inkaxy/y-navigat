
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
        action, entity_type, entity_id, source_app, changes, user_id
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
        ),
        auth.uid()
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
