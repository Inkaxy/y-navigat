# Live-speil av rot-migrasjoner

Byte-identiske kopier av SQL som root har kjørt direkte mot live-databasen (hentet fra
`supabase_migrations.schema_migrations.statements`, md5 verifisert). Filnavn = live versjon + navn.
Ligger utenfor `supabase/migrations` fordi den mappen styres av migrasjonsverktøyet, som ville kjørt SQL-en på nytt.
Skal ALDRI kjøres på nytt.

## Gjenoppbyggingsrekkefølge (2026-10-11)

Kjør i versjonsrekkefølge; alle er allerede kjørt live og registrert i `schema_migrations` — ALDRI kjør på nytt mot live.
Filer i `supabase/migrations/` er skrevet av migrasjonsverktøyet; root-filer ligger her.

| Versjon | Fil | md5 (= live statements) |
|---|---|---|
| 20261011142207 | live-mirror/20261011142207_ravarer_price_integrity_review.sql | root |
| 20261011142644 | live-mirror/20261011142644_ravarer_link_snapshot_transaction_guard.sql | root |
| 20261011143122 | live-mirror/20261011143122_ravarer_confirm_match_lifecycle_guard.sql | root |
| 20261011143530 | migrations/20261011143530_4867a5de-b412-4f74-a3e9-7c7b6f7117b4.sql | rm_save_manual_pdf_invoice (første versjon) |
| 20261011143658 | live-mirror/20261011143658_ravarer_product_cost_verified_completeness.sql | root |
| 20261011144355 | migrations/20261011144355_99fb6cab-02b6-4e61-bd71-6ad38b523a6c.sql | cf5b31f4bb231d931f33c8bf8c24a433 — snapshot-felt prishistorikk |
| 20261011145146 | migrations/20261011145146_dab1833f-618b-422c-afd9-6868a487febe.sql | cb34b74172777ab1df1e3a0f83aed939 — `_rm_manual_pdf_enqueue_match` + endelig `rm_save_manual_pdf_invoice` (kø i samme transaksjon, beskyttet replay-fortsettelse) |

20261011145146 ble kjørt via migrasjonsverktøyet og har migrasjonshistorikk; filen er byte-identisk med live
(md5 over `statements`). Live ACL bekreftet: `_rm_manual_pdf_enqueue_match` = postgres, service_role;
`rm_save_manual_pdf_invoice` = postgres, authenticated, service_role. Rotens stale-cache-migrasjon finnes ikke i
`schema_migrations` per 14:55 UTC og er derfor ikke speilet.

Sluttsjekk: 1744/1744 tester (vitest), typecheck ren, build OK. Isolert DB-test (rullet tilbake):
`supabase/tests/manual_pdf_replay_match_regression.sql` → replay1=true replay2=false queued=1 reconciled=false matched=false.
