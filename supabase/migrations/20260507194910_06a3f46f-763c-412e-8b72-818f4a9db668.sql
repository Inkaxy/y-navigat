
-- 1) source_external_id + unique index
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS source_external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_source_external_id_unique
  ON public.orders (source, source_external_id)
  WHERE source_external_id IS NOT NULL;

-- 2) email_outbox
CREATE TABLE IF NOT EXISTS public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  recipient_email text NOT NULL,
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  error_message text,
  related_entity_type text,
  related_entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('pending','sending','sent','failed'))
);

CREATE INDEX IF NOT EXISTS email_outbox_pending_idx
  ON public.email_outbox (created_at)
  WHERE status IN ('pending','failed');

CREATE INDEX IF NOT EXISTS email_outbox_related_idx
  ON public.email_outbox (related_entity_type, related_entity_id);

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS implicitly; expose read-only to authenticated for UI status.
CREATE POLICY "Authenticated can read email_outbox"
  ON public.email_outbox FOR SELECT
  TO authenticated
  USING (true);

-- 3) validate_order_delivery_rules
CREATE OR REPLACE FUNCTION public.validate_order_delivery_rules(
  p_legal_entity_id uuid,
  p_customer_id uuid,
  p_delivery_date date,
  p_delivery_tour_id uuid DEFAULT NULL,
  p_product_ids uuid[] DEFAULT NULL,
  p_ordered_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_broken text[] := ARRAY[]::text[];
  v_rule record;
  v_iso_dow smallint := EXTRACT(ISODOW FROM p_delivery_date)::smallint;
  v_deadline_ts timestamptz;
  v_pause record;
  v_tour_number text;
BEGIN
  IF p_delivery_tour_id IS NOT NULL THEN
    SELECT tour_number INTO v_tour_number FROM delivery_tours WHERE id = p_delivery_tour_id;
  END IF;

  -- Deadline rules
  FOR v_rule IN
    SELECT * FROM delivery_rules
    WHERE legal_entity_id = p_legal_entity_id
      AND is_active = true
      AND rule_type = 'order_deadline'
      AND valid_from <= p_delivery_date
      AND (valid_until IS NULL OR valid_until >= p_delivery_date)
      AND (weekdays IS NULL OR array_length(weekdays,1) IS NULL OR v_iso_dow = ANY(weekdays))
      AND (customer_ids IS NULL OR array_length(customer_ids,1) IS NULL OR p_customer_id = ANY(customer_ids))
      AND (
        product_ids IS NULL OR array_length(product_ids,1) IS NULL
        OR (p_product_ids IS NOT NULL AND p_product_ids && product_ids)
      )
      AND (
        tour_filter IS NULL OR array_length(tour_filter,1) IS NULL
        OR (v_tour_number IS NOT NULL AND v_tour_number = ANY(tour_filter))
      )
  LOOP
    v_deadline_ts := ((p_delivery_date - v_rule.deadline_days_before) + v_rule.deadline_time)::timestamptz;
    IF p_ordered_at > v_deadline_ts THEN
      v_broken := v_broken || format(
        'Bryter ordrefrist "%s": måtte bestilles innen %s %s',
        v_rule.name,
        to_char(v_deadline_ts, 'DD.MM.YYYY'),
        to_char(v_deadline_ts, 'HH24:MI')
      );
    END IF;
  END LOOP;

  -- Delivery pauses
  FOR v_pause IN
    SELECT * FROM delivery_pauses
    WHERE legal_entity_id = p_legal_entity_id
      AND customer_id = p_customer_id
      AND p_delivery_date BETWEEN pause_from AND pause_to
      AND (
        tour_filter IS NULL OR array_length(tour_filter,1) IS NULL
        OR (v_tour_number IS NOT NULL AND v_tour_number = ANY(tour_filter))
      )
  LOOP
    v_broken := v_broken || format(
      'Kunde har leveransepause %s–%s%s',
      to_char(v_pause.pause_from, 'DD.MM.YYYY'),
      to_char(v_pause.pause_to, 'DD.MM.YYYY'),
      CASE WHEN v_pause.reason IS NOT NULL THEN ' (' || v_pause.reason || ')' ELSE '' END
    );
  END LOOP;

  RETURN jsonb_build_object(
    'passes', array_length(v_broken,1) IS NULL,
    'broken_rules', to_jsonb(v_broken)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_order_delivery_rules(uuid,uuid,date,uuid,uuid[],timestamptz) TO authenticated, service_role;
