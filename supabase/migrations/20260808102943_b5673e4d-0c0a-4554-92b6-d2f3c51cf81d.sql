CREATE OR REPLACE FUNCTION public.merge_raw_materials(p_keep uuid, p_dup uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keep_entity uuid;
  v_dup_entity uuid;
BEGIN
  IF p_keep = p_dup THEN RAISE EXCEPTION 'Kan ikke slå sammen en råvare med seg selv'; END IF;
  SELECT legal_entity_id INTO v_keep_entity FROM raw_materials WHERE id = p_keep;
  SELECT legal_entity_id INTO v_dup_entity FROM raw_materials WHERE id = p_dup;
  IF v_keep_entity IS NULL OR v_dup_entity IS NULL THEN RAISE EXCEPTION 'Råvare finnes ikke'; END IF;
  IF v_keep_entity <> v_dup_entity THEN RAISE EXCEPTION 'Råvarene tilhører ulike selskaper'; END IF;

  UPDATE invoice_lines SET raw_material_id = p_keep WHERE raw_material_id = p_dup;
  DELETE FROM invoice_line_match_suggestions s
    WHERE s.raw_material_id = p_dup
      AND EXISTS (SELECT 1 FROM invoice_line_match_suggestions k
                  WHERE k.invoice_line_id = s.invoice_line_id AND k.raw_material_id = p_keep);
  UPDATE invoice_line_match_suggestions SET raw_material_id = p_keep WHERE raw_material_id = p_dup;
  UPDATE raw_material_price_history SET raw_material_id = p_keep WHERE raw_material_id = p_dup;
  UPDATE raw_material_purchases SET raw_material_id = p_keep WHERE raw_material_id = p_dup;
  UPDATE recipe_lines SET raw_material_id = p_keep WHERE raw_material_id = p_dup;
  UPDATE recipe_packaging_lines SET raw_material_id = p_keep WHERE raw_material_id = p_dup;
  UPDATE raw_material_datasheets SET raw_material_id = p_keep WHERE raw_material_id = p_dup;

  -- Flytt leverandørkoblinger som ikke finnes fra før, og alias som følger med
  UPDATE raw_material_suppliers d SET raw_material_id = p_keep
   WHERE d.raw_material_id = p_dup
     AND NOT EXISTS (SELECT 1 FROM raw_material_suppliers k
                     WHERE k.raw_material_id = p_keep AND k.supplier_id = d.supplier_id);

  -- For leverandører som allerede finnes på p_keep: flytt aliasene, unngå duplikater
  UPDATE raw_material_supplier_aliases a
     SET raw_material_supplier_id = k.id
    FROM raw_material_suppliers d
    JOIN raw_material_suppliers k ON k.raw_material_id = p_keep AND k.supplier_id = d.supplier_id
   WHERE d.raw_material_id = p_dup
     AND a.raw_material_supplier_id = d.id
     AND NOT EXISTS (SELECT 1 FROM raw_material_supplier_aliases x
                     WHERE x.raw_material_supplier_id = k.id
                       AND x.alias_type = a.alias_type
                       AND x.alias_value_normalized = a.alias_value_normalized);

  DELETE FROM raw_materials WHERE id = p_dup;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_raw_materials(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_raw_materials(uuid, uuid) TO authenticated, service_role;

SELECT public.merge_raw_materials('08d3f4e6-b10c-4880-a6ff-d0c17fcc0a67'::uuid, 'c67589b0-f4e8-4f5e-9024-66fadac092c1'::uuid);