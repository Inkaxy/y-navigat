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

## Prisstatus og leverandørsak (root, 2026-10-11)

Kjørt av root direkte mot live og registrert i `schema_migrations`. Filene er byte-identiske med live `statements[1]`
(md5 og lengde kontrollert mot registeret). ALDRI kjør på nytt. 20261011163018 (materialprojeksjon) hører til fase 4 og er ikke speilet her.

| Versjon | Fil | md5 / lengde |
|---|---|---|
| 20261011162824 | live-mirror/20261011162824_invoice_line_authoritative_price_safety.sql | d51135c7c83b7d55b6457181daa349df / 2638 |
| 20261011163255 | live-mirror/20261011163255_supplier_case_verified_claim_or_inquiry.sql | f8a07664e509b0620a6c81b476880a0b / 24069 |

Live ACL ved speiling: `rm_invoice_line_price_safety` og `rm_supplier_claim_preview` = postgres, authenticated;
`_rm_claim_basis` = postgres; `rm_supplier_item_claim_credit`, `supplier_case_save_email_draft`,
`supplier_case_queue_draft_to_henrik` = postgres, authenticated, service_role.

## Prisstatus schema 2 og dokumentversjon (root, 2026-10-11)

Anvendt av root direkte mot live (ALREADY APPLIED). Filene er repositoryspeil av SQL-teksten root leverte, med en
innledende kommentar «ALREADY APPLIED». ALDRI kjør på nytt. Ikke kontrollert mot `schema_migrations` fra denne økten.

| Fil | sha256 |
|---|---|
| live-mirror/rm_invoice_line_price_safety_v2.sql | 41078fc5c368b8d4903f1d7becd9bfd391c6c58e7e3dcbe80f388087104094e6 |
| live-mirror/rm_invoice_document_version.sql | d570a82948ea74738538dbc63e72d0dc61b4cbfeb1072158b3f0a065133d3720 |
