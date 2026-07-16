ALTER TABLE public.cake_images
  ADD COLUMN IF NOT EXISTS label_number text,
  ADD COLUMN IF NOT EXISTS order_line_id uuid REFERENCES public.order_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS production_department_id uuid REFERENCES public.production_departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cake_images_order_line_dept_idx
  ON public.cake_images(production_department_id, order_line_id)
  WHERE order_line_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_label_number(p_dept_id uuid, p_product_id uuid, p_order_line_id uuid, p_seq_date date DEFAULT NULL::date)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing text;
  v_next int;
  v_date date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.production_departments WHERE id = p_dept_id) THEN
    RAISE EXCEPTION 'production_department % not found', p_dept_id;
  END IF;

  v_date := p_seq_date;
  IF v_date IS NULL AND p_order_line_id IS NOT NULL THEN
    SELECT o.delivery_date INTO v_date
    FROM public.order_lines ol
    JOIN public.orders o ON o.id = ol.order_id
    WHERE ol.id = p_order_line_id;
  END IF;
  IF v_date IS NULL THEN
    v_date := ((now() AT TIME ZONE 'Europe/Oslo')::date);
  END IF;

  -- 1) Gjenbruk fra label_print_jobs
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
      AND ((printed_at AT TIME ZONE 'Europe/Oslo')::date) = v_date
      AND status IN ('printed','reprinted')
    ORDER BY printed_at ASC
    LIMIT 1;
  END IF;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- 2) Gjenbruk fra kakebilde som allerede har reservert nummer for samme ordrelinje/dept
  IF p_order_line_id IS NOT NULL THEN
    SELECT label_number INTO v_existing
    FROM public.cake_images
    WHERE production_department_id = p_dept_id
      AND order_line_id = p_order_line_id
      AND label_number IS NOT NULL
    ORDER BY created_at ASC
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- 3) Tildel neste ledige
  INSERT INTO public.label_number_sequences (production_department_id, seq_date, last_number)
  VALUES (p_dept_id, v_date, 1)
  ON CONFLICT (production_department_id, seq_date)
  DO UPDATE SET last_number = label_number_sequences.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN v_next::text;
END;
$function$;