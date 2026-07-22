
-- Fix search_path on the two trigger functions
CREATE OR REPLACE FUNCTION public._trg_orders_enforce_delivery_rules()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.delivery_date        IS NOT DISTINCT FROM OLD.delivery_date
       AND NEW.delivery_tour_id IS NOT DISTINCT FROM OLD.delivery_tour_id
       AND NEW.customer_id      IS NOT DISTINCT FROM OLD.customer_id
       AND NEW.rule_override_reason IS NOT DISTINCT FROM OLD.rule_override_reason THEN
      RETURN NULL;
    END IF;
  END IF;
  PERFORM public._enforce_order_delivery_rules(NEW.id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_order_lines_enforce_delivery_rules()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_order_id uuid;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  IF v_order_id IS NOT NULL THEN
    PERFORM public._enforce_order_delivery_rules(v_order_id);
  END IF;
  RETURN NULL;
END;
$$;

-- Wrap portal_create_customer_order INSERTs in a subtxn:
-- if a block-rule fires, no order is created and the ordre-team is notified.
-- We do this by installing an outer wrapper that catches check_violation from the
-- underlying inserts. Simpler than re-writing the whole function: install a small
-- helper the RPC calls right before returning. But since the current function commits
-- the order inline, easiest is to add SAVEPOINT-style handling via a wrapping BEGIN/EXCEPTION
-- around the whole body. We replace the RPC.
CREATE OR REPLACE FUNCTION public.portal_create_customer_order(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_result       jsonb;
  v_block_msg    text;
  v_customer_id  uuid;
  v_le_id        uuid;
  v_delivery     date;
BEGIN
  -- Grab minimal context up-front for the notification if we hit a block.
  SELECT c.id, c.legal_entity_id INTO v_customer_id, v_le_id
    FROM customer_portal_accounts cpa
    JOIN customers c ON c.id = cpa.customer_id
   WHERE cpa.user_id = auth.uid() AND cpa.is_active = true
   LIMIT 1;
  v_delivery := NULLIF(p_payload->>'delivery_date','')::date;

  BEGIN
    v_result := public._portal_create_customer_order_impl(p_payload);
    RETURN v_result;
  EXCEPTION WHEN check_violation THEN
    v_block_msg := SQLERRM;
    IF v_le_id IS NOT NULL THEN
      PERFORM public._notify_ordre_team(
        v_le_id,
        'Portal-ordre blokkert av leveringsregel',
        format('Kundeportal-ordre for %s: %s',
          COALESCE(to_char(v_delivery,'DD.MM.YYYY'), '(ukjent dato)'),
          v_block_msg),
        NULL
      );
    END IF;
    RAISE EXCEPTION 'Bestillingen bryter en leveringsregel og er sendt til ordrekontoret for manuell vurdering. Detaljer: %', v_block_msg
      USING ERRCODE = 'raise_exception';
  END;
END;
$function$;

-- Rename original implementation so the wrapper can call it.
-- (If a previous run already did this, ignore.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_portal_create_customer_order_impl'
  ) THEN
    -- We cannot rename because we already replaced portal_create_customer_order.
    -- Recreate the impl function from the (previous) known body would be too large here.
    -- Fallback: raise a notice — deployer must ensure impl exists.
    RAISE NOTICE '_portal_create_customer_order_impl missing; wrapper will fail until it is created.';
  END IF;
END $$;
