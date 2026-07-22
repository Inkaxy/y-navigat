
ALTER TABLE public.delivery_rules
  ADD COLUMN IF NOT EXISTS effect text NOT NULL DEFAULT 'block'
    CHECK (effect IN ('block','warn','info')),
  ADD COLUMN IF NOT EXISTS priority int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allowed_product_ids uuid[],
  ADD COLUMN IF NOT EXISTS allowed_product_group_ids uuid[];

UPDATE public.delivery_rules SET effect = 'warn' WHERE rule_type = 'order_deadline' AND effect = 'block';

UPDATE public.delivery_rules
SET allowed_product_ids = product_ids,
    allowed_product_group_ids = product_group_ids,
    product_ids = NULL,
    product_group_ids = NULL
WHERE rule_type = 'available_products'
  AND (product_ids IS NOT NULL OR product_group_ids IS NOT NULL);

CREATE OR REPLACE FUNCTION public.evaluate_delivery_rules(
  p_legal_entity_id uuid,
  p_customer_id uuid,
  p_customer_group_ids uuid[],
  p_delivery_date date,
  p_delivery_tour_id uuid,
  p_product_ids uuid[],
  p_product_group_ids uuid[],
  p_ordered_at timestamptz DEFAULT now(),
  p_existing_order_id uuid DEFAULT NULL
) RETURNS TABLE(
  rule_id uuid,
  rule_name text,
  rule_type text,
  effect text,
  priority int,
  matched boolean,
  message text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_dow int;
BEGIN
  IF p_delivery_date IS NOT NULL THEN
    v_dow := EXTRACT(ISODOW FROM p_delivery_date)::int;
  END IF;

  RETURN QUERY
  WITH scoped AS (
    SELECT r.*
    FROM public.delivery_rules r
    WHERE r.is_active
      AND r.legal_entity_id = p_legal_entity_id
      AND (p_delivery_date IS NULL OR p_delivery_date >= r.valid_from)
      AND (p_delivery_date IS NULL OR r.valid_until IS NULL OR p_delivery_date <= r.valid_until)
      AND (r.customer_ids IS NULL OR array_length(r.customer_ids, 1) IS NULL
           OR (p_customer_id IS NOT NULL AND p_customer_id = ANY(r.customer_ids)))
      AND (r.customer_group_ids IS NULL OR array_length(r.customer_group_ids, 1) IS NULL
           OR (p_customer_group_ids IS NOT NULL AND r.customer_group_ids && p_customer_group_ids))
      AND (r.specific_delivery_date IS NULL OR r.specific_delivery_date = p_delivery_date)
      AND (r.rule_type = 'delivery_weekdays'
           OR r.weekdays IS NULL OR array_length(r.weekdays, 1) IS NULL
           OR (v_dow IS NOT NULL AND v_dow = ANY(r.weekdays)))
      AND (r.rule_type = 'available_tours'
           OR r.tour_filter IS NULL OR array_length(r.tour_filter, 1) IS NULL
           OR (p_delivery_tour_id IS NOT NULL AND p_delivery_tour_id = ANY(r.tour_filter)))
      AND (r.rule_type = 'available_products'
           OR (
             (r.product_ids IS NULL OR array_length(r.product_ids, 1) IS NULL
              OR (p_product_ids IS NOT NULL AND r.product_ids && p_product_ids))
             AND
             (r.product_group_ids IS NULL OR array_length(r.product_group_ids, 1) IS NULL
              OR (p_product_group_ids IS NOT NULL AND r.product_group_ids && p_product_group_ids))
           ))
  ),
  evaluated AS (
    SELECT
      s.id AS rule_id,
      s.name AS rule_name,
      s.rule_type,
      s.effect,
      s.priority,
      CASE s.rule_type
        WHEN 'no_delivery' THEN
          (p_delivery_date IS NOT NULL
           AND s.blackout_from IS NOT NULL AND s.blackout_until IS NOT NULL
           AND p_delivery_date >= s.blackout_from
           AND p_delivery_date <= s.blackout_until)
        WHEN 'delivery_weekdays' THEN
          (p_delivery_date IS NOT NULL
           AND s.weekdays IS NOT NULL AND array_length(s.weekdays, 1) IS NOT NULL
           AND NOT (v_dow = ANY(s.weekdays)))
        WHEN 'available_tours' THEN
          (s.tour_filter IS NOT NULL AND array_length(s.tour_filter, 1) IS NOT NULL
           AND p_delivery_tour_id IS NOT NULL
           AND NOT (p_delivery_tour_id = ANY(s.tour_filter)))
        WHEN 'available_products' THEN
          (p_product_ids IS NOT NULL AND array_length(p_product_ids, 1) IS NOT NULL
           AND (s.allowed_product_ids IS NOT NULL OR s.allowed_product_group_ids IS NOT NULL)
           AND EXISTS (
             SELECT 1
             FROM unnest(p_product_ids) AS pid
             WHERE NOT (
               (s.allowed_product_ids IS NOT NULL AND pid = ANY(s.allowed_product_ids))
               OR (s.allowed_product_group_ids IS NOT NULL
                   AND p_product_group_ids IS NOT NULL
                   AND s.allowed_product_group_ids && p_product_group_ids)
             )
           ))
        WHEN 'order_deadline' THEN
          (p_delivery_date IS NOT NULL
           AND s.deadline_time IS NOT NULL AND s.deadline_days_before IS NOT NULL
           AND p_ordered_at > (
             ((p_delivery_date - s.deadline_days_before) + s.deadline_time)
               AT TIME ZONE 'Europe/Oslo'
           ))
        ELSE FALSE
      END AS matched,
      CASE s.rule_type
        WHEN 'no_delivery' THEN
          format('Ingen leveranse i perioden %s – %s.', s.blackout_from, s.blackout_until)
        WHEN 'delivery_weekdays' THEN
          'Vi leverer ikke denne ukedagen.'
        WHEN 'available_tours' THEN
          'Valgt tur er ikke tilgjengelig for denne ordren.'
        WHEN 'available_products' THEN
          'En eller flere varer er ikke tilgjengelig for bestilling.'
        WHEN 'order_deadline' THEN
          format('Ordrefrist passert (kl %s, %s dag(er) før leveranse).',
            to_char(s.deadline_time, 'HH24:MI'), s.deadline_days_before)
        ELSE ''
      END AS message
    FROM scoped s
  )
  SELECT e.rule_id, e.rule_name, e.rule_type, e.effect, e.priority,
    (e.matched AND e.priority = MAX(CASE WHEN e.matched THEN e.priority END)
      OVER (PARTITION BY e.rule_type)) AS matched,
    e.message
  FROM evaluated e

  UNION ALL

  SELECT
    dp.id AS rule_id,
    ('Leveringspause' || COALESCE(': ' || dp.reason, '')) AS rule_name,
    'delivery_pause'::text AS rule_type,
    'block'::text AS effect,
    0 AS priority,
    (p_delivery_date IS NOT NULL
     AND p_delivery_date >= dp.pause_from
     AND p_delivery_date <= dp.pause_to
     AND (dp.tour_filter IS NULL OR array_length(dp.tour_filter, 1) IS NULL
          OR (p_delivery_tour_id IS NOT NULL AND p_delivery_tour_id = ANY(dp.tour_filter)))
    ) AS matched,
    format('Leveringspause %s – %s%s',
      dp.pause_from, dp.pause_to,
      CASE WHEN dp.reason IS NOT NULL AND dp.reason <> '' THEN ' (' || dp.reason || ')' ELSE '' END
    ) AS message
  FROM public.delivery_pauses dp
  WHERE dp.legal_entity_id = p_legal_entity_id
    AND (dp.customer_id IS NULL OR dp.customer_id = p_customer_id);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.evaluate_delivery_rules(
  uuid, uuid, uuid[], date, uuid, uuid[], uuid[], timestamptz, uuid
) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.check_order_deadline_violations(
  uuid, uuid, date, uuid, uuid[], uuid[]
);

CREATE OR REPLACE FUNCTION public.check_order_deadline_violations(
  p_legal_entity_id uuid,
  p_customer_id uuid,
  p_delivery_date date,
  p_delivery_tour_id uuid DEFAULT NULL,
  p_product_ids uuid[] DEFAULT NULL,
  p_product_group_ids uuid[] DEFAULT NULL
) RETURNS TABLE(
  rule_id uuid,
  rule_name text,
  deadline_timestamp timestamptz,
  is_passed boolean,
  minutes_over int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_customer_group_ids uuid[];
BEGIN
  SELECT COALESCE(array_agg(cgm.group_id), ARRAY[]::uuid[])
    INTO v_customer_group_ids
  FROM public.customer_group_members cgm
  WHERE cgm.customer_id = p_customer_id;

  RETURN QUERY
  SELECT
    r.id,
    r.name,
    (((p_delivery_date - r.deadline_days_before) + r.deadline_time) AT TIME ZONE 'Europe/Oslo'),
    (now() > (((p_delivery_date - r.deadline_days_before) + r.deadline_time) AT TIME ZONE 'Europe/Oslo')),
    GREATEST(0, EXTRACT(EPOCH FROM (now() - (((p_delivery_date - r.deadline_days_before) + r.deadline_time) AT TIME ZONE 'Europe/Oslo'))) / 60)::int
  FROM public.delivery_rules r
  WHERE r.is_active
    AND r.rule_type = 'order_deadline'
    AND r.legal_entity_id = p_legal_entity_id
    AND r.deadline_time IS NOT NULL
    AND r.deadline_days_before IS NOT NULL
    AND p_delivery_date >= r.valid_from
    AND (r.valid_until IS NULL OR p_delivery_date <= r.valid_until)
    AND (r.customer_ids IS NULL OR array_length(r.customer_ids, 1) IS NULL
         OR p_customer_id = ANY(r.customer_ids))
    AND (r.customer_group_ids IS NULL OR array_length(r.customer_group_ids, 1) IS NULL
         OR r.customer_group_ids && v_customer_group_ids)
    AND (r.specific_delivery_date IS NULL OR r.specific_delivery_date = p_delivery_date)
    AND (r.weekdays IS NULL OR array_length(r.weekdays, 1) IS NULL
         OR EXTRACT(ISODOW FROM p_delivery_date)::int = ANY(r.weekdays))
    AND (r.tour_filter IS NULL OR array_length(r.tour_filter, 1) IS NULL
         OR (p_delivery_tour_id IS NOT NULL AND p_delivery_tour_id = ANY(r.tour_filter)))
    AND ((r.product_ids IS NULL OR array_length(r.product_ids, 1) IS NULL
          OR (p_product_ids IS NOT NULL AND r.product_ids && p_product_ids))
         AND (r.product_group_ids IS NULL OR array_length(r.product_group_ids, 1) IS NULL
              OR (p_product_group_ids IS NOT NULL AND r.product_group_ids && p_product_group_ids)))
    AND now() > (((p_delivery_date - r.deadline_days_before) + r.deadline_time) AT TIME ZONE 'Europe/Oslo');
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.check_order_deadline_violations(
  uuid, uuid, date, uuid, uuid[], uuid[]
) TO authenticated, service_role;

DO $$
DECLARE
  v_le uuid;
  v_rule uuid := gen_random_uuid();
  v_matched boolean;
BEGIN
  SELECT id INTO v_le FROM public.legal_entities ORDER BY created_at LIMIT 1;
  IF v_le IS NULL THEN
    RAISE NOTICE 'Ingen legal_entity — hopper over DST-test';
    RETURN;
  END IF;

  INSERT INTO public.delivery_rules(id, legal_entity_id, rule_type, name,
    deadline_time, deadline_days_before, valid_from, is_active, effect, priority)
  VALUES (v_rule, v_le, 'order_deadline', '__dst_test__',
    '10:00'::time, 1, '2026-03-01'::date, true, 'warn', 0);

  SELECT matched INTO v_matched FROM public.evaluate_delivery_rules(
    v_le, NULL, NULL, '2026-03-28'::date, NULL, NULL, NULL,
    '2026-03-27 09:01:00+00'::timestamptz
  ) WHERE rule_type='order_deadline' AND rule_id = v_rule;
  ASSERT v_matched IS TRUE, 'DST-test 1: vintertid, over frist skulle matche';

  SELECT matched INTO v_matched FROM public.evaluate_delivery_rules(
    v_le, NULL, NULL, '2026-03-28'::date, NULL, NULL, NULL,
    '2026-03-27 08:59:00+00'::timestamptz
  ) WHERE rule_type='order_deadline' AND rule_id = v_rule;
  ASSERT v_matched IS FALSE, 'DST-test 2: vintertid, under frist skulle IKKE matche';

  SELECT matched INTO v_matched FROM public.evaluate_delivery_rules(
    v_le, NULL, NULL, '2026-03-30'::date, NULL, NULL, NULL,
    '2026-03-29 08:01:00+00'::timestamptz
  ) WHERE rule_type='order_deadline' AND rule_id = v_rule;
  ASSERT v_matched IS TRUE, 'DST-test 3: sommertid, over frist skulle matche';

  SELECT matched INTO v_matched FROM public.evaluate_delivery_rules(
    v_le, NULL, NULL, '2026-03-30'::date, NULL, NULL, NULL,
    '2026-03-29 07:59:00+00'::timestamptz
  ) WHERE rule_type='order_deadline' AND rule_id = v_rule;
  ASSERT v_matched IS FALSE, 'DST-test 4: sommertid, under frist skulle IKKE matche';

  DELETE FROM public.delivery_rules WHERE id = v_rule;
END $$;
