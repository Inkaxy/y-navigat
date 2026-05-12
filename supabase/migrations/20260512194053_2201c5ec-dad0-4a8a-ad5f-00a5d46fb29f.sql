ALTER TABLE public.label_print_jobs
  DROP CONSTRAINT IF EXISTS label_print_jobs_order_line_id_fkey;

ALTER TABLE public.label_print_jobs
  ADD CONSTRAINT label_print_jobs_order_line_id_fkey
  FOREIGN KEY (order_line_id)
  REFERENCES public.order_lines(id)
  ON DELETE SET NULL;