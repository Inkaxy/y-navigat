ALTER TABLE public.pos_transaction_lines
  DROP CONSTRAINT pos_transaction_lines_product_id_fkey;

ALTER TABLE public.pos_transaction_lines
  ADD CONSTRAINT pos_transaction_lines_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;