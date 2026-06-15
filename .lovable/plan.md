## Problem
Funksjonen `public.build_cake_order_line` refererer til `pli.unit_price_excl_vat`, men kolonnen i `price_list_items` heter bare `price` (slik `calculate_cake_price` allerede bruker). Derav feilen "column pli.unit_price_excl_vat does not exist" når kakebyggeren prøver å bygge en ordrelinje.

## Endring
Én migration som erstatter `build_cake_order_line` med en versjon som leser `pli.price` istedenfor `pli.unit_price_excl_vat`. JSON-output beholder samme nøkler (`unit_price_excl_vat` i payload) — det er kun SQL-kolonnenavnet i SELECT-en som rettes. Ingen kodeendringer i frontend nødvendig.

## Filer
- Ny migration: `supabase/migrations/<ts>_fix_build_cake_order_line_price_column.sql`

Ingen andre funksjoner eller tabeller berøres.