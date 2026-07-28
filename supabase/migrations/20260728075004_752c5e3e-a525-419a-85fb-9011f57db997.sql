
-- 1) App-aktivering
UPDATE public.apps
SET display_name = 'Fakturering',
    status = 'active',
    start_path = '/fakturering',
    category = 'finance',
    color_hex = COALESCE(color_hex, '#a855f7')
WHERE code = 'faktura';

-- 2) customers.tripletex_customer_id
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS tripletex_customer_id bigint;
CREATE INDEX IF NOT EXISTS idx_customers_le_ttx
  ON public.customers(legal_entity_id, tripletex_customer_id);

-- 3) invoice_runs
CREATE TABLE public.invoice_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL,
  run_date date NOT NULL,
  groups text[] NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','completed_with_errors','cancelled')),
  started_by uuid,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  basis_count int NOT NULL DEFAULT 0,
  transferred_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  skipped_count int NOT NULL DEFAULT 0,
  total_incl_vat numeric NOT NULL DEFAULT 0,
  error_message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.invoice_runs TO authenticated;
GRANT ALL ON public.invoice_runs TO service_role;
ALTER TABLE public.invoice_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_runs_select ON public.invoice_runs
  FOR SELECT TO authenticated
  USING (
    public.app_access_level('faktura') <> 'none'
    AND public.has_position_in_entity(legal_entity_id)
  );
CREATE INDEX idx_invoice_runs_le_date ON public.invoice_runs(legal_entity_id, run_date DESC);

-- 4) invoice_basis
CREATE TABLE public.invoice_basis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.invoice_runs(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  source_customer_ids uuid[],
  basis_number text NOT NULL,
  invoicing_group text NOT NULL,
  payment_terms_days int,
  do_transfer boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','transferred','invoiced','error','skipped','excluded')),
  transfer_error text,
  sum_excl_vat numeric NOT NULL DEFAULT 0,
  sum_vat numeric NOT NULL DEFAULT 0,
  sum_incl_vat numeric NOT NULL DEFAULT 0,
  customer_snapshot jsonb,
  tripletex_customer_id bigint,
  tripletex_order_id bigint,
  tripletex_invoice_id bigint,
  tripletex_invoice_number text,
  tripletex_invoice_date date,
  transferred_at timestamptz,
  invoiced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.invoice_basis TO authenticated;
GRANT ALL ON public.invoice_basis TO service_role;
ALTER TABLE public.invoice_basis ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_basis_select ON public.invoice_basis
  FOR SELECT TO authenticated
  USING (
    public.app_access_level('faktura') <> 'none'
    AND public.has_position_in_entity(legal_entity_id)
  );
CREATE INDEX idx_invoice_basis_run ON public.invoice_basis(run_id);
CREATE INDEX idx_invoice_basis_le_status ON public.invoice_basis(legal_entity_id, status);

-- 5) invoice_basis_lines
CREATE TABLE public.invoice_basis_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  basis_id uuid NOT NULL REFERENCES public.invoice_basis(id) ON DELETE CASCADE,
  line_number int NOT NULL,
  product_id uuid,
  product_number text,
  description text NOT NULL,
  iso_week int,
  quantity numeric NOT NULL,
  sales_unit text,
  unit_price_excl_vat numeric,
  vat_rate numeric NOT NULL,
  line_excl_vat numeric NOT NULL,
  line_vat numeric NOT NULL,
  line_incl_vat numeric NOT NULL
);
GRANT SELECT ON public.invoice_basis_lines TO authenticated;
GRANT ALL ON public.invoice_basis_lines TO service_role;
ALTER TABLE public.invoice_basis_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_basis_lines_select ON public.invoice_basis_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoice_basis b
      WHERE b.id = invoice_basis_lines.basis_id
        AND public.app_access_level('faktura') <> 'none'
        AND public.has_position_in_entity(b.legal_entity_id)
    )
  );
CREATE INDEX idx_invoice_basis_lines_basis ON public.invoice_basis_lines(basis_id);

-- 6) invoice_basis_orders (join med unik order_id)
CREATE TABLE public.invoice_basis_orders (
  basis_id uuid NOT NULL REFERENCES public.invoice_basis(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (basis_id, order_id)
);
GRANT SELECT ON public.invoice_basis_orders TO authenticated;
GRANT ALL ON public.invoice_basis_orders TO service_role;
ALTER TABLE public.invoice_basis_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_basis_orders_select ON public.invoice_basis_orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoice_basis b
      WHERE b.id = invoice_basis_orders.basis_id
        AND public.app_access_level('faktura') <> 'none'
        AND public.has_position_in_entity(b.legal_entity_id)
    )
  );
CREATE UNIQUE INDEX uidx_invoice_basis_orders_order ON public.invoice_basis_orders(order_id);

-- 7) invoice_settings
CREATE TABLE public.invoice_settings (
  legal_entity_id uuid PRIMARY KEY,
  default_due_days int NOT NULL DEFAULT 14,
  vat_account_map jsonb NOT NULL DEFAULT '{"15":"3001","25":"3000"}'::jsonb,
  non_transfer_groups text[] NOT NULL DEFAULT ARRAY['test']::text[],
  internal_groups text[] NOT NULL DEFAULT ARRAY['internal_outlets']::text[],
  tripletex_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.invoice_settings TO authenticated;
GRANT ALL ON public.invoice_settings TO service_role;
ALTER TABLE public.invoice_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_settings_select ON public.invoice_settings
  FOR SELECT TO authenticated
  USING (
    public.app_access_level('faktura') <> 'none'
    AND public.has_position_in_entity(legal_entity_id)
  );

-- 8) updated_at triggere (bruker eksisterende util)
CREATE TRIGGER trg_invoice_runs_updated_at
  BEFORE UPDATE ON public.invoice_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_invoice_settings_updated_at
  BEFORE UPDATE ON public.invoice_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
