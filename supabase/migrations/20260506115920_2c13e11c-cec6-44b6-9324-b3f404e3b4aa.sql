
-- ============================================================================
-- PULJE 2 STEG 1: Datamodell for prismatch-rolle og Tripletex-integrasjon
-- ============================================================================

-- pgcrypto for token-kryptering
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1.1 Status-modell forenklet
-- ----------------------------------------------------------------------------
-- Migrer eksisterende status-verdier
UPDATE public.invoices SET status = CASE status
  WHEN 'pending'       THEN 'imported'
  WHEN 'parsing'       THEN 'imported'
  WHEN 'pending_parse' THEN 'imported'
  WHEN 'matched'       THEN 'ready'
  WHEN 'approved'      THEN 'reconciled'
  WHEN 'paid'          THEN 'reconciled'
  WHEN 'disputed'      THEN 'flagged'
  ELSE status
END
WHERE status IN ('pending','parsing','pending_parse','matched','approved','paid','disputed');

-- Sett ny default
ALTER TABLE public.invoices ALTER COLUMN status SET DEFAULT 'imported';

-- CHECK constraint på lovlige statuser
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('imported','needs_review','ready','reconciled','flagged'));

-- ----------------------------------------------------------------------------
-- 1.2 Felt-omdøping på invoices
-- ----------------------------------------------------------------------------
ALTER TABLE public.invoices RENAME COLUMN approved_at TO reconciled_at;
ALTER TABLE public.invoices RENAME COLUMN approved_by TO reconciled_by;

-- ----------------------------------------------------------------------------
-- 1.3 Nye felt på invoices for Tripletex og linjekilde
-- ----------------------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS lines_source text,
  ADD COLUMN IF NOT EXISTS is_credit_note boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tripletex_voucher_id text,
  ADD COLUMN IF NOT EXISTS tripletex_voucher_number text,
  ADD COLUMN IF NOT EXISTS tripletex_supplier_id text,
  ADD COLUMN IF NOT EXISTS imported_from_tripletex_at timestamptz;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_lines_source_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_lines_source_check
  CHECK (lines_source IS NULL OR lines_source IN ('tripletex_postings','ehf_attachment','manual','pending_manual'));

-- Dedupe-index: samme voucher kan kun importeres én gang pr selskap
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_tripletex_voucher
  ON public.invoices (legal_entity_id, tripletex_voucher_id)
  WHERE tripletex_voucher_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 1.4 Auto-reconcile innstilling
-- ----------------------------------------------------------------------------
ALTER TABLE public.invoice_match_settings
  ADD COLUMN IF NOT EXISTS auto_reconcile_clean_imports boolean NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- 2.1 Tripletex credentials (pr selskap)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tripletex_credentials (
  legal_entity_id uuid PRIMARY KEY REFERENCES public.legal_entities(id) ON DELETE CASCADE,

  -- Tokens lagres kryptert (AES-256-GCM via Edge Function)
  consumer_token_encrypted text,           -- vår applikasjonstoken (samme for alle 4)
  employee_token_encrypted text,           -- pr-selskap token (kryptert)

  -- Cached session token (regenereres innen 24t)
  session_token text,
  session_expires_at timestamptz,

  -- Sync-konfigurasjon
  sync_enabled boolean NOT NULL DEFAULT true,
  sync_frequency_minutes int NOT NULL DEFAULT 60,
  last_synced_at timestamptz,
  last_sync_status text,                   -- 'success','error','partial','running'
  last_sync_error text,
  last_synced_voucher_date date,           -- alt etter denne datoen pulles

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tripletex_credentials_status_check
    CHECK (last_sync_status IS NULL OR last_sync_status IN ('success','error','partial','running'))
);

ALTER TABLE public.tripletex_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read tripletex credentials" ON public.tripletex_credentials;
CREATE POLICY "Admins can read tripletex credentials"
  ON public.tripletex_credentials FOR SELECT
  USING (public.has_fakturaer_access(legal_entity_id, 'admin'));

DROP POLICY IF EXISTS "Admins can insert tripletex credentials" ON public.tripletex_credentials;
CREATE POLICY "Admins can insert tripletex credentials"
  ON public.tripletex_credentials FOR INSERT
  WITH CHECK (public.has_fakturaer_access(legal_entity_id, 'admin'));

DROP POLICY IF EXISTS "Admins can update tripletex credentials" ON public.tripletex_credentials;
CREATE POLICY "Admins can update tripletex credentials"
  ON public.tripletex_credentials FOR UPDATE
  USING (public.has_fakturaer_access(legal_entity_id, 'admin'))
  WITH CHECK (public.has_fakturaer_access(legal_entity_id, 'admin'));

DROP POLICY IF EXISTS "Admins can delete tripletex credentials" ON public.tripletex_credentials;
CREATE POLICY "Admins can delete tripletex credentials"
  ON public.tripletex_credentials FOR DELETE
  USING (public.has_fakturaer_access(legal_entity_id, 'admin'));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ SET search_path = public;

DROP TRIGGER IF EXISTS trg_tripletex_credentials_updated_at ON public.tripletex_credentials;
CREATE TRIGGER trg_tripletex_credentials_updated_at
  BEFORE UPDATE ON public.tripletex_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2.1 Tripletex sync log
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tripletex_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id) ON DELETE CASCADE,

  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running',

  vouchers_fetched int NOT NULL DEFAULT 0,
  vouchers_imported int NOT NULL DEFAULT 0,
  vouchers_skipped int NOT NULL DEFAULT 0,
  vouchers_failed int NOT NULL DEFAULT 0,

  error_message text,
  details jsonb,

  CONSTRAINT tripletex_sync_log_status_check
    CHECK (status IN ('running','success','error','partial'))
);

CREATE INDEX IF NOT EXISTS idx_tripletex_sync_log_entity_started
  ON public.tripletex_sync_log (legal_entity_id, started_at DESC);

ALTER TABLE public.tripletex_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read tripletex sync log" ON public.tripletex_sync_log;
CREATE POLICY "Admins can read tripletex sync log"
  ON public.tripletex_sync_log FOR SELECT
  USING (public.has_fakturaer_access(legal_entity_id, 'admin'));
-- Skriving skjer kun fra Edge Functions (service_role bypasser RLS).

-- ----------------------------------------------------------------------------
-- 6.2 Tripletex-felt på suppliers
-- ----------------------------------------------------------------------------
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS tripletex_supplier_id text,
  ADD COLUMN IF NOT EXISTS tripletex_supplier_number text;

CREATE INDEX IF NOT EXISTS idx_suppliers_tripletex_supplier_id
  ON public.suppliers (legal_entity_id, tripletex_supplier_id)
  WHERE tripletex_supplier_id IS NOT NULL;
