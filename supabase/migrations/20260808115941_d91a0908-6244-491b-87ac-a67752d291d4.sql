-- Hjelpefunksjoner for oppskriftstilgang (støtter frittstående oppskrifter)
CREATE OR REPLACE FUNCTION public.can_read_recipe(_recipe_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.recipes r
    LEFT JOIN public.products p ON p.id = r.product_id
    WHERE r.id = _recipe_id
      AND (
        public.is_platform_admin()
        OR (p.id IS NOT NULL AND public.has_position_in_entity(p.legal_entity_id))
        OR (r.legal_entity_id IS NOT NULL AND public.has_position_in_entity(r.legal_entity_id))
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_write_recipe(_recipe_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_app_write_access('varer') AND EXISTS (
    SELECT 1 FROM public.recipes r
    LEFT JOIN public.products p ON p.id = r.product_id
    WHERE r.id = _recipe_id
      AND (
        (p.id IS NOT NULL AND public.has_position_in_entity(p.legal_entity_id))
        OR (r.legal_entity_id IS NOT NULL AND public.has_position_in_entity(r.legal_entity_id))
      )
  )
$$;

REVOKE ALL ON FUNCTION public.can_read_recipe(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_write_recipe(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_recipe(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_recipe(uuid) TO authenticated, service_role;

-- recipes: tillat frittstående oppskrifter
DROP POLICY IF EXISTS recipes_select_in_entity ON public.recipes;
DROP POLICY IF EXISTS recipes_insert_write ON public.recipes;
DROP POLICY IF EXISTS recipes_update_write ON public.recipes;
DROP POLICY IF EXISTS recipes_delete_write ON public.recipes;

CREATE POLICY recipes_select_in_entity ON public.recipes FOR SELECT TO authenticated
USING (
  public.is_platform_admin()
  OR EXISTS (SELECT 1 FROM public.products p WHERE p.id = recipes.product_id AND public.has_position_in_entity(p.legal_entity_id))
  OR (recipes.legal_entity_id IS NOT NULL AND public.has_position_in_entity(recipes.legal_entity_id))
);

CREATE POLICY recipes_insert_write ON public.recipes FOR INSERT TO authenticated
WITH CHECK (
  public.has_app_write_access('varer')
  AND (
    EXISTS (SELECT 1 FROM public.products p WHERE p.id = recipes.product_id AND public.has_position_in_entity(p.legal_entity_id))
    OR (recipes.legal_entity_id IS NOT NULL AND public.has_position_in_entity(recipes.legal_entity_id))
  )
);

CREATE POLICY recipes_update_write ON public.recipes FOR UPDATE TO authenticated
USING (
  public.has_app_write_access('varer')
  AND (
    EXISTS (SELECT 1 FROM public.products p WHERE p.id = recipes.product_id AND public.has_position_in_entity(p.legal_entity_id))
    OR (recipes.legal_entity_id IS NOT NULL AND public.has_position_in_entity(recipes.legal_entity_id))
  )
)
WITH CHECK (
  public.has_app_write_access('varer')
  AND (
    EXISTS (SELECT 1 FROM public.products p WHERE p.id = recipes.product_id AND public.has_position_in_entity(p.legal_entity_id))
    OR (recipes.legal_entity_id IS NOT NULL AND public.has_position_in_entity(recipes.legal_entity_id))
  )
);

CREATE POLICY recipes_delete_write ON public.recipes FOR DELETE TO authenticated
USING (
  public.has_app_write_access('varer')
  AND (
    EXISTS (SELECT 1 FROM public.products p WHERE p.id = recipes.product_id AND public.has_position_in_entity(p.legal_entity_id))
    OR (recipes.legal_entity_id IS NOT NULL AND public.has_position_in_entity(recipes.legal_entity_id))
  )
);

-- Barnetabeller via hjelpefunksjoner
DROP POLICY IF EXISTS recipe_parts_select_in_entity ON public.recipe_parts;
DROP POLICY IF EXISTS recipe_parts_insert_write ON public.recipe_parts;
DROP POLICY IF EXISTS recipe_parts_update_write ON public.recipe_parts;
DROP POLICY IF EXISTS recipe_parts_delete_write ON public.recipe_parts;
CREATE POLICY recipe_parts_select_in_entity ON public.recipe_parts FOR SELECT TO authenticated USING (public.can_read_recipe(recipe_id));
CREATE POLICY recipe_parts_insert_write ON public.recipe_parts FOR INSERT TO authenticated WITH CHECK (public.can_write_recipe(recipe_id));
CREATE POLICY recipe_parts_update_write ON public.recipe_parts FOR UPDATE TO authenticated USING (public.can_write_recipe(recipe_id)) WITH CHECK (public.can_write_recipe(recipe_id));
CREATE POLICY recipe_parts_delete_write ON public.recipe_parts FOR DELETE TO authenticated USING (public.can_write_recipe(recipe_id));

DROP POLICY IF EXISTS recipe_lines_select_in_entity ON public.recipe_lines;
DROP POLICY IF EXISTS recipe_lines_insert_write ON public.recipe_lines;
DROP POLICY IF EXISTS recipe_lines_update_write ON public.recipe_lines;
DROP POLICY IF EXISTS recipe_lines_delete_write ON public.recipe_lines;
CREATE POLICY recipe_lines_select_in_entity ON public.recipe_lines FOR SELECT TO authenticated USING (public.can_read_recipe(recipe_id));
CREATE POLICY recipe_lines_insert_write ON public.recipe_lines FOR INSERT TO authenticated WITH CHECK (public.can_write_recipe(recipe_id));
CREATE POLICY recipe_lines_update_write ON public.recipe_lines FOR UPDATE TO authenticated USING (public.can_write_recipe(recipe_id)) WITH CHECK (public.can_write_recipe(recipe_id));
CREATE POLICY recipe_lines_delete_write ON public.recipe_lines FOR DELETE TO authenticated USING (public.can_write_recipe(recipe_id));

DROP POLICY IF EXISTS rll_select ON public.recipe_labor_lines;
DROP POLICY IF EXISTS rll_write ON public.recipe_labor_lines;
CREATE POLICY rll_select ON public.recipe_labor_lines FOR SELECT TO authenticated USING (public.can_read_recipe(recipe_id));
CREATE POLICY rll_write ON public.recipe_labor_lines FOR ALL TO authenticated USING (public.can_write_recipe(recipe_id)) WITH CHECK (public.can_write_recipe(recipe_id));

DROP POLICY IF EXISTS rpl_select ON public.recipe_packaging_lines;
DROP POLICY IF EXISTS rpl_write ON public.recipe_packaging_lines;
CREATE POLICY rpl_select ON public.recipe_packaging_lines FOR SELECT TO authenticated USING (public.can_read_recipe(recipe_id));
CREATE POLICY rpl_write ON public.recipe_packaging_lines FOR ALL TO authenticated USING (public.can_write_recipe(recipe_id)) WITH CHECK (public.can_write_recipe(recipe_id));

-- recipe_steps: stram inn (var reelt åpen for alle innloggede)
DROP POLICY IF EXISTS recipe_steps_select ON public.recipe_steps;
DROP POLICY IF EXISTS recipe_steps_write ON public.recipe_steps;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_steps TO authenticated;
GRANT ALL ON public.recipe_steps TO service_role;
ALTER TABLE public.recipe_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY recipe_steps_select ON public.recipe_steps FOR SELECT TO authenticated USING (public.can_read_recipe(recipe_id));
CREATE POLICY recipe_steps_write ON public.recipe_steps FOR ALL TO authenticated USING (public.can_write_recipe(recipe_id)) WITH CHECK (public.can_write_recipe(recipe_id));

-- replace_child_rows: tillat recipe_steps
CREATE OR REPLACE FUNCTION public.replace_child_rows(p_table text, p_parent_column text, p_parent_id uuid, p_rows jsonb DEFAULT '[]'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_allowed CONSTANT text[] := ARRAY[
    'order_lines:order_id',
    'invoice_lines:invoice_id',
    'recurring_order_items:schedule_id',
    'recipe_lines:recipe_id',
    'recipe_lines:recipe_part_id',
    'recipe_labor_lines:recipe_id',
    'recipe_packaging_lines:recipe_id',
    'recipe_steps:recipe_id',
    'negotiation_items:negotiation_id',
    'negotiation_recipients:negotiation_id',
    'pos_terminal_printers:terminal_id',
    'pos_keypad_buttons:page_id',
    'pos_keypad_pages:layout_id',
    'customer_group_members:group_id',
    'customer_profile_price_lists:customer_profile_id',
    'cake_steps:cake_category_id',
    'product_package_items:package_product_id'
  ];
  v_key text := p_table || ':' || p_parent_column;
  v_cols text;
  v_sel text;
  v_count integer := 0;
BEGIN
  IF NOT (v_key = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'replace_child_rows: ikke tillatt kombinasjon %', v_key
      USING ERRCODE = '42501';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'replace_child_rows: p_rows må være en jsonb-array';
  END IF;

  EXECUTE format('DELETE FROM public.%I WHERE %I = $1', p_table, p_parent_column)
    USING p_parent_id;

  IF jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position),
         string_agg('(r).' || quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
    INTO v_cols, v_sel
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = p_table
    AND c.column_name IN (
      SELECT DISTINCT k FROM jsonb_array_elements(p_rows) e, jsonb_object_keys(e) k
    );

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'replace_child_rows: ingen gyldige kolonner i payload for %', p_table;
  END IF;

  EXECUTE format(
    'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_recordset(null::public.%I, $1) r',
    p_table, v_cols, v_sel, p_table
  ) USING p_rows;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;