# Ventende forslag — IKKE kjørt

Filer her er forslag til uavhengig gjennomgang. De er **ikke** kjørt mot live og ligger
utenfor `supabase/migrations` fordi den mappen kjøres av verktøyet. Root kjører eksakt
godkjent fil, aldri «alle ventende».

| Fil | Status |
|---|---|
| `20261012_negotiation_item_preservation.PENDING.sql` | Ventende. Vern av råvare-ID etter utstedte lenker, foreldrelås i `replace_child_rows`/`set_rfq_password`, ingen tilbakestilling til utkast, slettevern. |
| `20261012_negotiation_item_preservation.test.sql` | Isolert enkeltøkt-test (ruller tilbake). Samtidighet må testes separat i to økter. |

Tilhørende edge-endring (ikke utrullet): `supabase/functions/generate-rfq-credentials/index.ts`
— passord-RPC via brukerklienten, streng tokenlesing, betinget `draft→invited`.
Edge-endringen er trygg både før og etter SQL-en (betinget statusoppdatering blir no-op).
