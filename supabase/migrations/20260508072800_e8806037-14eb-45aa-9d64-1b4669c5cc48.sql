-- B.1.korr.1: Arkitektur-korreksjon
-- Korreksjon: portal-bestillinger fra innloggede Kundeportal-brukere
-- skal IKKE få bekreftelse-mail. Kunden ser status direkte i portal-UI.
-- Kun anonymous nettside-bestillinger (source='website') trenger mail
-- som kvittering.
CREATE OR REPLACE FUNCTION public.enqueue_order_confirmation_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recipient text;
  v_customer_name text;
  v_lines_html text;
  v_lines_text text;
BEGIN
  -- B.1.korr.1: kun nettside-bestillinger får bekreftelse-mail.
  -- Portal-bestillinger viser status direkte i Kundeportal-UI.
  IF NEW.source <> 'website' THEN
    RETURN NEW;
  END IF;

  -- Kun ved overgang til 'confirmed'
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
             COALESCE(ol.product_name_snapshot, ol.product_id::text),
             ol.quantity::text),
      '' ORDER BY ol.line_number
    ),
    string_agg(
      format('- %s × %s', ol.quantity::text, COALESCE(ol.product_name_snapshot, '')),
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
$function$;