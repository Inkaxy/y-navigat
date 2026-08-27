DROP POLICY IF EXISTS cake_image_formats_all ON public.cake_image_formats;
CREATE POLICY cake_image_formats_all ON public.cake_image_formats FOR ALL TO authenticated
  USING (public.has_position_in_entity(legal_entity_id))
  WITH CHECK (public.has_position_in_entity(legal_entity_id));

DROP POLICY IF EXISTS cake_print_calibration_all ON public.cake_print_calibration;
CREATE POLICY cake_print_calibration_all ON public.cake_print_calibration FOR ALL TO authenticated
  USING (public.has_position_in_entity(legal_entity_id))
  WITH CHECK (public.has_position_in_entity(legal_entity_id));

DROP POLICY IF EXISTS cake_printer_calibrations_all ON public.cake_printer_calibrations;
CREATE POLICY cake_printer_calibrations_all ON public.cake_printer_calibrations FOR ALL TO authenticated
  USING (public.has_position_in_entity(legal_entity_id))
  WITH CHECK (public.has_position_in_entity(legal_entity_id));

DROP POLICY IF EXISTS label_day_sequences_all ON public.label_day_sequences;
CREATE POLICY label_day_sequences_all ON public.label_day_sequences FOR ALL TO authenticated
  USING (public.has_position_in_entity(legal_entity_id))
  WITH CHECK (public.has_position_in_entity(legal_entity_id));

DROP POLICY IF EXISTS label_marks_all ON public.label_marks;
CREATE POLICY label_marks_all ON public.label_marks FOR ALL TO authenticated
  USING (public.has_position_in_entity(legal_entity_id))
  WITH CHECK (public.has_position_in_entity(legal_entity_id));

DROP POLICY IF EXISTS label_units_all ON public.label_units;
CREATE POLICY label_units_all ON public.label_units FOR ALL TO authenticated
  USING (public.has_position_in_entity(legal_entity_id))
  WITH CHECK (public.has_position_in_entity(legal_entity_id));

DROP POLICY IF EXISTS stock_movements_all ON public.stock_movements;
CREATE POLICY stock_movements_all ON public.stock_movements FOR ALL TO authenticated
  USING (public.has_position_in_entity(legal_entity_id))
  WITH CHECK (public.has_position_in_entity(legal_entity_id));

DROP POLICY IF EXISTS raw_material_products_all ON public.raw_material_products;
CREATE POLICY raw_material_products_all ON public.raw_material_products FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.raw_materials rm
                 WHERE rm.id = raw_material_products.raw_material_id
                   AND public.has_position_in_entity(rm.legal_entity_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.raw_materials rm
                 WHERE rm.id = raw_material_products.raw_material_id
                   AND public.has_position_in_entity(rm.legal_entity_id)));

DROP POLICY IF EXISTS cake_image_prints_all ON public.cake_image_prints;
CREATE POLICY cake_image_prints_all ON public.cake_image_prints FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cake_images ci
                 WHERE ci.id = cake_image_prints.cake_image_id
                   AND public.has_position_in_entity(ci.legal_entity_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cake_images ci
                 WHERE ci.id = cake_image_prints.cake_image_id
                   AND public.has_position_in_entity(ci.legal_entity_id)));

DROP POLICY IF EXISTS recipe_label_calculated_all ON public.recipe_label_calculated;
CREATE POLICY recipe_label_calculated_all ON public.recipe_label_calculated FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.recipes r
                 WHERE r.id = recipe_label_calculated.recipe_id
                   AND public.has_position_in_entity(r.legal_entity_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.recipes r
                 WHERE r.id = recipe_label_calculated.recipe_id
                   AND public.has_position_in_entity(r.legal_entity_id)));

DROP POLICY IF EXISTS recipe_share_links_internal ON public.recipe_share_links;
CREATE POLICY recipe_share_links_internal ON public.recipe_share_links FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.recipes r
                 WHERE r.id = recipe_share_links.recipe_id
                   AND public.has_position_in_entity(r.legal_entity_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.recipes r
                 WHERE r.id = recipe_share_links.recipe_id
                   AND public.has_position_in_entity(r.legal_entity_id)));