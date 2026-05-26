ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS production_notes TEXT,
  ADD COLUMN IF NOT EXISTS store_notes TEXT;

COMMENT ON COLUMN public.orders.production_notes IS 'Strukturert notat til produksjon — kaketekst, pynt, fyll, allergier, spesialønsker.';
COMMENT ON COLUMN public.orders.store_notes IS 'Strukturert notat til butikk/utleveringssted — hentetid, kontaktinfo, betaling, spesielle hentebeskjeder.';