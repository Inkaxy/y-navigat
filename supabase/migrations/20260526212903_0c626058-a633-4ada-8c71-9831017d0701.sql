
ALTER TABLE public.ticket_attachments
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'unclassified',
  ADD COLUMN IF NOT EXISTS attached_to_order_id uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_summary text NULL,
  ADD COLUMN IF NOT EXISTS ai_summarized_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS attached_by uuid NULL,
  ADD COLUMN IF NOT EXISTS attached_at timestamptz NULL;

ALTER TABLE public.ticket_attachments
  DROP CONSTRAINT IF EXISTS ticket_attachments_kind_check;
ALTER TABLE public.ticket_attachments
  ADD CONSTRAINT ticket_attachments_kind_check
  CHECK (kind IN ('inspiration','logo','document','other','unclassified'));

CREATE INDEX IF NOT EXISTS idx_ticket_attachments_order
  ON public.ticket_attachments(attached_to_order_id)
  WHERE attached_to_order_id IS NOT NULL;
