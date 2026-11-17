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

## Variant B (17.11.2026)

| Fil | Status |
|---|---|
| `20261117_beslutninger_angre.PENDING.sql` | **VENTER PÅ ROOT.** Variant B fase 1: `rm_undo_price_acceptance` og `rm_undo_not_item` (angre svar i Beslutninger) + `rm_cap_beslutninger_v1`. Ett tekstbytte i `_rm_retain_price_acceptance` bundet til live-md5 `35d0e2bd…` (16.11.2026). Endrer ingen data ved kjøring. |
| `20261117_beslutninger_angre.check.sql` | Bare SELECT: md5, rettigheter, antall godtatte linjer på åpne fakturaer. |
| `20261117_prislinje.PENDING.sql` | **VENTER PÅ ROOT.** Variant B fase 2: to nullbare kolonner for avviksgrense/periode, tabellen `rm_purchase_corrections`, `rm_correct_purchase_price` (+ angre), `rm_change_approved_package`, `rm_cap_prislinje_v1`. Ingen eksisterende funksjon endres. |
| `20261117_prislinje.check.sql` | Bare SELECT: kolonner, tabell/RLS, rettigheter, md5 på avhengigheter. |
| `20261117_automatikk.PENDING.sql` | **VENTER PÅ ROOT.** Variant B fase 3: nullbare innstillingskolonner, `invoice_lines.deposit_parent_line_id`, tabellen `rm_key_material_limits`, `rm_mark_deposit_follow_items`, `rm_requeue_stale_open_invoices`, `rm_automation_tick` (bare service), `rm_cap_automatikk_v1`. Starter ingen jobb. |
| `20261117_automatikk.check.sql` | Bare SELECT: kolonner, tabell, rettigheter, pantlinjer i dag, md5 på `rm_rematch_invoices`. |
| `20261117_automatikk_cron.DATAENDRING.sql` | **DATAENDRING — TAS SEPARAT MED HENRIK.** Del A: cron-jobb hver time som kaller `rm_automation_tick()`. Del B (kommentert ut): flytte de 130 eldre auto-koblede pantlinjene ut av kost. |

Lokal test av fase 1–3: `node scripts/test-variantb-sql.mjs` (PGlite med forenklet stubb av live-skjemaet, 35 kontroller). Stubben beviser logikken i de nye funksjonene, ikke at live-skjemaet er identisk.

## Variant B runde 3 (18.11.2026)

Ingen av filene fra 17.11 er kjørt (venter på Henriks ja). Alt som avhenger av dem er skjult/deaktivert bak `rm_cap_*`/`varer_cap_*`.

| Fil | Status |
|---|---|
| `20261118_handelsvarer.PENDING.sql` | **VENTER PÅ ROOT.** Fase 4: `entity_calc_settings.resale_default_factor` (null = 1,2), tabellen `resale_markup_settings` (påslag per prisliste, per vare, eller vare × prisliste med sperre) med RLS og grants, `varer_cap_handelsvarer_v1`. Bare additivt, endrer ingen data. Ingen eksisterende funksjon endres. |
| `20261118_handelsvarer.check.sql` | Bare SELECT: kolonne, tabell, RLS, policyer, rettigheter, 0 rader, cap. |
| `20261118_prisgrunnlag.PENDING.sql` | **VENTER PÅ ROOT.** Fase 5: `entity_calc_settings.packaging_in_margins` (null = på), `calc_packaging_in_margins(product)`, tekstbytte i `h4_margin_eval` (live-md5 `da19eefa…`) og `product_margins` (live-md5 `1c4d594c…`, lest 16.11.2026) slik at emballasje teller i Brutto og DG2, og `product_margins` svarer `packaging_in_margins`. Stopper hele filen hvis en definisjon er endret. Endrer ingen data; i dag finnes 0 emballasjelinjer, så ingen margin endres ved kjøring. |
| `20261118_prisgrunnlag.check.sql` | Bare SELECT: kolonne, begge funksjoner bruker innstillingen, cap. |

Lokal test: `node scripts/test-variantb-r3-sql.mjs` (PGlite med kopier av live-definisjonene i `scripts/fixtures/live-20261116/`, 18 kontroller: Brutto/DG2 med og uten emballasje, vakten stopper ved endret definisjon, påslagstabellens regler).

`supabase/functions/match-invoice-lines` + `_shared/automationRules.ts` er endret i repoet (nøkkelgrenser + pant som følgevare) men **ikke rullet ut av meg**. Begge reglene er av til `20261117_automatikk` er kjørt (manglende tabell gir PGRST205 → ingen grenser; manglende kolonne → pant av), så utrulling før SQL endrer ikke oppførselen.

## Demo D «Fra faktura til vare» (19.11.2026)

Status 17.11: `20261117_beslutninger_angre` er kjørt. Ingen av de andre filene fra 17.–18.11 er kjørt, og «Fra faktura» trenger ingen av dem.

| Fil | Status |
|---|---|
| `20261119_fra_faktura.PENDING.sql` | **VENTER PÅ ROOT.** Nullbare kolonner (`invoice_match_settings.price_jump_pct`/`fra_faktura_quiet_prices`/`fra_faktura_invoice_package`, `raw_materials.price_jump_pct`/`cost_basis_rule`, `suppliers.new_item_type`), funksjonene `rm_fra_faktura_settings`, `rm_set_fra_faktura_settings`, `rm_set_item_price_jump`, `rm_set_supplier_new_item_type`, `rm_remember_supplier_item_names`, `rm_undo_supplier_item_link`, `rm_set_cost_basis_rule`, `_rm_cost_rule_ok`, `rm_cap_fra_faktura_v1`, og tekstbytte i `_rm_cost_candidates` bundet til live-md5 `5a28cc1e…` (17.11.2026). Begge matchingreglene er av etter kjøring; `cost_basis_rule` er null for alle varer (= dagens oppførsel for varer med én leverandør). Endrer ingen data. |
| `20261119_fra_faktura.check.sql` | Bare SELECT: kolonner, funksjoner, rettigheter, md5 etter bytte, varer med flere leverandører. |
| `20261119_fra_faktura_opprydding.DATAENDRING.sql` | **DATAENDRING — TAS SEPARAT MED HENRIK.** `rm_fra_faktura_cleanup(le, p_dry_run default true)`: dry-run viser antall linjer per årsak og leverandør og skrivemåter som ville blitt husket. Uten dry-run (krever at reglene er slått på) legges manglende skrivemåter til og berørte fakturaer kjøres gjennom dagens `rm_rematch_invoices`. Ingen direkte linjeendring. |

| `20261119_nye_varer_les.PENDING.sql` | **VENTER PÅ ROOT.** Bare tillegg: lesefunksjonen `rm_new_items_queue(le, supplier, limit, offset)` (én rad per leverandørvare, eldste først, sidevis, tellere og antall per leverandør) og `rm_cap_nye_varer_v1`. Samme gruppering/klassifisering som `rm_work_items`, men uten lesekontroll og prisvirkning per linje. `rm_work_items` røres ikke. Ingen indekser trengs. Endrer ingen data. Uavhengig av de andre filene. |
| `20261119_nye_varer_les.check.sql` | Bare SELECT: funksjonene finnes, `rm_work_items` md5 uendret (`efe0f95e…`), samme antall kobling/pakning som `rm_work_items`, rettigheter. |

| `20261119_godta_sum.PENDING.sql` | **VENTER PÅ ROOT.** Bare tillegg: `rm_accept_invoice_sum` (kategori + begrunnelse, versjon, op_id, notat + audit_log, setter `lines_sum_status='ok'` som dagens overstyring), `rm_undo_accept_invoice_sum` (bare uendret, ulåst faktura) og `rm_cap_godta_sum_v1`. Avviser fakturaer med lesevarselet `sumavvik_mva_forhold`. Statusbegrensningen og eksisterende funksjoner røres ikke. Endrer ingen data. |
| `20261119_godta_sum.check.sql` | Bare SELECT: funksjoner, rettigheter, statusbegrensningen uendret. |
| `20261119_sumkontroll_omregning.dryrun.sql` | Bare SELECT: hvilke åpne fakturaer med sumavvik som ville fått ny status med dagens `rm_lines_sum_check`. Målt read-only 17.11: 6 av 38 blir «ok», alle kreditnotaer, ingen låst. |
| `20261119_sumkontroll_omregning.DATAENDRING.sql` | **DATAENDRING — IKKE KJØRT, TAS SEPARAT MED HENRIK.** Regner sumkontrollen på nytt for åpne, ulåste fakturaer med avvik og endrer bare dem som får ny status; audit_log per faktura; md5-vakt `cd7ff540…` på `rm_lines_sum_check`. Ingen linjer endres. |

Lokal test: `node scripts/test-godta-sum-sql.mjs` (PGlite med live-kopi av `rm_lines_sum_check`: godta, gjentak, versjon, mva-forhold, angre, dry-run, DATAENDRING og md5-vakt).

Lokal test: `node scripts/test-nye-varer-sql.mjs` (PGlite med live-kopi av `rm_work_items`: samme rader, tellere og rekkefølge, sidevis, tilgang). Lokal test: `node scripts/test-frafaktura-sql.mjs` (PGlite med live-kopi av `_rm_cost_candidates` i `scripts/fixtures/live-20261117/`).

`supabase/functions/match-invoice-lines` er endret i repoet (prishopp-grense, stille prisendring under grensen, entydig pakning fra fakturaen, første pris på sikker kobling) men **ikke rullet ut av meg**. Reglene leses fra kolonnene over og er av når kolonnene mangler eller står av, så utrulling før SQL endrer ikke oppførselen.

Kan utgå/slås sammen: `rm_key_material_limits` i `20261117_automatikk` overlapper med egen grense per vare (`raw_materials.price_jump_pct`). `20261117_prislinje`, `20261118_handelsvarer` og `20261118_prisgrunnlag` er uavhengige av «Fra faktura» (Prishopp regner marginkonsekvens med dagens `product_margins`). `20261117_automatikk_cron.DATAENDRING` trengs ikke.

## Opprydding – kun versjon D (17.11.2026)

Ingen ny SQL, ingenting kjørt, ingen databasefunksjoner eller tabeller slettet.

- Ikke lenger kalt fra frontend: `rm_work_item_plan_lines` (bare den fjernede gamle arbeidslisten brukte den) og `rm_key_material_limits` (nøkkelråvaregrenser utgår; «egen grense per vare» erstatter dem).
- `20261117_automatikk.PENDING.sql`: **utgår delvis.** Tabellen `rm_key_material_limits` trengs ikke lenger. Resten (pant som følgevare, automatisk ny lesing, `rm_cap_automatikk_v1`) brukes fortsatt av Innstillinger › «Automatikk og regler» og svarknappene. Root/Henrik avgjør om tabelldelen strykes før kjøring. `match-invoice-lines`/`_shared/automationRules.ts` i repoet leser fortsatt nøkkelgrenser (manglende tabell = ingen grenser).
- `20261117_automatikk_cron.DATAENDRING.sql`: **utgår** (som før – trengs ikke).
- `20261117_prislinje.PENDING.sql`: **trengs fortsatt.** Prishistorikk, «Rett pris» og «Endre godkjent pakning» er flyttet til varens Pris-seksjon under Varer og bruker samme funksjoner (`rm_cap_prislinje_v1`).

