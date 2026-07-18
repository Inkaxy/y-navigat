
ALTER TABLE public.pos_keypad_pages
  ADD COLUMN IF NOT EXISTS is_dynamic boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_kind text CHECK (source_kind IN ('main_category','sub_category','production_group')),
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS source_last_synced_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_pos_keypad_pages_source
  ON public.pos_keypad_pages (source_kind, source_id) WHERE source_id IS NOT NULL;

COMMENT ON COLUMN public.pos_keypad_pages.is_dynamic IS
  'Når true genereres produktknappene automatisk fra source_kind/source_id og oppdateres ved neste synk.';
