
-- Add mode column to tripletex_credentials
ALTER TABLE public.tripletex_credentials 
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'standard' 
  CHECK (mode IN ('standard','private'));

-- Replace stale fakturaer-based RLS with ravarer invoice_access policies
DROP POLICY IF EXISTS "Admins can read tripletex credentials" ON public.tripletex_credentials;
DROP POLICY IF EXISTS "Admins can insert tripletex credentials" ON public.tripletex_credentials;
DROP POLICY IF EXISTS "Admins can update tripletex credentials" ON public.tripletex_credentials;
DROP POLICY IF EXISTS "Admins can delete tripletex credentials" ON public.tripletex_credentials;
DROP POLICY IF EXISTS "Admins can read tripletex sync log" ON public.tripletex_sync_log;

CREATE POLICY "tx_creds_select" ON public.tripletex_credentials FOR SELECT
  USING (public.has_ravarer_invoice_access(legal_entity_id, 'admin'));
CREATE POLICY "tx_creds_insert" ON public.tripletex_credentials FOR INSERT
  WITH CHECK (public.has_ravarer_invoice_access(legal_entity_id, 'admin'));
CREATE POLICY "tx_creds_update" ON public.tripletex_credentials FOR UPDATE
  USING (public.has_ravarer_invoice_access(legal_entity_id, 'admin'))
  WITH CHECK (public.has_ravarer_invoice_access(legal_entity_id, 'admin'));
CREATE POLICY "tx_creds_delete" ON public.tripletex_credentials FOR DELETE
  USING (public.has_ravarer_invoice_access(legal_entity_id, 'admin'));

CREATE POLICY "tx_sync_log_select" ON public.tripletex_sync_log FOR SELECT
  USING (public.has_ravarer_invoice_access(legal_entity_id, 'admin'));
