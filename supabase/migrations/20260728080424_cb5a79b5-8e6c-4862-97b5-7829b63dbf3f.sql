ALTER TABLE public.invoice_basis
  ADD COLUMN IF NOT EXISTS tripletex_order_number text;