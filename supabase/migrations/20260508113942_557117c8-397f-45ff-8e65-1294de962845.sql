
-- 1. tickets table
CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  microsoft_message_id text UNIQUE NOT NULL,
  microsoft_internet_message_id text,
  source_mailbox text NOT NULL DEFAULT 'ordre@nottero-bakeri.no',
  subject text,
  body_html text,
  body_text text,
  body_preview text,
  sender_email text NOT NULL,
  sender_name text,
  to_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  cc_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  has_attachments boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL,
  importance text,
  conversation_id text,
  status text NOT NULL DEFAULT 'new',
  priority text NOT NULL DEFAULT 'normal',
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  related_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  internal_notes text,
  ai_status text,
  ai_suggestion jsonb,
  ai_provider text,
  ai_model text,
  ai_analyzed_at timestamptz,
  ai_cost_usd numeric(10,6),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tickets_status_chk CHECK (status IN ('new','in_progress','resolved','closed','spam')),
  CONSTRAINT tickets_priority_chk CHECK (priority IN ('low','normal','high','urgent'))
);

CREATE INDEX tickets_status_idx ON public.tickets (status, received_at DESC);
CREATE INDEX tickets_sender_idx ON public.tickets (sender_email);
CREATE INDEX tickets_conversation_idx ON public.tickets (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX tickets_assigned_idx ON public.tickets (assigned_to) WHERE assigned_to IS NOT NULL;

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ordre-users can read tickets"
  ON public.tickets FOR SELECT
  USING (public.app_access_level('ordre') IS NOT NULL);

CREATE POLICY "Ordre-write can update tickets"
  ON public.tickets FOR UPDATE
  USING (public.has_app_write_access('ordre'))
  WITH CHECK (public.has_app_write_access('ordre'));

CREATE POLICY "Platform owners can delete tickets"
  ON public.tickets FOR DELETE
  USING (public.is_platform_owner(auth.uid()));

CREATE TRIGGER tickets_updated_at
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. ticket_attachments
CREATE TABLE public.ticket_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  microsoft_attachment_id text,
  file_name text NOT NULL,
  content_type text,
  size_bytes bigint,
  storage_path text,
  is_inline boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ticket_attachments_ticket_idx ON public.ticket_attachments (ticket_id);

ALTER TABLE public.ticket_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ordre-users can read attachments"
  ON public.ticket_attachments FOR SELECT
  USING (public.app_access_level('ordre') IS NOT NULL);

-- 3. ticket_subscriptions (service-role only)
CREATE TABLE public.ticket_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  microsoft_subscription_id text UNIQUE NOT NULL,
  resource text NOT NULL,
  notification_url text NOT NULL,
  client_state text NOT NULL,
  expiration_date_time timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_renewed_at timestamptz
);

ALTER TABLE public.ticket_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform owners can read subscriptions"
  ON public.ticket_subscriptions FOR SELECT
  USING (public.is_platform_owner(auth.uid()));

-- 4. Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('ticket-attachments', 'ticket-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Ordre-users can read ticket attachment files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'ticket-attachments' AND public.app_access_level('ordre') IS NOT NULL);
