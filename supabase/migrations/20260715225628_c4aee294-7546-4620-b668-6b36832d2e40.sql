
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS awaiting_external boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS awaiting_external_email text,
  ADD COLUMN IF NOT EXISTS followers uuid[] NOT NULL DEFAULT '{}'::uuid[];

CREATE TABLE IF NOT EXISTS public.ticket_inbound_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  microsoft_message_id text NOT NULL UNIQUE,
  microsoft_internet_message_id text,
  conversation_id text,
  sender_email text NOT NULL,
  sender_name text,
  subject text,
  body_html text,
  body_text text,
  body_preview text,
  has_attachments boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL,
  is_from_external_forward boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_inbound_ticket ON public.ticket_inbound_messages(ticket_id, received_at);

GRANT SELECT ON public.ticket_inbound_messages TO authenticated;
GRANT ALL ON public.ticket_inbound_messages TO service_role;

ALTER TABLE public.ticket_inbound_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ordre-users can read ticket_inbound_messages"
  ON public.ticket_inbound_messages FOR SELECT TO authenticated
  USING (public.app_access_level('ordre'::text) <> 'none'::public.access_level);

ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_inbound_messages;
