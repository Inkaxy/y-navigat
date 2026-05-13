ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cert_nokkelhull boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cert_norsk_100 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS breadscale_value smallint;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_breadscale_value_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_breadscale_value_check
  CHECK (breadscale_value IS NULL OR breadscale_value BETWEEN 1 AND 4);

COMMENT ON COLUMN public.products.cert_nokkelhull IS 'Merkeordning: Nøkkelhullet';
COMMENT ON COLUMN public.products.cert_norsk_100 IS 'Merkeordning: 100 % norsk';
COMMENT ON COLUMN public.products.breadscale_value IS 'Brødskalaen / Grovhetsskala 1-4 (1=fint, 4=ekstra grovt)';
