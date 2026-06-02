CREATE OR REPLACE FUNCTION public.next_label_number(p_dept_id uuid, p_seq_date date DEFAULT ((now() AT TIME ZONE 'Europe/Oslo'::text))::date)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.production_departments WHERE id = p_dept_id) THEN
    RAISE EXCEPTION 'production_department % not found', p_dept_id;
  END IF;

  INSERT INTO public.label_number_sequences (production_department_id, seq_date, last_number)
  VALUES (p_dept_id, p_seq_date, 1)
  ON CONFLICT (production_department_id, seq_date)
  DO UPDATE SET last_number = label_number_sequences.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN v_next::text;
END;
$function$;