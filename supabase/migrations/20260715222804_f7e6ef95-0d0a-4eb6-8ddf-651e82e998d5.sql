
-- 1) ticket_order_links
CREATE TABLE public.ticket_order_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, order_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_order_links TO authenticated;
GRANT ALL ON public.ticket_order_links TO service_role;

ALTER TABLE public.ticket_order_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticket_order_links_select"
  ON public.ticket_order_links FOR SELECT
  USING (app_access_level('ordre'::text) <> 'none'::access_level);

CREATE POLICY "ticket_order_links_insert"
  ON public.ticket_order_links FOR INSERT
  WITH CHECK (has_app_write_access('ordre'::text));

CREATE POLICY "ticket_order_links_update"
  ON public.ticket_order_links FOR UPDATE
  USING (has_app_write_access('ordre'::text))
  WITH CHECK (has_app_write_access('ordre'::text));

CREATE POLICY "ticket_order_links_delete"
  ON public.ticket_order_links FOR DELETE
  USING (has_app_write_access('ordre'::text));

CREATE INDEX ticket_order_links_order_id_idx ON public.ticket_order_links(order_id);
CREATE INDEX ticket_order_links_ticket_id_idx ON public.ticket_order_links(ticket_id);

-- 2) cake_images: ticket_id, order_id
ALTER TABLE public.cake_images
  ADD COLUMN ticket_id uuid NULL REFERENCES public.tickets(id) ON DELETE SET NULL,
  ADD COLUMN order_id uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE INDEX cake_images_ticket_id_idx ON public.cake_images(ticket_id);

-- 3) refunds
CREATE TABLE public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES public.tickets(id),
  order_id uuid NULL REFERENCES public.orders(id),
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reason text,
  route text NOT NULL CHECK (route IN ('utsalg','okonomi')),
  outlet_id uuid NULL REFERENCES public.outlets(id),
  method text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  requires_approval boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approved_by uuid,
  paid_at timestamptz,
  paid_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.refunds TO authenticated;
GRANT ALL ON public.refunds TO service_role;

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "refunds_select"
  ON public.refunds FOR SELECT
  USING (app_access_level('ordre'::text) <> 'none'::access_level);

CREATE POLICY "refunds_insert"
  ON public.refunds FOR INSERT
  WITH CHECK (has_app_write_access('ordre'::text));

CREATE POLICY "refunds_update"
  ON public.refunds FOR UPDATE
  USING (has_app_write_access('ordre'::text))
  WITH CHECK (has_app_write_access('ordre'::text));

CREATE INDEX refunds_status_idx ON public.refunds(status);
CREATE INDEX refunds_outlet_id_idx ON public.refunds(outlet_id);
CREATE INDEX refunds_ticket_id_idx ON public.refunds(ticket_id);
CREATE INDEX refunds_order_id_idx ON public.refunds(order_id);
