-- 1) Linjesummer beregnes alltid i databasen
CREATE OR REPLACE FUNCTION public._calc_order_line_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_qty numeric := COALESCE(NEW.quantity, 0);
  v_price numeric := COALESCE(NEW.unit_price, 0);
  v_disc numeric := COALESCE(NEW.discount_percent, 0);
  v_vat numeric := COALESCE(NEW.vat_rate, 0);
  v_sub numeric;
BEGIN
  v_sub := ROUND(v_qty * v_price * (1 - v_disc / 100.0), 2);
  NEW.line_subtotal_excl_vat := v_sub;
  NEW.line_vat := ROUND(v_sub * (CASE WHEN v_vat > 1 THEN v_vat / 100.0 ELSE v_vat END), 2);
  NEW.line_total_incl_vat := NEW.line_subtotal_excl_vat + NEW.line_vat;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calc_order_line_totals ON public.order_lines;
CREATE TRIGGER calc_order_line_totals
BEFORE INSERT OR UPDATE ON public.order_lines
FOR EACH ROW EXECUTE FUNCTION public._calc_order_line_totals();

UPDATE public.order_lines SET quantity = quantity
WHERE line_subtotal_excl_vat IS DISTINCT FROM
      ROUND(COALESCE(quantity,0) * COALESCE(unit_price,0) * (1 - COALESCE(discount_percent,0)/100.0), 2);

-- 2) Pakkeinnhold i replace_child_rows-allowlisten
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

-- 3) Godkjenning/utbetaling av tilbakebetaling på serversiden
CREATE OR REPLACE FUNCTION public.approve_refund(p_refund_id uuid)
RETURNS public.refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.refunds;
BEGIN
  IF public.app_access_level('ordre') NOT IN ('approve','admin') THEN
    RAISE EXCEPTION 'Du har ikke godkjenningstilgang for tilbakebetalinger'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tilbakebetalingen finnes ikke';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.current_user_entity_ids() e WHERE e = v_row.legal_entity_id) THEN
    RAISE EXCEPTION 'Ingen tilgang til dette selskapet' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Kan bare godkjenne tilbakebetalinger som venter (status: %)', v_row.status;
  END IF;

  UPDATE public.refunds
     SET status = 'approved', approved_at = now(), approved_by = auth.uid()
   WHERE id = p_refund_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_refund_paid(p_refund_id uuid)
RETURNS public.refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.refunds;
BEGIN
  IF public.app_access_level('ordre') NOT IN ('write','approve','admin') THEN
    RAISE EXCEPTION 'Du har ikke tilgang til å markere tilbakebetalinger som utbetalt'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tilbakebetalingen finnes ikke';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.current_user_entity_ids() e WHERE e = v_row.legal_entity_id) THEN
    RAISE EXCEPTION 'Ingen tilgang til dette selskapet' USING ERRCODE = '42501';
  END IF;
  IF v_row.status = 'paid' THEN
    RETURN v_row;
  END IF;
  IF v_row.requires_approval AND v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'Tilbakebetalingen må godkjennes før utbetaling';
  END IF;
  IF v_row.status NOT IN ('pending','approved') THEN
    RAISE EXCEPTION 'Ugyldig status for utbetaling: %', v_row.status;
  END IF;

  UPDATE public.refunds
     SET status = 'paid', paid_at = now(), paid_by = auth.uid()
   WHERE id = p_refund_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_refund(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_refund_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_refund(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_refund_paid(uuid) TO authenticated;