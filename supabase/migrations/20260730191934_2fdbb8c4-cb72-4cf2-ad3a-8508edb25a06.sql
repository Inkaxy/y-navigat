-- Felles, atomisk "erstatt underrader"-funksjon.
-- SECURITY INVOKER: kjører med kallerens rettigheter, så RLS gjelder som før.
-- Delete + insert skjer i én transaksjon (funksjonskallet), slik at en feil
-- i innleggingen ruller tilbake slettingen.
CREATE OR REPLACE FUNCTION public.replace_child_rows(
  p_table text,
  p_parent_column text,
  p_parent_id uuid,
  p_rows jsonb DEFAULT '[]'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_allowed CONSTANT text[] := ARRAY[
    'order_lines:order_id',
    'invoice_lines:invoice_id',
    'recurring_order_items:schedule_id',
    'recipe_lines:recipe_id',
    'recipe_lines:recipe_part_id',
    'recipe_labor_lines:recipe_id',
    'recipe_packaging_lines:recipe_id',
    'negotiation_items:negotiation_id',
    'negotiation_recipients:negotiation_id',
    'pos_terminal_printers:terminal_id',
    'pos_keypad_buttons:page_id',
    'pos_keypad_pages:layout_id',
    'customer_group_members:group_id',
    'customer_profile_price_lists:customer_profile_id',
    'cake_steps:cake_category_id'
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

  -- Kolonnene som faktisk finnes i payloaden OG i tabellen. Kolonner som ikke
  -- er med beholder sine defaults (id, created_at, ...).
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
$$;

REVOKE ALL ON FUNCTION public.replace_child_rows(text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_child_rows(text, text, uuid, jsonb) TO authenticated, service_role;