-- =====================================================================
-- 2.1: get_customer_unit_price
-- Returnerer alltid eks-MVA pris + vat_rate + source + is_fallback.
-- VOLATILE fordi den logger audit ved fallback-til-0.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_customer_unit_price(
  p_customer_id UUID,
  p_product_id UUID,
  p_date DATE DEFAULT CURRENT_DATE
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
    -- Produktet finnes ikke
    RETURN QUERY SELECT 0::NUMERIC, 0::NUMERIC, 'fallback_zero'::TEXT,
      NULL::UUID, NULL::UUID, true;
    RETURN;
  END IF;

  SELECT * INTO v_eff
  FROM public.get_effective_price(p_product_id, p_customer_id, NULL, p_date);

  IF v_eff.source IS NULL OR v_eff.source = 'none' OR v_eff.price IS NULL THEN
    -- Fallback til 0 — logg til audit
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
          'vat_rate', v_vat_rate
        )
      );
    EXCEPTION WHEN OTHERS THEN NULL; -- best-effort
    END;
    RETURN QUERY SELECT 0::NUMERIC, v_vat_rate, 'fallback_zero'::TEXT,
      NULL::UUID, NULL::UUID, true;
    RETURN;
  END IF;

  -- Konverter til eks-MVA basert på kilde
  IF v_eff.source LIKE 'special_%' THEN
    -- is_net=true betyr eks-MVA (netto), false betyr inkl-MVA
    IF v_eff.is_net THEN
      v_price_excl := v_eff.price;
    ELSE
      v_price_excl := ROUND(v_eff.price / (1 + v_vat_rate / 100.0), 4);
    END IF;
  ELSE
    -- Prisliste-kilde: bruk prices_include_mva-flagg
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

-- =====================================================================
-- 2.1b: batch-variant for UI (kunde-ordre med 10-50 linjer)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_customer_unit_prices_batch(
  p_customer_id UUID,
  p_product_ids UUID[],
  p_date DATE DEFAULT CURRENT_DATE
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
    SELECT * INTO v_row FROM public.get_customer_unit_price(p_customer_id, v_pid, p_date);
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

GRANT EXECUTE ON FUNCTION public.get_customer_unit_price(UUID,UUID,DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_unit_prices_batch(UUID,UUID[],DATE) TO authenticated;

-- =====================================================================
-- 2.5: Idempotent test-data — special_price for 20002 + Kneipp,
-- weekday = dagens ukedag (0=mandag), precedence_over_weekday=true
-- =====================================================================
INSERT INTO public.special_prices (
  legal_entity_id, product_id, customer_id, weekday,
  precedence_over_weekday, price, is_net_price, valid_from, notes
)
SELECT
  c.legal_entity_id,
  p.id,
  c.id,
  ((EXTRACT(DOW FROM CURRENT_DATE)::INT + 6) % 7)::SMALLINT,
  true,
  9.99,
  true,
  CURRENT_DATE - 1,
  'O.1.bug.2 test-data — verifiserer special_customer_weekday_precedence'
FROM public.customers c
CROSS JOIN public.products p
WHERE c.customer_number = '20002'
  AND p.id = '6264cb88-aa74-41d4-b95d-633f7682fdaa'
  AND NOT EXISTS (
    SELECT 1 FROM public.special_prices sp
    WHERE sp.customer_id = c.id
      AND sp.product_id = p.id
      AND sp.notes LIKE 'O.1.bug.2 test-data%'
  );