ALTER TABLE public.pos_keypad_layouts
  ADD COLUMN IF NOT EXISTS theme jsonb,
  ADD COLUMN IF NOT EXISTS customer_screen jsonb;
ALTER TABLE public.pos_keypad_pages
  ADD COLUMN IF NOT EXISTS icon text;