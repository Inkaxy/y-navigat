
-- RPC som lar alle med ravarer 'read'-tilgang endre navn på en råvare,
-- uten å gi full update-rett. Behover bypass av RLS, derfor SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.rename_raw_material(p_id uuid, p_name text)
RETURNS public.raw_materials
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_le uuid;
  v_row public.raw_materials;
BEGIN
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Navn kan ikke være tomt';
  END IF;

  SELECT legal_entity_id INTO v_le FROM public.raw_materials WHERE id = p_id;
  IF v_le IS NULL THEN
    RAISE EXCEPTION 'Råvare ikke funnet';
  END IF;

  IF NOT public.has_ravarer_access(auth.uid(), v_le, 'read'::access_level) THEN
    RAISE EXCEPTION 'Ikke tilgang';
  END IF;

  UPDATE public.raw_materials
     SET name = btrim(p_name), updated_at = now()
   WHERE id = p_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rename_raw_material(uuid, text) TO authenticated;
