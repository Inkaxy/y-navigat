ALTER TABLE public.production_plan_snapshot_items
  ADD COLUMN IF NOT EXISTS row_key text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_ppsi_snapshot_rowkey
  ON public.production_plan_snapshot_items(snapshot_id, row_key);