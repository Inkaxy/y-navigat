# match-invoice-lines — cron-autentisering (13.10.2026)

Baseline: live kilde hentet av Henrik med get_edge_function (v183) + `_shared/units.ts` fra commit 9da1e792 (identisk med live).
Repoets tidligere, ikke-utrullede index.ts er tatt vare på i `docs/pending/match-invoice-lines.index.ikke-utrullet.ts.txt`.

Eneste endring mot live v183 (`supabase/functions/match-invoice-lines/index.ts`):
- import `authorizeCron` fra `_shared/cron-auth.ts`.
- Tjenestekall = service-role-bearer ELLER X-Cron-Secret (>=16 tegn) verifisert av `verify_cron_secret`.
  RPC-feil/tom/feil secret gir ikke tjenestetilgang og faller til JWT + `has_ravarer_invoice_access(...,'write')` (uendret).
- `config.toml`: eksplisitt `verify_jwt = false` (samme som før; rm_rematch_tick sender ingen JWT).

Avhengigheter (uendret, verifisert mot live): units.ts, matchNormalize.ts, priceSync.ts, packageSignature.ts, priceAcceptance.ts, creditNote.ts, cron-auth.ts.
Utrullet: source_sha256 5dbd88b7276b4ab020c2c4caaa96e4fd29aa1a4afe30c738f3abdd838aaea93b.
