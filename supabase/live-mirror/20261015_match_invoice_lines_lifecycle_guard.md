# match-invoice-lines — livsløpsvakt (15.10.2026)

Baseline: repo-index.ts identisk med dbc17462 (ingen diff), som var speilet av live etter 20261013-cron-auth.
Endring: etter auth + `has_ravarer_invoice_access(...,'write')` og før all skriving kalles
`_shared/invoiceLifecycleGuard.ts`:
- `invoices.excluded_at` satt, eller status i flagged/reconciled/cancelled/excluded → 200 `{ok, skipped, locked, reason, processed:0}`.
- aktiv `invoice_internal_approvals` (status=approved, revoked_at null, svc, limit 1) → samme låste kvittering.
- lesefeil → 503 `lifecycle_check_failed` (fail-closed, ingen skriving).
Ingen DDL/trigger. Linjevis cost-posted-vakt og øvrig logikk uendret.
Ikke en atomisk lås over hele kjøringen: en godkjenning som settes mens kjøringen pågår fanges av eksisterende skrive-RPC-er, ikke av denne vakten.
Utrullet: source_sha256 926d4a1308fdfdc9acaa5dbb883548c454b3991c1bb5d9198fa525e8a8853c3c.
