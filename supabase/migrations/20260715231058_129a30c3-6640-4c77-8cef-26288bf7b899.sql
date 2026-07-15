
-- notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  ticket_id uuid,
  refund_id uuid,
  order_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_ticket ON public.notifications(ticket_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own notifications select" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own notifications update" ON public.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own notifications delete" ON public.notifications
  FOR DELETE TO authenticated USING (user_id = auth.uid());
-- Insert: authenticated brukere kan sette inn varsler til andre (assign, @tag)
CREATE POLICY "authenticated notifications insert" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Seed SLA + åpningstid i platform_settings
INSERT INTO public.platform_settings (category, key, value)
SELECT 'ordre_ai', 'sla_deadlines',
       '{"complaint": 2, "change": 4, "new_order": 4, "cancellation": 4, "question": 8}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.platform_settings WHERE category='ordre_ai' AND key='sla_deadlines'
);

INSERT INTO public.platform_settings (category, key, value)
SELECT 'ordre_ai', 'business_hours',
       '{"start_hour": 8, "end_hour": 16, "workdays": [1,2,3,4,5]}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.platform_settings WHERE category='ordre_ai' AND key='business_hours'
);

-- Registrer Hjem-widget
INSERT INTO public.widget_registry (code, display_name, description, required_app_code, default_size, status)
SELECT 'ordre_ticket_queue', 'Ticket-køen nå',
       'Åpne tickets per intensjon, fristbrudd og tilbakebetalinger til behandling.',
       'ordre', 'medium', 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.widget_registry WHERE code='ordre_ticket_queue');
