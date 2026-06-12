ALTER TABLE public.pos_keypad_layouts
  ADD COLUMN IF NOT EXISTS show_product_image boolean NOT NULL DEFAULT true;

ALTER TABLE public.pos_keypad_buttons
  ADD COLUMN IF NOT EXISTS show_image boolean;

COMMENT ON COLUMN public.pos_keypad_layouts.show_product_image IS
  'Standard for om produktbilder vises på taster i dette layoutet. Kan overstyres pr knapp via pos_keypad_buttons.show_image.';
COMMENT ON COLUMN public.pos_keypad_buttons.show_image IS
  'Overstyrer layout.show_product_image for denne knappen. NULL = arv fra layout.';