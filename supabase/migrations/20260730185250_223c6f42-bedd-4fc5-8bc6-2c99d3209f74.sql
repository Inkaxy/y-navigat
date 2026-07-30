DO $do$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='pos_create_cake_order';

  v_old := 'INSERT INTO public.label_print_jobs (
      product_id, order_line_id, legal_entity_id, quantity, status
    ) VALUES (
      v_label_product_id, v_main_order_line_id, v_legal_entity_id, 1, ''queued''
    );';

  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'Fant ikke label_print_jobs-blokken i pos_create_cake_order';
  END IF;

  v_new := 'DECLARE
      v_dept_id uuid;
      v_label_number text;
      v_printed_by uuid := auth.uid();
    BEGIN
      SELECT pld.department_id INTO v_dept_id
      FROM public.product_label_departments pld
      WHERE pld.product_id = v_label_product_id
      LIMIT 1;

      IF v_dept_id IS NOT NULL AND v_printed_by IS NOT NULL THEN
        v_label_number := public.assign_label_number(v_dept_id, v_label_product_id, v_main_order_line_id, v_pickup_date);
        INSERT INTO public.label_print_jobs (
          label_number, product_id, order_line_id, legal_entity_id,
          production_department_id, quantity, printed_by, status
        ) VALUES (
          v_label_number, v_label_product_id, v_main_order_line_id, v_legal_entity_id,
          v_dept_id, 1, v_printed_by, ''printed''
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING ''Etikettjobb hoppet over for kakeordre: %'', SQLERRM;
    END;';

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$do$;
