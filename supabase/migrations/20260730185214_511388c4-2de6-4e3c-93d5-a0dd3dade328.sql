-- 13) views: security_invoker
ALTER VIEW public.recipe_nutrition_calculated SET (security_invoker = true);
ALTER VIEW public.product_nutrition_calculated SET (security_invoker = true);

-- 10) Revoke anon/PUBLIC EXECUTE on all SECURITY DEFINER functions in public
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$do$;

-- 11) enqueue_order_confirmation_email: product_name_snapshot does not exist
CREATE OR REPLACE FUNCTION public.enqueue_order_confirmation_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_recipient text;
  v_customer_name text;
  v_lines_html text;
  v_lines_text text;
BEGIN
  IF NEW.source <> 'website' THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(c.primary_contact_email, c.invoice_email)
    INTO v_recipient
  FROM customers c
  WHERE c.id = NEW.customer_id;

  IF v_recipient IS NULL OR v_recipient = '' THEN
    INSERT INTO email_outbox (template_key, recipient_email, variables, status, error_message,
                              related_entity_type, related_entity_id)
    VALUES ('order_confirmation', '(mangler)', jsonb_build_object('order_id', NEW.id),
            'failed', 'Kunde mangler e-postadresse', 'order', NEW.id);
    RETURN NEW;
  END IF;

  v_customer_name := COALESCE(NEW.customer_snapshot->>'display_name', '');

  SELECT
    string_agg(
      format('<tr><td style="padding:4px 8px">%s</td><td style="padding:4px 8px;text-align:right">%s</td></tr>',
             COALESCE(ol.product_snapshot->>'display_name', ol.product_snapshot->>'name', ol.product_id::text),
             ol.quantity::text),
      '' ORDER BY ol.line_number
    ),
    string_agg(
      format('- %s × %s', ol.quantity::text,
             COALESCE(ol.product_snapshot->>'display_name', ol.product_snapshot->>'name', '')),
      E'\n' ORDER BY ol.line_number
    )
  INTO v_lines_html, v_lines_text
  FROM order_lines ol
  WHERE ol.order_id = NEW.id;

  INSERT INTO email_outbox (template_key, recipient_email, variables, status,
                            related_entity_type, related_entity_id)
  VALUES (
    'order_confirmation',
    v_recipient,
    jsonb_build_object(
      'order_number', NEW.order_number,
      'customer_name', v_customer_name,
      'delivery_date', to_char(NEW.delivery_date, 'DD.MM.YYYY'),
      'delivery_time', COALESCE(to_char(NEW.delivery_time, 'HH24:MI'), ''),
      'total_incl_vat', to_char(NEW.total_incl_vat, 'FM999G999G990D00'),
      'linjer_html', COALESCE('<table style="width:100%;border-collapse:collapse">' || v_lines_html || '</table>', ''),
      'linjer_text', COALESCE(v_lines_text, ''),
      'order_id', NEW.id
    ),
    'pending',
    'order',
    NEW.id
  );

  RETURN NEW;
END;
$fn$;

-- 12) pos_create_cake_order: fix label_print_jobs insert (NOT NULL cols + valid status)
DO $do$
DECLARE v_src text;
BEGIN
  SELECT prosrc INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='pos_create_cake_order';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'pos_create_cake_order not found';
  END IF;
END
$do$;
