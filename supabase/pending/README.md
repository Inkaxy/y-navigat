# Ventende forslag

Filer her er forslag til uavhengig gjennomgang og ligger utenfor `supabase/migrations`
fordi den mappen kjøres av verktøyet. Root kjører eksakt godkjent fil, aldri «alle ventende».

| Fil | Status |
|---|---|
| `20261012_negotiation_item_preservation.PENDING.sql` | **ERSTATTET — KJØR ALDRI.** Opprinnelig forslag var mangelfullt (bl.a. hjelpefunksjonens ACL og manglende varig utstedelsesmarkør). Den korrigerte, gjennomgåtte versjonen ble anvendt live 2026-10-12 ~05:49 UTC og er speilet i `supabase/live-mirror/negotiation_item_preservation_reviewed.sql`. Filen beholdes bare som historisk bevis. |
| `20261012_varetelling_foundation.PENDING.sql` | **UTRULLET AV ROOT 12.10.2026** som `varetelling_foundation_reviewed` (rev. 2, eksakt `42b9835d`). Speil: `supabase/live-mirror/varetelling_foundation_reviewed.sql`. KJØR ALDRI PÅ NYTT — endringer krever ny additiv migrasjon. Filen beholdes fordi tester leser den. |
| `20261012_varetelling_foundation.test.sql` | Lokal PGlite-test (`node scripts/test-varetelling-sql.mjs`), 111 kontroller, seriell — ikke parallell samtidighet. |
| `20261012_negotiation_item_preservation.test.sql` | Historisk isolert enkeltøkt-test skrevet mot det erstattede forslaget. Beholdt som bevis; dekker ikke `rfq_issued_at`. Samtidighet i to økter er ikke verifisert. |
| `20261012_varetelling_stage3.PENDING.sql` | **UTRULLET AV ROOT 12.10.2026** som `varetelling_document_reports_reviewed` (rev. 4, eksakt `42b9835d`). Speil: `supabase/live-mirror/varetelling_document_reports_reviewed.sql`. KJØR ALDRI PÅ NYTT. |
| `20261012_varetelling_stage3_storage.PENDING.sql` | **POLICYER UTRULLET AV ROOT 12.10.2026** som `varetelling_private_upload_policies_reviewed` (eksakt `bfbe3d3a`). Speil: `supabase/live-mirror/varetelling_private_upload_policies_reviewed.sql`. Bøtten (privat, 20 MiB, MIME-liste NULL) ble opprettet med Storage-API. KJØR ALDRI PÅ NYTT. |
| `20261012_varetelling_stage3.test.sql` | Lokal PGlite-test, kjøres etter grunnlagets test i samme skript (totalt 196 kontroller), seriell. |
| `functions/vt-count-ocr/`, `functions/vt-count-report-email/`, `functions/_shared/vtReport.ts` | **UTRULLET AV ROOT 12.10.2026** (verify_jwt=true, med relative avhengigheter): `vt-count-ocr` v1 = `42b9835d`, `vt-count-report-email` v1 = `d753fa8d`. Speil: `supabase/live-mirror/functions/`. Kildene blir liggende her fordi frontend/tester importerer dem; de flyttes IKKE til `supabase/functions/` (auto-utrulling). Endring = ny gjennomgått versjon rullet ut av root. |

Edge `generate-rfq-credentials` er allerede utrullet live (v141, kilde lik b845). Skal ikke rulles ut på nytt fra denne mappen.
