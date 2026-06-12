
-- POS-PRINT.3 Steg 2: skriver-stasjoner, terminal→skriver-mapping, og print-jobb-kø

-- ───────── 1. pos_print_stations ─────────
CREATE TABLE public.pos_print_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  station_code text NOT NULL,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, station_code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_print_stations TO authenticated;
GRANT ALL ON public.pos_print_stations TO service_role;

ALTER TABLE public.pos_print_stations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pos_print_stations_select"
  ON public.pos_print_stations FOR SELECT
  USING (
    public.has_position_in_entity(legal_entity_id)
    OR public.is_platform_admin()
    OR public.is_kiosk_user()
  );

CREATE POLICY "pos_print_stations_write"
  ON public.pos_print_stations FOR ALL
  USING (
    (public.has_position_in_entity(legal_entity_id) AND public.has_app_write_access('pos_styring'))
    OR public.is_platform_admin()
  )
  WITH CHECK (
    (public.has_position_in_entity(legal_entity_id) AND public.has_app_write_access('pos_styring'))
    OR public.is_platform_admin()
  );

CREATE TRIGGER trg_pos_print_stations_updated_at
  BEFORE UPDATE ON public.pos_print_stations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ───────── 2. pos_terminal_printers (mapping terminal → printer per rolle) ─────────
-- role: 'receipt' (kvittering) eller station_id (uuid) — vi bruker eget felt for klarhet
CREATE TABLE public.pos_terminal_printers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_id uuid NOT NULL REFERENCES public.pos_terminals(id) ON DELETE CASCADE,
  printer_id uuid NOT NULL REFERENCES public.pos_printers(id) ON DELETE CASCADE,
  -- Enten 'receipt' (kvittering for hele kassen) ELLER en stasjon (bong)
  role text NOT NULL CHECK (role IN ('receipt','station')),
  station_id uuid REFERENCES public.pos_print_stations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (role = 'receipt' AND station_id IS NULL)
    OR (role = 'station' AND station_id IS NOT NULL)
  )
);

-- Unik mapping: én receipt-skriver per terminal, og én skriver per (terminal, stasjon)
CREATE UNIQUE INDEX pos_terminal_printers_receipt_uq
  ON public.pos_terminal_printers (terminal_id) WHERE role = 'receipt';
CREATE UNIQUE INDEX pos_terminal_printers_station_uq
  ON public.pos_terminal_printers (terminal_id, station_id) WHERE role = 'station';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_terminal_printers TO authenticated;
GRANT ALL ON public.pos_terminal_printers TO service_role;

ALTER TABLE public.pos_terminal_printers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pos_terminal_printers_select"
  ON public.pos_terminal_printers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pos_terminals t
      WHERE t.id = pos_terminal_printers.terminal_id
        AND (
          public.has_position_in_entity(t.legal_entity_id)
          OR public.is_platform_admin()
          OR public.is_kiosk_user()
        )
    )
  );

CREATE POLICY "pos_terminal_printers_write"
  ON public.pos_terminal_printers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.pos_terminals t
      WHERE t.id = pos_terminal_printers.terminal_id
        AND (
          (public.has_position_in_entity(t.legal_entity_id) AND public.has_app_write_access('pos_styring'))
          OR public.is_platform_admin()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pos_terminals t
      WHERE t.id = pos_terminal_printers.terminal_id
        AND (
          (public.has_position_in_entity(t.legal_entity_id) AND public.has_app_write_access('pos_styring'))
          OR public.is_platform_admin()
        )
    )
  );

CREATE TRIGGER trg_pos_terminal_printers_updated_at
  BEFORE UPDATE ON public.pos_terminal_printers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ───────── 3. products.pos_print_station_id ─────────
ALTER TABLE public.products
  ADD COLUMN pos_print_station_id uuid REFERENCES public.pos_print_stations(id) ON DELETE SET NULL;

CREATE INDEX idx_products_pos_print_station_id
  ON public.products (pos_print_station_id) WHERE pos_print_station_id IS NOT NULL;

-- ───────── 4. pos_print_jobs (kø som ekstern poller leser) ─────────
CREATE TABLE public.pos_print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  printer_id uuid NOT NULL REFERENCES public.pos_printers(id) ON DELETE CASCADE,
  terminal_id uuid REFERENCES public.pos_terminals(id) ON DELETE SET NULL,
  transaction_id uuid REFERENCES public.pos_transactions(id) ON DELETE SET NULL,
  job_type text NOT NULL CHECK (job_type IN ('receipt','station_ticket','test')),
  station_id uuid REFERENCES public.pos_print_stations(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','printing','done','failed')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  claimed_at timestamptz,
  printed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pos_print_jobs_queue
  ON public.pos_print_jobs (printer_id, status, created_at)
  WHERE status IN ('queued','printing');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_print_jobs TO authenticated;
GRANT ALL ON public.pos_print_jobs TO service_role;

ALTER TABLE public.pos_print_jobs ENABLE ROW LEVEL SECURITY;

-- SELECT: pos_styring-lesere i samme entity + kiosk-bruker (debug/ettersending)
CREATE POLICY "pos_print_jobs_select"
  ON public.pos_print_jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pos_printers p
      WHERE p.id = pos_print_jobs.printer_id
        AND (
          public.has_position_in_entity(p.legal_entity_id)
          OR public.is_platform_admin()
          OR public.is_kiosk_user()
        )
    )
  );

-- INSERT: kiosk-bruker (kassen enqueuer) ELLER pos_styring-write (manuell/test)
CREATE POLICY "pos_print_jobs_insert"
  ON public.pos_print_jobs FOR INSERT
  WITH CHECK (
    public.is_kiosk_user()
    OR public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.pos_printers p
      WHERE p.id = pos_print_jobs.printer_id
        AND public.has_position_in_entity(p.legal_entity_id)
        AND public.has_app_write_access('pos_styring')
    )
  );

-- UPDATE/DELETE: kun pos_styring-write + service_role (poller bruker service_role)
CREATE POLICY "pos_print_jobs_update"
  ON public.pos_print_jobs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.pos_printers p
      WHERE p.id = pos_print_jobs.printer_id
        AND (
          (public.has_position_in_entity(p.legal_entity_id) AND public.has_app_write_access('pos_styring'))
          OR public.is_platform_admin()
        )
    )
  )
  WITH CHECK (true);

CREATE POLICY "pos_print_jobs_delete"
  ON public.pos_print_jobs FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.pos_printers p
      WHERE p.id = pos_print_jobs.printer_id
        AND (
          (public.has_position_in_entity(p.legal_entity_id) AND public.has_app_write_access('pos_styring'))
          OR public.is_platform_admin()
        )
    )
  );

CREATE TRIGGER trg_pos_print_jobs_updated_at
  BEFORE UPDATE ON public.pos_print_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
