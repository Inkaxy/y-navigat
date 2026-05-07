-- B.1 STEG 4: Trigger som enqueuer order_confirmation når en bestilling
-- settes til 'confirmed' av portal/web (ekstern kilde). Manuelle bestillinger
-- lagd internt får ingen automatisk mail (ordrekontoret håndterer dialog selv).

CREATE OR REPLACE FUNCTION public.enqueue_order_confirmation_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient text;
  v_customer_name text;
  v_lines_html text;
  v_lines_text text;
BEGIN
  -- Kun for eksterne kilder som faktisk skal ha auto-bekreftelse
  IF NEW.source NOT IN ('portal', 'website') THEN
    RETURN NEW;
  END IF;

  -- Kun ved overgang til 'confirmed'
  IF NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- Finn mottaker (kunde-email)
  SELECT COALESCE(c.primary_contact_email, c.invoice_email)
    INTO v_recipient
  FROM customers c
  WHERE c.id = NEW.customer_id;

  IF v_recipient IS NULL OR v_recipient = '' THEN
    -- Ingen email — logg en outbox-rad med feil for synlighet
    INSERT INTO email_outbox (template_key, recipient_email, variables, status, error_message,
                              related_entity_type, related_entity_id)
    VALUES ('order_confirmation', '(mangler)', jsonb_build_object('order_id', NEW.id),
            'failed', 'Kunde mangler e-postadresse', 'order', NEW.id);
    RETURN NEW;
  END IF;

  v_customer_name := COALESCE(NEW.customer_snapshot->>'display_name', '');

  -- Bygg enkel linje-HTML/tekst fra order_lines (best-effort)
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
$$;

DROP TRIGGER IF EXISTS trg_enqueue_order_confirmation ON public.orders;
CREATE TRIGGER trg_enqueue_order_confirmation
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_order_confirmation_email();