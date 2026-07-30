CREATE OR REPLACE FUNCTION public.evaluate_delivery_rules(
  p_legal_entity_id uuid,
  p_customer_id uuid,
  p_customer_group_ids uuid[],
  p_delivery_date date,
  p_delivery_tour_id uuid,
  p_product_ids uuid[],
  p_product_group_ids uuid[],
  p_ordered_at timestamp with time zone DEFAULT now(),
  p_existing_order_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(rule_id uuid, rule_name text, rule_type text, effect text, priority integer, matched boolean, message text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
          -- Per vare: varen må enten være eksplisitt tillatt, eller selv tilhøre
          -- en tillatt varegruppe. (Tidligere ble ordrens SAMLEDE gruppeliste
          -- sjekket, slik at én tillatt vare "reddet" alle de andre.)
          (p_product_ids IS NOT NULL AND array_length(p_product_ids, 1) IS NOT NULL
           AND (s.allowed_product_ids IS NOT NULL OR s.allowed_product_group_ids IS NOT NULL)
           AND EXISTS (
             SELECT 1
             FROM unnest(p_product_ids) AS pid
             WHERE NOT (
               (s.allowed_product_ids IS NOT NULL AND pid = ANY(s.allowed_product_ids))
               OR (s.allowed_product_group_ids IS NOT NULL
                   AND EXISTS (
                     SELECT 1 FROM public.product_sales_groups psg
                     WHERE psg.product_id = pid
                       AND psg.sales_group_id = ANY(s.allowed_product_group_ids)
                   ))
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
    r.id AS rule_id,
    r.name AS rule_name,
    r.rule_type,
    r.effect,
    r.priority,
    TRUE AS matched,
    format('Regelen «%s» tillater kun leveringsdager: %s.',
      r.name,
      array_to_string(
        ARRAY(
          SELECT CASE d
            WHEN 1 THEN 'mandag' WHEN 2 THEN 'tirsdag' WHEN 3 THEN 'onsdag'
            WHEN 4 THEN 'torsdag' WHEN 5 THEN 'fredag' WHEN 6 THEN 'lørdag'
            WHEN 7 THEN 'søndag' END
          FROM unnest(r.weekdays) d
        ), ', '
      )
    ) AS message
  FROM public.delivery_rules r
  WHERE r.is_active
    AND r.legal_entity_id = p_legal_entity_id
    AND r.enforce_weekdays IS TRUE
    AND r.weekdays IS NOT NULL AND array_length(r.weekdays, 1) > 0
    AND r.rule_type IN ('order_deadline','available_tours','available_products')
    AND p_delivery_date IS NOT NULL
    AND v_dow IS NOT NULL
    AND NOT (v_dow = ANY(r.weekdays))
    AND p_delivery_date >= r.valid_from
    AND (r.valid_until IS NULL OR p_delivery_date <= r.valid_until)
    AND (r.customer_ids IS NULL OR array_length(r.customer_ids, 1) IS NULL
         OR (p_customer_id IS NOT NULL AND p_customer_id = ANY(r.customer_ids)))
    AND (r.customer_group_ids IS NULL OR array_length(r.customer_group_ids, 1) IS NULL
         OR (p_customer_group_ids IS NOT NULL AND r.customer_group_ids && p_customer_group_ids))
    AND (r.specific_delivery_date IS NULL OR r.specific_delivery_date = p_delivery_date)
    AND (r.rule_type = 'available_tours'
         OR r.tour_filter IS NULL OR array_length(r.tour_filter, 1) IS NULL
         OR (p_delivery_tour_id IS NOT NULL AND p_delivery_tour_id = ANY(r.tour_filter)))
    AND (
      r.rule_type = 'available_products'
      OR (
        (r.product_ids IS NULL OR array_length(r.product_ids, 1) IS NULL
         OR (p_product_ids IS NOT NULL AND r.product_ids && p_product_ids))
        AND
        (r.product_group_ids IS NULL OR array_length(r.product_group_ids, 1) IS NULL
         OR (p_product_group_ids IS NOT NULL AND r.product_group_ids && p_product_group_ids))
      )
    )
    AND (
      r.rule_type <> 'available_products'
      OR (
        p_product_ids IS NOT NULL AND (
          (r.allowed_product_ids IS NOT NULL AND r.allowed_product_ids && p_product_ids)
          OR (r.allowed_product_group_ids IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM public.product_sales_groups psg
                WHERE psg.product_id = ANY(p_product_ids)
                  AND psg.sales_group_id = ANY(r.allowed_product_group_ids)
              ))
        )
      )
    )

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
$function$;

REVOKE EXECUTE ON FUNCTION public.evaluate_delivery_rules(uuid,uuid,uuid[],date,uuid,uuid[],uuid[],timestamptz,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evaluate_delivery_rules(uuid,uuid,uuid[],date,uuid,uuid[],uuid[],timestamptz,uuid) TO authenticated, service_role;