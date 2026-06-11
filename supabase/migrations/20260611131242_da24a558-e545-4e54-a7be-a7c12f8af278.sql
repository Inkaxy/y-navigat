ALTER TABLE public.pos_keypad_buttons
  ADD COLUMN IF NOT EXISTS target_page_id uuid
    REFERENCES public.pos_keypad_pages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_keypad_buttons_target_page_id
  ON public.pos_keypad_buttons(target_page_id);

-- Backfill: for category-buttons, look up a page in the same layout whose
-- name matches the button's display_label (case-insensitive). Ambiguous
-- duplicates were already verified to not exist.
UPDATE public.pos_keypad_buttons b
SET target_page_id = tgt.id
FROM public.pos_keypad_pages src
JOIN public.pos_keypad_pages tgt
  ON tgt.layout_id = src.layout_id
WHERE b.page_id = src.id
  AND b.button_type = 'category'
  AND b.target_page_id IS NULL
  AND lower(tgt.page_name) = lower(b.display_label);