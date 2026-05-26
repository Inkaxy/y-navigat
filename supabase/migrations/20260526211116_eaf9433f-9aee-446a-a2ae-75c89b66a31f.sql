CREATE TABLE IF NOT EXISTS public.order_confirmations_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text,
  language text NOT NULL DEFAULT 'nb',
  edited_by_user boolean NOT NULL DEFAULT false,
  variables_snapshot jsonb,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_from text,
  microsoft_message_id text,
  send_status text NOT NULL DEFAULT 'sent',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_confirmations_sent_order ON public.order_confirmations_sent(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_confirmations_sent_ticket ON public.order_confirmations_sent(ticket_id) WHERE ticket_id IS NOT NULL;

GRANT SELECT, INSERT ON public.order_confirmations_sent TO authenticated;
GRANT ALL ON public.order_confirmations_sent TO service_role;

ALTER TABLE public.order_confirmations_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ordre_read_confirmations"
  ON public.order_confirmations_sent
  FOR SELECT
  TO authenticated
  USING (public.has_app_write_access('ordre'));

CREATE POLICY "ordre_insert_confirmations"
  ON public.order_confirmations_sent
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_app_write_access('ordre'));