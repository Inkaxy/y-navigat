# Fakturalesing, rettelser, læringseksempler og kladd til Henrik (2026-10-11)

## Databasekontrakter (nye)
- `invoices.extraction_issues`, `invoice_lines.extraction_issues` (jsonb `[{code, message}]`, standard `[]`). Kan bare endres av server-RPC-er eller tjenestekall (trigger beholder gammel verdi ved klientoppdatering).
- `rm_line_read_issues(...)`: kontroll av mengde × pris mot linjesum, også via pakning (36x90g), enhetsfaktor (g/kg, ml/cl/dl/l) og mulig rabatt. Speilet i `src/fakturaer/lib/invoiceReadCheck.ts` (byte-identisk kopi i `supabase/functions/_shared/`).
- Trigger `trg_invoice_lines_read_issues`: kontrollerer hver NY linje (PDF-import, Tripletex-import, EHF, manuell). Linje med varsel holdes til gjennomgang (`requires_review`, `review_reason` + `extraction_issue`), også etter ny matching.
- Trigger `trg_invoices_read_issues`: sumavvik med samme forhold som en mva-sats (×1,25/1,15/1,12 eller omvendt) gir varselet `sumavvik_mva_forhold`. Beløp skaleres aldri; en manglende linje kan gi samme forhold. En faktura med varsler kan ikke gå til `ready`.
- `invoice_approval_blockers` gir `lesefeil`; `rm_post_safe_line_costs` stopper på `lesefeil`; `_rm_reconcile_core` stopper automatisk (reason `lesefeil`) og manuell avstemming.
- `rm_correct_invoice_line(p_line_id, p_expected_updated_at, p_changes, p_reason, p_learn, p_accept_issues)`: én transaksjon, skrivetilgang i selskapet, lås på faktura og linje, versjonskontroll på `updated_at`. Sperret for avstemt/flagget/lukket, internt godkjent og kostprisført linje. Lagrer original/korreksjon i `invoice_line_corrections`, nullstiller avledet pris/prisaksept (og kobling når varenr/tekst/linjetype endres), regner linjesum på nytt, revisjonslogg, og legger fakturaen i kø for ny beregning.
- `rm_confirm_invoice_read_issues(p_invoice_id, p_reason)`: bekrefter varsler på fakturanivå mot originalen (beløp endres ikke).
- `invoice_extraction_examples` + `rm_extraction_examples_for(legal_entity, supplier)` + `rm_set_extraction_example_active`. Eksempler deles aldri mellom selskap eller leverandør.
- `supplier_case_email_drafts` + `supplier_case_save_email_draft`, `supplier_case_queue_draft_to_henrik` (mottaker fast på serveren: Henrik@nottero-bakeri.no, ingen cc/bcc, idempotent per kladdversjon via unik indeks på `email_outbox`), `supplier_case_email_drafts_list` (i kø / sendt / feilet).
- E-postmal `supplier_case_draft_internal` (eksisterende renderer i `microsoft-graph-send` HTML-escaper alle variabler).
- `invoice_approval_overview` fikk kolonnen `cost_line_total` (sist), så delvis kostprisføring vises som N av M.

## UI
- Faktura-arbeidsflaten: «Rett fakturalinje» i linjeinspektøren (dokumentet ved siden av, før/etter, begrunnelse, linjetype med forklaring, «Bruk rettelsen ved senere lesing»), banner for lesevarsler med «Bekreft lesingen».
- Leverandørsak: redigerbar kladd, versjoner, «Send kladd til Henrik», status.
- Delvis kostprisføring: «Delvis ført: N av M», «Før kostpris for resten (N gjenstår)».

## Tester
- `src/test/fakturalesing.test.ts` (syntetiske fakturaer: manglende linje med 1/1,25-forhold, store norske tall, 36x90g, per kg vs pakning, rabatt, kreditnota, 0 linjer første forsøk, ugyldig sikkerhet, låste linjer, kladd, delvis føring).
- Server: gjennomkjørt i en transaksjon som ble rullet tilbake (ingen data lagret): varsler ved innsetting, forholdsvarsel, blokkere, klient kan ikke slette varsler, versjonskonflikt, rettelse med læringseksempel.

## Begrensninger
- Live `extract-invoice-from-pdf` (v139 med `fixVatScaledLines`), `tripletex-import-invoice-lines` og `match-invoice-lines` er nyere enn koden i dette prosjektet. Å endre dem her ville rulle ut gammel kode. Derfor er ikke fjerning av `fixVatScaledLines`, nytt forsøk ved tomt resultat og eksempelkontekst i modellkallet lagt inn i edge-funksjonen. Den delte modulen `_shared/invoiceReadCheck.ts` og `rm_extraction_examples_for` er klare til bruk når live-kilden er tilgjengelig. Kontrollene i databasen gjelder uansett for alle nye linjer.
- `fixVatScaledLines` kan fortsatt skalere beløp før de lagres, og en skalert faktura ser lik ut som en riktig. Den feilen fanges ikke før edge-funksjonen er rettet.

## Tillegg 2026-10-11 (live-kontroll)
- `rm_repair_invoice_vat` endrer aldri beløp eller mva; returnerer `{ok:false, reason:'kontroll_trengs', suggestion, factor, ratio}`. Gjelder også automatisk kall fra live Tripletex-import og `rm_repair_invoice_vat_batch`. Gamle data er ikke reversert: 15 `linjer_skalert` og 104 `mva_utledet` i revisjonsloggen (`invoice.vat_repaired`) trenger dokumentkontroll.
- `process-email-outbox` (deployet): krever service-bearer eller `X-Cron-Secret`; atomisk claim (bare `pending`); ingen replay av sendt; ukjent utfall → `failed` med forklaring, ikke ny sending. Trigger låser Henrik-kladder til fast mottaker/mal.
- Nye tabeller: bare `SELECT` for innloggede (RLS), skriving via RPC-er.
- Godkjenningstelleren: `rm_work_summary.approval.ready_to_approve` = samme regel som listens «Klare».
- Gamle beslutningslenker beholder leverandør, varenummer (søk) og gruppe.

## Kostpris: nyeste gyldige pris (2026-10-11)
- Én velger: `_rm_cost_candidates(rm, dato)` (intern). Nyeste `effective_date <= rm_oslo_today()`, deretter `created_at`, `id`. På tvers av leverandører (primær styrer bare innkjøp). Gyldig: samme selskap, NOK, pris > 0, ikke kreditnota/legacy/utgått; fakturalinje fortsatt koblet, bekreftet match, ikke til gjennomgang, sikker mengde, faktura klar/avstemt/kostprisført/tiltrodd, uten sumavvik (unntatt avstemt) og uten lesevarsler; eller dokumentert manuell/avtale/prisliste-rad med bruker og begrunnelse. `recalc`-rader teller ikke lenger.
- `rm_apply_derived_cost_price`: ingen datovakt, ingen permanent manuell frys; faller tilbake ved ugyldiggjøring (avkobling, gjennomgang, flagg, revokering). Uten gyldig kilde beholdes prisen (status «uverifisert»), aldri null. Eldre manuell pris uten dokumentert historikk vinner bare når den er nyere.
- `rm_set_documented_cost_price` (atomisk, rettighet + selskap, historikk + revisjon), `rm_cost_price_source`, `rm_cost_price_deviations`, `rm_refresh_cost_prices` (bare på brukerens valg), `rm_activate_due_cost_prices` (cron hver time).
- `recalc_raw_material_cost`: ingen 25 %-regel; førte linjer endres aldri; historisk pakning = linjens egen dokumenterte pakning, ellers entydig variant; flere varianter → endres ikke. Kostpris settes av felles velger.
- `recipe_line_base_qty`: vekt regnes ikke om til volum uten tetthet (som appen).
- Grunnenhetsbytte setter eksisterende observasjoner som utgått (`enhet_endret`).
- Testet i rullet-tilbake SQL-fixture: eldste → sekundær +30 % → gammel importert etter → avkoblet nyeste faller tilbake → samme dato (senest opprettet) → manuell gammel påvirker ikke → manuell fremtidig planlagt → manuell i dag gjeldende → pris 0 avvist → kreditnota teller ikke → ingen kilde = uverifisert → 36x90g = 30 kr/kg, 5/10 kg = 20/18 kr/kg → gram→liter = null → enhetsbytte fjerner kandidater.
- Begrensninger: avviksoversikten er ikke kjørt innlogget mot live (tallene 34/35 er fra kontrollen); avvikene rettes først når noen trykker «Oppdater valgte» eller en faktura endres. Utgåtte hendelser viser årsak og dato, men ikke «etter»-verdien side om side. Oppskrifter merker manglende pris, men ikke «uverifisert». Åpne kalkyler hentes på nytt ved fokus og hvert 2. minutt (ikke sanntid).

## Linjekontroll v2 (2026-10-11)
- `rm_line_read_issues_v2(..., p_is_credit, p_basis, p_discount, p_line_kind)` er regelen; den gamle 8-parameter-funksjonen kaller v2 uten grunnlag.
- `invoice_lines.unit_price_basis` (mengdeenhet|pakning|stk|kg|g|l|ml) og `discount_amount` (positiv kr). Ukjent grunnlag godtar bare mengde × pris; passer summen bare via pakning/vekt → `prisgrunnlag_uavklart`.
- Varelinjer uten mengde/pris → `mengde_eller_pris_mangler`; frakt/gebyr/avrunding/mva/pant/annet/rabatt kan ha bare beløp. Positiv rabattlinje på vanlig faktura → `fortegn`.
- Fortegn kontrolleres med fortegn: motsatt fortegn på vanlig faktura → `fortegn`; kreditnota godtar begge.
- Rettelse med godtatte avvik lager læringseksempel som er AV og merket `accepted_issues`; må slås på manuelt. Eksempler gjør aldri linjer trygge — kontrollen kjøres alltid.
- Begrensning: live-uttrekkene (PDF v139, Tripletex v67) kunne ikke hentes; de fyller ennå ikke `unit_price_basis`/`discount_amount`. Inntil da blir pakning-/vektprisede linjer «prisgrunnlag uavklart» ved import og må avklares i «Rett fakturalinje».

## Utrullingsparitet leser/import (2026-10-11)
- Repo bygget fra verifisert live-baseline (leser v139, import v67) + rettelser; deretter deployet KUN `extract-invoice-from-pdf` og `tripletex-import-invoice-lines`.
- Kilde-SHA256 ved deploy: leser 85165b681f4cb2ef33189d73ad83f508f84701876b9879eff177e07ba47892ac, import 917e07913159dab950bcba5913068651f45aadcc5af69c453a47d02f0dc02da3.
- Logikk i `_shared/invoiceExtraction.ts` og `tripletex-import-invoice-lines/rows.ts` (vitest: `src/test/fakturaleserParitet.test.ts`).
- Fjernet: `fixVatScaledLines`. Lagt til: retry ved tomt/ugyldig svar, norske tall, linje-confidence, sikkerhet fra regnestykke + alle linjer, læringseksempler (selskap+leverandør, som data), prisgrunnlag og rabatt helt til `invoice_lines`.
- Manuell PDF-import har ikke leverandør før lesing og får derfor ikke læringseksempler.
