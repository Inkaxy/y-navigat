CREATE OR REPLACE FUNCTION public.assign_label_number(
  p_dept_id uuid,
  p_product_id uuid,
  p_order_line_id uuid,
  p_seq_date date DEFAULT ((now() AT TIME ZONE 'Europe/Oslo'::text))::date
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing text;
  v_next int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.production_departments WHERE id = p_dept_id) THEN
    RAISE EXCEPTION 'production_department % not found', p_dept_id;
  END IF;

  -- Forsøk å finne eksisterende etikett-nummer for samme nøkkel.
  IF p_order_line_id IS NOT NULL THEN
    SELECT label_number INTO v_existing
    FROM public.label_print_jobs
    WHERE production_department_id = p_dept_id
      AND product_id = p_product_id
      AND order_line_id = p_order_line_id
      AND status IN ('printed','reprinted')
    ORDER BY printed_at ASC
    LIMIT 1;
  ELSE
    SELECT label_number INTO v_existing
    FROM public.label_print_jobs
    WHERE production_department_id = p_dept_id
      AND product_id = p_product_id
      AND order_line_id IS NULL
      AND ((printed_at AT TIME ZONE 'Europe/Oslo')::date) = p_seq_date
      AND status IN ('printed','reprinted')
    ORDER BY printed_at ASC
    LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Ingen treff — tildel nytt nummer i sekvens for datoen.
  INSERT INTO public.label_number_sequences (production_department_id, seq_date, last_number)
  VALUES (p_dept_id, p_seq_date, 1)
  ON CONFLICT (production_department_id, seq_date)
  DO UPDATE SET last_number = label_number_sequences.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN v_next::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_label_number(uuid, uuid, uuid, date) TO authenticated, service_role;