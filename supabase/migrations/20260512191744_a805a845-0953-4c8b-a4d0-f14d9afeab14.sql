CREATE TABLE public.ticket_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  body_text text NOT NULL,
  body_rendered text,
  sent_by uuid NOT NULL REFERENCES auth.users(id),
  microsoft_message_id text,
  microsoft_conversation_id text,
  send_status text NOT NULL DEFAULT 'pending' CHECK (send_status IN ('pending','sent','failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX idx_ticket_replies_ticket_id ON public.ticket_replies(ticket_id, created_at DESC);

ALTER TABLE public.ticket_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ordre-users can read ticket_replies"
  ON public.ticket_replies FOR SELECT
  USING (app_access_level('ordre') <> 'none'::access_level);

CREATE POLICY "Ordre-write can insert ticket_replies"
  ON public.ticket_replies FOR INSERT
  WITH CHECK (has_app_write_access('ordre') AND sent_by = auth.uid());

CREATE POLICY "Ordre-write can update ticket_replies"
  ON public.ticket_replies FOR UPDATE
  USING (has_app_write_access('ordre'))
  WITH CHECK (has_app_write_access('ordre'));

CREATE POLICY "Platform owners can delete ticket_replies"
  ON public.ticket_replies FOR DELETE
  USING (is_platform_owner(auth.uid()));