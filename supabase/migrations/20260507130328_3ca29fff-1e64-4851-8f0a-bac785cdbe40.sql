
-- Lagrer/oppdaterer kolonne-kommentar (orders.internal_notes) for (customer, date, tour)
-- Oppretter tomt ordre-skall ved behov, slik at kommentar kan eksistere uten leveranse.
CREATE OR REPLACE FUNCTION public.upsert_matrix_column_comment(
  p_customer_id UUID,
  p_date DATE,
  p_tour_id UUID,
  p_comment TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_legal_entity_id UUID;
  v_customer_snapshot JSONB;
  v_order_id UUID;
  v_num_row RECORD;
  v_normalized TEXT;
BEGIN
  v_normalized := NULLIF(BTRIM(COALESCE(p_comment, '')), '');

  SELECT c.legal_entity_id, to_jsonb(c.*)
    INTO v_legal_entity_id, v_customer_snapshot
  FROM public.customers c WHERE c.id = p_customer_id;

  IF v_legal_entity_id IS NULL THEN
    RAISE EXCEPTION 'Kunde finnes ikke';
  END IF;

  IF NOT (public.has_position_in_entity(v_legal_entity_id) AND public.has_app_write_access('ordre')) THEN
    RAISE EXCEPTION 'Mangler skrivetilgang til Ordre for valgt selskap';
  END IF;

  SELECT o.id INTO v_order_id
  FROM public.orders o
  WHERE o.customer_id = p_customer_id
    AND o.delivery_date = p_date
    AND o.delivery_tour_id = p_tour_id
    AND o.status NOT IN ('cancelled')
  LIMIT 1;

  IF v_order_id IS NULL THEN
    -- Hvis kommentar er tom og ingen ordre finnes: ingenting å gjøre
    IF v_normalized IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT * INTO v_num_row FROM public.next_order_number(v_legal_entity_id);

    INSERT INTO public.orders (
      legal_entity_id, customer_id, customer_snapshot,
      order_number, order_sequence, order_year,
      delivery_date, delivery_tour_id,
      source, status, use_customer_default_address,
      internal_notes
    ) VALUES (
      v_legal_entity_id, p_customer_id, v_customer_snapshot,
      v_num_row.order_number, v_num_row.order_sequence, v_num_row.order_year,
      p_date, p_tour_id,
      'matrix_entry', 'confirmed', true,
      v_normalized
    ) RETURNING id INTO v_order_id;
  ELSE
    UPDATE public.orders
       SET internal_notes = v_normalized,
           updated_at = now()
     WHERE id = v_order_id;
  END IF;

  RETURN v_order_id;
END;
$$;

-- Sletter alle ordrelinjer for (customer, date, tour). Beholder ordren hvis den har internal_notes,
-- ellers slettes ordreskallet også.
CREATE OR REPLACE FUNCTION public.delete_matrix_column(
  p_customer_id UUID,
  p_date DATE,
  p_tour_id UUID
)
RETURNS TABLE(lines_deleted INT, order_deleted BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_legal_entity_id UUID;
  v_order_id UUID;
  v_internal_notes TEXT;
  v_lines_deleted INT := 0;
  v_order_deleted BOOLEAN := false;
BEGIN
  SELECT c.legal_entity_id INTO v_legal_entity_id
  FROM public.customers c WHERE c.id = p_customer_id;

  IF v_legal_entity_id IS NULL THEN
    RAISE EXCEPTION 'Kunde finnes ikke';
  END IF;

  IF NOT (public.has_position_in_entity(v_legal_entity_id) AND public.has_app_write_access('ordre')) THEN
    RAISE EXCEPTION 'Mangler skrivetilgang til Ordre for valgt selskap';
  END IF;

  SELECT o.id, o.internal_notes INTO v_order_id, v_internal_notes
  FROM public.orders o
  WHERE o.customer_id = p_customer_id
    AND o.delivery_date = p_date
    AND o.delivery_tour_id = p_tour_id
    AND o.status NOT IN ('cancelled')
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RETURN QUERY SELECT 0, false;
    RETURN;
  END IF;

  WITH d AS (
    DELETE FROM public.order_lines WHERE order_id = v_order_id RETURNING 1
  )
  SELECT COUNT(*)::INT INTO v_lines_deleted FROM d;

  IF v_internal_notes IS NULL OR BTRIM(v_internal_notes) = '' THEN
    DELETE FROM public.orders WHERE id = v_order_id;
    v_order_deleted := true;
  ELSE
    PERFORM public.recalc_order_totals(v_order_id);
  END IF;

  RETURN QUERY SELECT v_lines_deleted, v_order_deleted;
END;
$$;
