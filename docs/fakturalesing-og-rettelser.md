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
