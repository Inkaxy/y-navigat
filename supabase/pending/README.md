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
| `20261113_lines_sum_credit_vat.PENDING.sql` | **KJØRT AV ROOT 15.11.2026 — KJØR ALDRI PÅ NYTT.** Live-definisjonene av `rm_correct_invoice_line`, `rm_apply_invoice_reread` og `rm_finalize_invoice_line_extraction` er endret av denne; nye filer må binde md5 mot live etter 15.11. Rettepakke fakturalesing D+E: ny `rm_lines_sum_check(…, p_is_credit)`; kallerne `rm_correct_invoice_line` og `rm_apply_invoice_reread` får `is_credit_note` som 5. argument, og `rm_finalize_invoice_line_extraction` lagrer bilagets mva når hodet hadde 0 og importen melder `total_vat_zero_replaced`. Eksakte tekstbytter bundet til live-md5 13.11.2026. |
| `20261113_lines_sum_credit_vat.check.sql` | Bare SELECT: md5-forutsetninger, kreditnotaer med sumavvik, fakturaer med mva 0. |
| `20261113_line_extraction_release_requeue.PENDING.sql` | **KJØRT AV ROOT 15.11.2026 — KJØR ALDRI PÅ NYTT.** `rm_fail_invoice_line_extraction` er endret live av denne. A: `rm_fail_invoice_line_extraction` teller ikke forsøk når `release_attempt=true` (AI-tjenesten feilet). I: ny `rm_requeue_invoice_line_extraction` (skriverett, maks 200, linjesperren) for «Les på nytt i bolk». |
| `20261113_line_extraction_release_requeue.check.sql` | Bare SELECT: md5, gruppe 1 (forventet 45), rettigheter. |
| `20261113_ai_fallback_provider.PENDING.sql` | **VENTER PÅ ROOT.** C: kolonnen `ai_provider_config.use_as_fallback` (+ sjekk og unik indeks). Endrer ingen rader; aktivering av reserven er en egen, kommentert linje. Ikke kjørt. |
| `20261113_ai_fallback_provider.check.sql` | Bare SELECT: kolonne og rader (uten nøkler). |
| `20261113_invoice_reading_alert_template.PENDING.sql` | **VENTER PÅ ROOT.** B: e-postmalen `invoice_reading_stopped`. Uten den legges ingen varsel-e-post i køen. Ikke kjørt. |
| `20261113_invoice_reading_alert_template.check.sql` | Bare SELECT: malen og varsler i køen. |

Edge `generate-rfq-credentials` er allerede utrullet live (v141, kilde lik b845). Skal ikke rulles ut på nytt fra denne mappen.

| `20261117_beslutninger_angre.PENDING.sql` | **VENTER PÅ ROOT.** Variant B fase 1: `rm_undo_price_acceptance` og `rm_undo_not_item` (angre svar i Beslutninger) + `rm_cap_beslutninger_v1`. Ett tekstbytte i `_rm_retain_price_acceptance` bundet til live-md5 `35d0e2bd…` (16.11.2026). Endrer ingen data ved kjøring. |
| `20261117_beslutninger_angre.check.sql` | Bare SELECT: md5, rettigheter, antall godtatte linjer på åpne fakturaer. |
| `20261117_prislinje.PENDING.sql` | **VENTER PÅ ROOT.** Variant B fase 2: to nullbare kolonner for avviksgrense/periode, tabellen `rm_purchase_corrections`, `rm_correct_purchase_price` (+ angre), `rm_change_approved_package`, `rm_cap_prislinje_v1`. Ingen eksisterende funksjon endres. |
| `20261117_prislinje.check.sql` | Bare SELECT: kolonner, tabell/RLS, rettigheter, md5 på avhengigheter. |
| `20261117_automatikk.PENDING.sql` | **VENTER PÅ ROOT.** Variant B fase 3: nullbare innstillingskolonner, `invoice_lines.deposit_parent_line_id`, tabellen `rm_key_material_limits`, `rm_mark_deposit_follow_items`, `rm_requeue_stale_open_invoices`, `rm_automation_tick` (bare service), `rm_cap_automatikk_v1`. Starter ingen jobb. |
| `20261117_automatikk.check.sql` | Bare SELECT: kolonner, tabell, rettigheter, pantlinjer i dag, md5 på `rm_rematch_invoices`. |
| `20261117_automatikk_cron.DATAENDRING.sql` | **DATAENDRING — TAS SEPARAT MED HENRIK.** Del A: cron-jobb hver time som kaller `rm_automation_tick()`. Del B (kommentert ut): flytte de 130 eldre auto-koblede pantlinjene ut av kost. |

Lokal test av fase 1–3: `node scripts/test-variantb-sql.mjs` (PGlite med forenklet stubb av live-skjemaet, 35 kontroller). Stubben beviser logikken i de nye funksjonene, ikke at live-skjemaet er identisk.
