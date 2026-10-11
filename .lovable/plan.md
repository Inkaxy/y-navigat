# Råvarer 2.0 priskontroll: revisjon (bare lesing) og avtale for gjennomføring

Dette er en revisjon av de rutede produksjonskomponentene (ikke testdatasider) og live SQL. Ingen kode eller data er endret.

## 1. Funn per krav

| Krav | Kilde | Faktisk mangel |
|---|---|---|
| 3A gruppert prioritert kø | `gjore/GjoreWorkspace.tsx`, `gjore/WorkListView.tsx`, live `rm_work_items` | Én flat liste (`<ul role=listbox>`) med 50 rader per side. «Gruppe» er bare et filter (`?gruppe=`), ingen seksjoner etter leverandør, faktura eller alvorlighet. Varekort og fakturasaker blandes i samme rad-mal: pille, tittel, undertekst og «≈ kr». |
| 3A meningsfull prioritet | `rm_work_items` (`impact_nok`) | `impact_nok` = `variance_nok` ved prisavvik, **ellers `open_amount`** (bruttosum av åpne linjer). Så «mangler kobling/pakning» rangeres etter fakturabeløp, ikke etter økonomisk risiko. Det summeres over alle åpne fakturaer for varekortet, derfor kan PALS (faktura 29 652,45) vise ≈317 319 kr. |
| 3A neste handling | `WorkListView` | Raden viser ingen handling (som «Koble til råvare», «Bekreft 25 kg sekk» eller «Krev 1 240 kr kreditt»). Handlingen finnes bare i panelet til høyre. |
| 3A liste/titt i URL | `GjoreWorkspace` (`valgt`, `gruppe`, `sort`, `q`, `leverandor`) | Fungerer. Tittpanel vises bare ≥1280 px. Ingen grupperings- eller visningsparameter. |
| 3B arbeidsflate i tre soner | `faktura/FakturaWorkspace.tsx` (338 linjer) | Dokumentet er et valgfritt sidepanel (av som standard, lagret i localStorage). Linjer og inspektør ligger i `QueueWorkspace`. Det finnes også en «Vis som tabell»-bryter. Det er altså ikke tre faste soner: dokument, linjer, inspektør. |
| 3B én faktablokk | `InvoiceFactsSection`, `ReadIssuesBanner`, `ResultBox`, `SimilarLinesHint`, `WorkspaceHeader` | Fakta, lesevarsler, resultat og hint ligger i fem stablede blokker over linjene. Sum, mva, lesesikkerhet og kilde står i hver sin blokk. |
| 3B tidslinje og én CTA | `WorkspaceHeader.tsx`, `invoiceSteps.ts` | Én primærknapp finnes. Tidslinjen er bare en innebygd brikke (`DeliveryTimeline`), ikke en forklarende tidslinje. Hint-teksten står løsrevet under headeren. |
| 3B importpanel | `import/ImportSheet.tsx` | Fanene EHF/PDF/Manuelt bygger inn de gamle importsidene i et 3xl-panel. Det er ingen felles «last opp, forhåndsvis, lagre»-flyt. |
| 3C godkjenning | `godkjenning/GodkjenningTab.tsx`, `approvalColumns.tsx` | En tabell med kolonner, altså samme tette liste-mønster. Ingen gruppering, ingen beslutningskort med avvik og grunnlag. |
| 3C leverandørsaker | `saker/SakerTab.tsx`, `SupplierCaseDetail.tsx` | Liste og detalj. Ingen saksstatus-tavle og ingen synlig kreditt- eller beløpsoppfølging per leverandør i lista. |
| Teller-tall | `rm_work_summary` | Tallene (802/354/173/185/9/81) teller varekort og fakturasaker side om side. Brukeren ser ikke hva som er linjer og hva som er varer. |

## 2. Hvorfor dårlig leste historiske linjer gir kronevirkning

- Leseren (fase før v139/numberTokens) kunne lese `10.000` i mengdekolonnen som 10 000. Det gir gal `quantity`, `base_quantity` og `total_amount` på allerede importerte linjer.
- `rm_work_items` summerer `total_amount` for åpne linjer (`open_amount`) og `(pris − forventet) × base_quantity` (`variance_nok`) **uten å utelate linjer med lesevarsler** (`extraction_issues`) eller fakturaer med `lines_sum_status='mismatch'`.
- Ny feltbevisst parsing gjelder bare nye uttrekk. Gamle linjer blir aldri lest på nytt (se punkt 3).
- Hvilke PALS- og Idun-linjer som gir ≈317 kr og ≈274 kr er **ikke bekreftet ennå**. Første steg i gjennomføringen er en lesespørring som viser linjebidragene.

## 3. Ny lesing av en faktura som alt er importert

- Live `rm_claim_invoice_line_extraction` krever at `_rm_invoice_extraction_blocker(id)` er null. Blokkeringen slår inn så snart fakturaen har linjer (`har_linjer`), rettelser, kostprisføring, godkjenning eller avstemming.
- **Det finnes altså ingen vei for ny lesing av en importert faktura.** «Hent linjer» (`useInvoiceActions.ts`) virker bare når fakturaen mangler linjer. Manuell PDF har bare replay av samme lagring.
- Du har krevd forhåndsvisning av gammelt mot nytt mot kilden, at rettelser og førte linjer bevares, og at bare uttrykkelig gjennomgåtte endringer tas i bruk. Ingenting av dette finnes.

## 4. Avtale for gjennomføring (krever din godkjenning per trinn)

1. **Diagnose (bare lesing):** linjebidrag til `impact_nok` for PALS526301 og Idun, og antall linjer med lesevarsel eller sumavvik som bidrar.
2. **Ærlig prioritet (SQL, `rm_work_items`, samme kontrakt):** `impact_nok` er kun pris-/kreditteffekt. Linjer med lesevarsel eller faktura med sumavvik gir `impact_nok = null` og grunnen `lesing_ukontrollert`. Kobling og pakning sorteres etter frekvens og alder, ikke etter bruttobeløp. Ingen andre apper bruker denne funksjonen; det skal sjekkes før endringen.
3. **Ny lesing med forhåndsvisning (ny RPC-familie, ingen nye tabeller, lagring i `audit_log`):**
   - `rm_reextract_preview(invoice_id)`: edge-leseren kjører mot kilden (PDF/Tripletex) og returnerer gammel mot ny linje per linjenummer. Linjer med rettelse eller aktiv kostprisføring er merket låst.
   - `rm_reextract_apply(invoice_id, preview_token, accepted_line_ids[])`: én transaksjon som oppdaterer bare godtatte og ulåste linjer med versjonssjekk på `updated_at` og legger fakturaen i rematch-køen. Den nektes ved godkjent eller avstemt faktura.
4. **3A-kø:** grupperte seksjoner (Krever lesekontroll → Prisavvik → Kobling → Pakning → Fakturasaker), en neste-handling-knapp per rad, og tydelig «kr ukjent – lesing ikke kontrollert».
5. **3B-arbeidsflate:** faste tre soner ved ≥1280 px (dokument | linjer | inspektør), én sammenslått faktablokk med lesevarsler, og tidslinje i headeren. Under 1280 px blir det faner. Knapp for ny lesing med forhåndsvisning i diff-panel.
6. **3C:** beslutningskort for godkjenning, gruppert per leverandør med avvik. Saker får statuskolonner (Utkast / Sendt Henrik / Venter kreditt / Lukket) med beløp.
7. **Verifisering:** typecheck, build og eksisterende tester. Visuell sjekk på 390/1280/1440 px via DeskPreview-mønsteret, med ekte rutede komponenter. Innlogget sjekk gjør root.

## Tekniske detaljer

- Nøkkelfiler: `src/ravarer/pages/hub/PriskontrollPage.tsx`, `priskontroll/gjore/{GjoreWorkspace,WorkListView,logic}.tsx`, `priskontroll/faktura/{FakturaWorkspace,WorkspaceHeader,InvoiceFactsSection,ReadIssuesBanner,invoiceSteps}.tsx`, `priskontroll/import/ImportSheet.tsx`, `priskontroll/godkjenning/*`, `priskontroll/saker/*`, `src/ravarer/hooks/useWorkData.ts`.
- SQL: `rm_work_items`, `rm_work_summary`, `rm_claim_invoice_line_extraction`, `_rm_invoice_extraction_blocker`, `rm_finalize_invoice_line_extraction`, `rm_correct_invoice_line`, `rm_save_manual_pdf_invoice`, `rm_rematch_invoices`.
- Edge: `extract-invoice-lines` / `_shared/invoiceExtraction.ts`, `tripletex-import-invoice-lines/rows.ts` (repoet er kilden).
- Trinn 2 og 3 er databaseendringer. Live-definisjonen leses med `pg_get_functiondef` før endring.
