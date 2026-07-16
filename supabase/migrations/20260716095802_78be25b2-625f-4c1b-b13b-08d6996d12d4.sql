ALTER TABLE public.ticket_attachments ADD COLUMN IF NOT EXISTS content_id text;
CREATE INDEX IF NOT EXISTS ticket_attachments_ticket_content_id_idx ON public.ticket_attachments(ticket_id, content_id);