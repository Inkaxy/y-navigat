ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS eatin_mva_rate numeric(5,2) NULL;

COMMENT ON COLUMN public.products.eatin_mva_rate IS
  'Effektiv MVA-sats når produktet konsumeres på stedet (sitt her). NULL = ikke matvare, samme sats uansett. 25 = matvare (15 % takeaway, 25 % eatin).';

-- Backfill: alle nåværende matvarer (mva_rate=15) får eatin-sats 25
UPDATE public.products
SET eatin_mva_rate = 25
WHERE mva_rate = 15
  AND eatin_mva_rate IS NULL;