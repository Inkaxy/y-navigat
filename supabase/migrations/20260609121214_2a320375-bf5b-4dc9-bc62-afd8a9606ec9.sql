ALTER TABLE public.pos_terminals
  ADD COLUMN logo_url text,
  ADD COLUMN customer_screen_mode text NOT NULL DEFAULT 'logo_and_cart'
    CHECK (customer_screen_mode IN ('logo_only', 'logo_and_cart'));

COMMENT ON COLUMN public.pos_terminals.logo_url IS
  'URL til logo vist på kunde-skjerm (Kiosk). NULL = fallback til "Nøtterø Bakeri"-tekst.';
COMMENT ON COLUMN public.pos_terminals.customer_screen_mode IS
  'Kunde-skjerm-modus: logo_only = bare logo sentrert; logo_and_cart = logo + live handlekurv.';