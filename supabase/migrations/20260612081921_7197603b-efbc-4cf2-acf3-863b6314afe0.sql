
-- POS-PRINT.3 Steg 2.5 + INT.3 fiks: RPC-er for POS-spesifikke felt på products

CREATE OR REPLACE FUNCTION public.pos_set_product_station(
  p_product_id uuid,
  p_station_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity uuid;
  v_station_entity uuid;
BEGIN
  SELECT legal_entity_id INTO v_entity FROM public.products WHERE id = p_product_id;
  IF v_entity IS NULL THEN
    RAISE EXCEPTION 'Produkt % finnes ikke', p_product_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    public.is_platform_admin()
    OR (public.has_position_in_entity(v_entity) AND public.has_app_write_access('pos_styring'))
  ) THEN
    RAISE EXCEPTION 'Mangler tilgang til å endre POS-stasjon for dette produktet'
      USING ERRCODE = '42501';
  END IF;

  IF p_station_id IS NOT NULL THEN
    SELECT legal_entity_id INTO v_station_entity
      FROM public.pos_print_stations WHERE id = p_station_id;
    IF v_station_entity IS NULL THEN
      RAISE EXCEPTION 'Stasjon % finnes ikke', p_station_id USING ERRCODE = 'P0002';
    END IF;
    IF v_station_entity <> v_entity THEN
      RAISE EXCEPTION 'Stasjon tilhører et annet selskap enn produktet'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.products
     SET pos_print_station_id = p_station_id,
         updated_at = now()
   WHERE id = p_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_set_product_station(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_set_product_station(uuid, uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.pos_set_product_name(
  p_product_id uuid,
  p_pos_name text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity uuid;
  v_clean text;
BEGIN
  SELECT legal_entity_id INTO v_entity FROM public.products WHERE id = p_product_id;
  IF v_entity IS NULL THEN
    RAISE EXCEPTION 'Produkt % finnes ikke', p_product_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    public.is_platform_admin()
    OR (public.has_position_in_entity(v_entity) AND public.has_app_write_access('pos_styring'))
  ) THEN
    RAISE EXCEPTION 'Mangler tilgang til å endre POS-navn for dette produktet'
      USING ERRCODE = '42501';
  END IF;

  v_clean := NULLIF(btrim(COALESCE(p_pos_name, '')), '');

  UPDATE public.products
     SET pos_display_name = v_clean,
         updated_at = now()
   WHERE id = p_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_set_product_name(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_set_product_name(uuid, text) TO authenticated;
