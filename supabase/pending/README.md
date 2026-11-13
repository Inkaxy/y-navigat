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
| `20261112_push_breadscale_floor.PENDING.sql` | **VENTER PÅ ROOT.** `push_products_to_nettside`: eneste endring mot live (md5 `0fc4425e…`) er `round(rec.breadscale_pct)` → `floor(rec.breadscale_pct)`. Ikke kjørt. Speiles i `supabase/live-mirror/` først etter at root har anvendt den godkjente SQL-en. |
| `20261112_push_breadscale_floor.check.sql` | Bare SELECT: forutsetning (md5) og hvilke varer som får et annet tall i push. Skriver ingenting. |
| `20261113_lines_sum_credit_vat.PENDING.sql` | **VENTER PÅ ROOT.** Rettepakke fakturalesing D+E: ny `rm_lines_sum_check(…, p_is_credit)`; kallerne `rm_correct_invoice_line` og `rm_apply_invoice_reread` får `is_credit_note` som 5. argument, og `rm_finalize_invoice_line_extraction` lagrer bilagets mva når hodet hadde 0 og importen melder `total_vat_zero_replaced`. Eksakte tekstbytter bundet til live-md5 13.11.2026; stopper ved avvik. Ikke kjørt. |
| `20261113_lines_sum_credit_vat.check.sql` | Bare SELECT: md5-forutsetninger, kreditnotaer med sumavvik, fakturaer med mva 0. |
| `20261113_line_extraction_release_requeue.PENDING.sql` | **VENTER PÅ ROOT.** A: `rm_fail_invoice_line_extraction` teller ikke forsøk når `release_attempt=true` (AI-tjenesten feilet). I: ny `rm_requeue_invoice_line_extraction` (skriverett, maks 200, linjesperren) for «Les på nytt i bolk». Ikke kjørt. |
| `20261113_line_extraction_release_requeue.check.sql` | Bare SELECT: md5, gruppe 1 (forventet 45), rettigheter. |
| `20261113_ai_fallback_provider.PENDING.sql` | **VENTER PÅ ROOT.** C: kolonnen `ai_provider_config.use_as_fallback` (+ sjekk og unik indeks). Endrer ingen rader; aktivering av reserven er en egen, kommentert linje. Ikke kjørt. |
| `20261113_ai_fallback_provider.check.sql` | Bare SELECT: kolonne og rader (uten nøkler). |
| `20261113_invoice_reading_alert_template.PENDING.sql` | **VENTER PÅ ROOT.** B: e-postmalen `invoice_reading_stopped`. Uten den legges ingen varsel-e-post i køen. Ikke kjørt. |
| `20261113_invoice_reading_alert_template.check.sql` | Bare SELECT: malen og varsler i køen. |

Edge `generate-rfq-credentials` er allerede utrullet live (v141, kilde lik b845). Skal ikke rulles ut på nytt fra denne mappen.
