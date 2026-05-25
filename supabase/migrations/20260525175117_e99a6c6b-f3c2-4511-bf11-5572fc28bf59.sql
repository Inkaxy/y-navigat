
-- 1) Recipe labor lines: scope via recipe -> product -> legal_entity
DROP POLICY IF EXISTS rll_select ON public.recipe_labor_lines;
DROP POLICY IF EXISTS rll_write ON public.recipe_labor_lines;

CREATE POLICY rll_select ON public.recipe_labor_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.recipes r
    JOIN public.products p ON p.id = r.product_id
    WHERE r.id = recipe_labor_lines.recipe_id
      AND (has_position_in_entity(p.legal_entity_id) OR is_platform_admin())
  ));

CREATE POLICY rll_write ON public.recipe_labor_lines
  FOR ALL TO authenticated
  USING (
    has_app_write_access('varer') AND EXISTS (
      SELECT 1 FROM public.recipes r
      JOIN public.products p ON p.id = r.product_id
      WHERE r.id = recipe_labor_lines.recipe_id
        AND has_position_in_entity(p.legal_entity_id)
    )
  )
  WITH CHECK (
    has_app_write_access('varer') AND EXISTS (
      SELECT 1 FROM public.recipes r
      JOIN public.products p ON p.id = r.product_id
      WHERE r.id = recipe_labor_lines.recipe_id
        AND has_position_in_entity(p.legal_entity_id)
    )
  );

-- 2) Recipe packaging lines: same shape
DROP POLICY IF EXISTS rpl_select ON public.recipe_packaging_lines;
DROP POLICY IF EXISTS rpl_write ON public.recipe_packaging_lines;

CREATE POLICY rpl_select ON public.recipe_packaging_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.recipes r
    JOIN public.products p ON p.id = r.product_id
    WHERE r.id = recipe_packaging_lines.recipe_id
      AND (has_position_in_entity(p.legal_entity_id) OR is_platform_admin())
  ));

CREATE POLICY rpl_write ON public.recipe_packaging_lines
  FOR ALL TO authenticated
  USING (
    has_app_write_access('varer') AND EXISTS (
      SELECT 1 FROM public.recipes r
      JOIN public.products p ON p.id = r.product_id
      WHERE r.id = recipe_packaging_lines.recipe_id
        AND has_position_in_entity(p.legal_entity_id)
    )
  )
  WITH CHECK (
    has_app_write_access('varer') AND EXISTS (
      SELECT 1 FROM public.recipes r
      JOIN public.products p ON p.id = r.product_id
      WHERE r.id = recipe_packaging_lines.recipe_id
        AND has_position_in_entity(p.legal_entity_id)
    )
  );

-- 3) Product recipe links: scope via product
DROP POLICY IF EXISTS prl_select ON public.product_recipe_links;
DROP POLICY IF EXISTS prl_write ON public.product_recipe_links;

CREATE POLICY prl_select ON public.product_recipe_links
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_recipe_links.product_id
      AND (has_position_in_entity(p.legal_entity_id) OR is_platform_admin())
  ));

CREATE POLICY prl_write ON public.product_recipe_links
  FOR ALL TO authenticated
  USING (
    has_app_write_access('varer') AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_recipe_links.product_id
        AND has_position_in_entity(p.legal_entity_id)
    )
  )
  WITH CHECK (
    has_app_write_access('varer') AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_recipe_links.product_id
        AND has_position_in_entity(p.legal_entity_id)
    )
  );

-- 4) Raw material components: scope via parent raw material
DROP POLICY IF EXISTS rmc_select ON public.raw_material_components;
DROP POLICY IF EXISTS rmc_write ON public.raw_material_components;

CREATE POLICY rmc_select ON public.raw_material_components
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.raw_materials rm
    WHERE rm.id = raw_material_components.parent_raw_material_id
      AND (has_position_in_entity(rm.legal_entity_id) OR is_platform_admin())
  ));

CREATE POLICY rmc_write ON public.raw_material_components
  FOR ALL TO authenticated
  USING (
    has_app_write_access('varer') AND EXISTS (
      SELECT 1 FROM public.raw_materials rm
      WHERE rm.id = raw_material_components.parent_raw_material_id
        AND has_position_in_entity(rm.legal_entity_id)
    )
  )
  WITH CHECK (
    has_app_write_access('varer') AND EXISTS (
      SELECT 1 FROM public.raw_materials rm
      WHERE rm.id = raw_material_components.parent_raw_material_id
        AND has_position_in_entity(rm.legal_entity_id)
    )
  );

-- 5) Recipe grain score: scope via product_recipe_link -> product
DROP POLICY IF EXISTS rgs_select ON public.recipe_grain_score;
DROP POLICY IF EXISTS rgs_write ON public.recipe_grain_score;

CREATE POLICY rgs_select ON public.recipe_grain_score
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.product_recipe_links prl
    JOIN public.products p ON p.id = prl.product_id
    WHERE prl.id = recipe_grain_score.product_recipe_link_id
      AND (has_position_in_entity(p.legal_entity_id) OR is_platform_admin())
  ));

CREATE POLICY rgs_write ON public.recipe_grain_score
  FOR ALL TO authenticated
  USING (
    has_app_write_access('varer') AND EXISTS (
      SELECT 1 FROM public.product_recipe_links prl
      JOIN public.products p ON p.id = prl.product_id
      WHERE prl.id = recipe_grain_score.product_recipe_link_id
        AND has_position_in_entity(p.legal_entity_id)
    )
  )
  WITH CHECK (
    has_app_write_access('varer') AND EXISTS (
      SELECT 1 FROM public.product_recipe_links prl
      JOIN public.products p ON p.id = prl.product_id
      WHERE prl.id = recipe_grain_score.product_recipe_link_id
        AND has_position_in_entity(p.legal_entity_id)
    )
  );

-- 6) Product declaration overrides: scope via product_recipe_link -> product
DROP POLICY IF EXISTS pdo_select ON public.product_declaration_overrides;
DROP POLICY IF EXISTS pdo_write ON public.product_declaration_overrides;

CREATE POLICY pdo_select ON public.product_declaration_overrides
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.product_recipe_links prl
    JOIN public.products p ON p.id = prl.product_id
    WHERE prl.id = product_declaration_overrides.product_recipe_link_id
      AND (has_position_in_entity(p.legal_entity_id) OR is_platform_admin())
  ));

CREATE POLICY pdo_write ON public.product_declaration_overrides
  FOR ALL TO authenticated
  USING (
    has_app_write_access('varer') AND EXISTS (
      SELECT 1 FROM public.product_recipe_links prl
      JOIN public.products p ON p.id = prl.product_id
      WHERE prl.id = product_declaration_overrides.product_recipe_link_id
        AND has_position_in_entity(p.legal_entity_id)
    )
  )
  WITH CHECK (
    has_app_write_access('varer') AND EXISTS (
      SELECT 1 FROM public.product_recipe_links prl
      JOIN public.products p ON p.id = prl.product_id
      WHERE prl.id = product_declaration_overrides.product_recipe_link_id
        AND has_position_in_entity(p.legal_entity_id)
    )
  );

-- 7) Recipe parts: explicitly target authenticated role
ALTER POLICY recipe_parts_select_in_entity ON public.recipe_parts TO authenticated;
ALTER POLICY recipe_parts_insert_write ON public.recipe_parts TO authenticated;
ALTER POLICY recipe_parts_update_write ON public.recipe_parts TO authenticated;
ALTER POLICY recipe_parts_delete_write ON public.recipe_parts TO authenticated;
