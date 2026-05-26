CREATE TABLE public.ticket_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN ('customer','staff','ai','system')),
  actor_user_id UUID,
  actor_label TEXT,
  summary TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ticket_events_ticket ON public.ticket_events(ticket_id, occurred_at DESC);
CREATE INDEX idx_ticket_events_order ON public.ticket_events(order_id, occurred_at DESC);
CREATE INDEX idx_ticket_events_type ON public.ticket_events(event_type);

GRANT SELECT, INSERT ON public.ticket_events TO authenticated;
GRANT ALL ON public.ticket_events TO service_role;

ALTER TABLE public.ticket_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ordre-users can read ticket_events"
  ON public.ticket_events FOR SELECT TO authenticated
  USING (app_access_level('ordre'::text) <> 'none'::access_level);

CREATE POLICY "Ordre-write can insert ticket_events"
  ON public.ticket_events FOR INSERT TO authenticated
  WITH CHECK (has_app_write_access('ordre'::text));