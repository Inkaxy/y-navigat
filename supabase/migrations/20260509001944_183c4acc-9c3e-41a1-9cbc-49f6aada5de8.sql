
CREATE OR REPLACE FUNCTION public.get_raw_material_purchase_stats(p_raw_material_id uuid)
RETURNS public.raw_material_purchase_stats
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_le uuid;
  v_row public.raw_material_purchase_stats;
BEGIN
  SELECT legal_entity_id INTO v_le FROM public.raw_materials WHERE id = p_raw_material_id;
  IF v_le IS NULL THEN RETURN NULL; END IF;
  IF NOT public.has_ravarer_access(auth.uid(), v_le, 'read'::access_level) THEN
    RAISE EXCEPTION 'Ikke tilgang';
  END IF;
  SELECT * INTO v_row FROM public.raw_material_purchase_stats
   WHERE raw_material_id = p_raw_material_id AND legal_entity_id = v_le;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_raw_material_purchase_stats(p_legal_entity_id uuid)
RETURNS SETOF public.raw_material_purchase_stats
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_ravarer_access(auth.uid(), p_legal_entity_id, 'read'::access_level) THEN
    RAISE EXCEPTION 'Ikke tilgang';
  END IF;
  RETURN QUERY
    SELECT * FROM public.raw_material_purchase_stats
     WHERE legal_entity_id = p_legal_entity_id;
END;
$function$;
