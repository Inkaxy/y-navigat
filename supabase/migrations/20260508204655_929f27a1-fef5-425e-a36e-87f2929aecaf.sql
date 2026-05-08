
ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS packing_slip_delivery_mode text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS packing_slip_emails text;
