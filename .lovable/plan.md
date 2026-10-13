# Ny fakturahåndtering – kartlegging og plan

## Kartlegging (det som finnes i dag)

- **Import/tolkning:** `extract-invoice-from-pdf`, `import-ehf-invoice`, Tripletex (`tripletex-import-invoice-lines/rows.ts`), felles `_shared/invoiceExtraction.ts` og `_shared/numberTokens.ts`. Manuell PDF lagres atomisk via `rm_save_manual_pdf_invoice`. Lesevarsler settes server-side (`extraction_issues`, `rm_line_read_issues_v2`, speilet i `invoiceReadCheck.ts`). Gjenlesing: `reread-invoice-preview` + `rm_apply_invoice_reread`.
- **Forslag:** `match-invoice-lines` (trigram, aliaser, utelatelsesmønstre, avtaler) skriver til `invoice_line_match_suggestions`; AI-forslag på forespørsel (`aiLineSuggestion.ts`, `suggest-invoice-line-match`). Kobling via `useLineMatchForm` → `acceptMatch` → `link-supplier-item`/`rm_link_supplier_item`.
- **Pakning/pris:** `rm_infer_package`, `raw_material_supplier_packages`, `units.ts` (`resolveLineCost`, `packageNeedsConfirmation`), `rm_price_reference` med datorekkefølgefix (b88c6abe), `rm_invoice_line_price_safety` v2.
- **Arbeidskø:** `rm_work_items` (Å gjøre/GjoreWorkspace, varekort per leverandørvare), Fakturaer-listen (`FakturaerTab`), egen faktura-arbeidsflate (`FakturaWorkspace.tsx`, 475 linjer), eldre inbox-komponenter (`inbox/QueueWorkspace`, `LineList`, `FocusHeader`, `task/*`).
- **Godkjenning:** `approve_invoice_internal` (krever approve/admin), `GodkjenningTab`, `approval.ts`.

## Faktiske hull

1. **Tre parallelle arbeidsflater** (Å gjøre, Fakturaer → faktura, eldre inbox) for samme jobb; brukeren må vite hvor.
2. **Forslag er ikke forklart:** listen viser én status, ikke hvorfor et forslag er rangert (varenummer, tidligere kobling, navnelikhet, pakning, pris mot referanse).
3. **Ingen samlet «neste handling»** per linje; `queuePrimaryAction.ts` finnes, men brukes ikke likt overalt.
4. **Original og linjer** ligger side om side bare i faktura-arbeidsflaten, ikke i køen.
5. **Ny-matching etter import stopper:** `rm_rematch_tick` sender bare `X-Cron-Secret`; `match-invoice-lines` leser bare `Authorization` og svarer 401. Køen tømmes derfor ikke automatisk, så nye linjer får ikke forslag før noen åpner fakturaen.

## Løsning: ett arbeidsbord

```text
/ravarer/priskontroll?fane=gjore            (samme URL, ny flate)
+-----------------------+------------------------------+
| Faktura-/linjeliste   | Original (PDF.js) | Linje    |
| Sikre treff (n)       |                   | Forslag  |
| Avklaringer (n)       |                   | 1..3 m/  |
| Behandlet (n)         |                   | grunner  |
|                       |                   | [Neste   |
|                       |                   |  handling]|
+-----------------------+------------------------------+
```

- Tre spor: **Sikre treff** (serveren har allerede gitt sikker kobling + trygg pakning + trygg pris; brukeren bekrefter i bunt, aldri automatisk godkjenning), **Avklaringer** (alt annet, sortert eldste fakturadato først i tråd med datofixen), **Behandlet** (historikk, angre der det allerede støttes).
- Midten: original med markert linje (gjenbruk `PdfDocumentViewer`/`InvoiceDocumentLayout`).
- Høyre: inntil tre rangerte forslag, hvert med grunnlinjer («Samme varenummer som 12 tidligere fakturaer», «Pakning 6×1 kg bekreftet 03.09», «Pris +2,1 % mot avtale»). Én primærknapp fra `queuePrimaryAction`; øvrige valg under «Flere valg».
- Detaljlenker, `?linje=`, `?retur=`, varekort, faktura- og saksruter beholdes uendret; Fakturaer-fanen og Godkjenning forblir som de er.
- Ingen endring av automatikkgrenser (`invoice_match_settings`) før brukeren har bestemt nivå; «Sikre treff» leser bare dagens serverstatus.

## Leveranser (hver for seg reversibel)

1. **Rematch 401 (backend, liten):** les først live `match-invoice-lines` (v183) og bygg på den, ikke repokoden. Legg til `authorizeCron` fra `_shared/cron-auth.ts` (verifisert `X-Cron-Secret` via `verify_cron_secret` eller service-bearer); bruker-JWT + `has_ravarer_invoice_access` uendret. Speil i `supabase/live-mirror/functions/`. Ingen endring i `rm_rematch_tick`.
2. **Forklarte forslag (backend, ingen ny tabell):** motoren lagrer begrunnelser i eksisterende forslagsrad (kolonne for poeng/metadata i `invoice_line_match_suggestions` kontrolleres live; finnes den ikke, regnes grunnene ut på klienten fra eksisterende data: alias, historikk, pakningsvarianter, `rm_price_reference`). Spør før eventuell ny kolonne.
3. **Arbeidsbordet (frontend):** nye filer under `src/ravarer/pages/priskontroll/arbeidsbord/`: `Arbeidsbord.tsx`, `SporListe.tsx`, `ForslagPanel.tsx`, `forslagGrunner.ts`, `sporLogic.ts`, `useArbeidsbord.ts`. Gjenbruker `rm_work_items`, `useLineMatchForm`, `useInvoicePriceSafety`, `PdfDocumentViewer`, `DataTable`/`SplitView`. Koblet inn i `PriskontrollPage.tsx` bak samme `fane=gjore`; gammel `GjoreWorkspace` beholdes bak `?visning=klassisk` til godkjent fjerning.
4. **Bunt-bekreftelse av sikre treff:** bruker eksisterende `bulkGjore.ts`/`bulkPreview.ts` (frosset grunnlag, synkron lås, ukjent utfall sperrer).
5. **Opprydding (senere, egen godkjenning):** eldre inbox-komponenter fjernes først når funksjonslisten (`docs/ravarer-funksjonsliste.md`) viser at alt er dekket.

## Tekniske detaljer

- Krever backend: leveranse 1 (Edge-utrulling av ny versjon bygget på live kilde) og evt. 2. Resten er frontend.
- Bevares: b88c6abe-datorekkefølgen, R192/R195, prissertifisering, korrigerings- og gjenlesingsflyt, alle ruter.
- Tester: `cron-auth.test.ts` utvides (feil/kort/ukjent hemmelighet avvises, gyldig godtas, bruker-JWT uendret); nye vitest for `sporLogic` (sortering eldste først, ukjent ≠ sikker), `forslagGrunner` (rangering, ingen gjettet pakning/enhet), arbeidsbordet (URL-bevaring, fokus/Escape, 390/1280/1440); eksisterende 2545 tester + `price_date_order_regression.sql` kjøres. Ende-til-ende bare i syntetisk forhåndsvisning (`/forhandsvisning/...`); ingen ekte fakturaer endres, ingen e-post, AI eller godkjenning i testing.
- Åpent spørsmål til brukeren: nivå for framtidig automatisk godkjenning (håndteres som egen leveranse).
