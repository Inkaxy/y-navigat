# Snapshot- og korreksjons-utskrift

Legge til muligheten for å skrive ut N kopier av produksjonsplanen, hvor den **siste** kopien blir en korreksjonsliste som viser +/- mot siste snapshot fra samme dato.

---

## Brukerflyt

1. På **Sett kriteria for produksjonsplan**-dialogen kommer det et nytt felt: **«Skriv ut med korreksjon»** med to inputs:
   - **Antall kopier** (number, default 1)
   - **Korreksjonsliste på siste kopi** (toggle, default av)
2. Disse lagres som del av kriteria-objektet (slik at maler husker det).
3. Når brukeren klikker **Skriv ut**:
   - Hent forrige snapshot for *(samme dato + samme legal_entity)*. Korreksjon kjøres **kun dag mot dag** — finnes ikke snapshot fra inneværende dag, hoppes diff over (siste kopi blir vanlig).
   - Generer N "sider" i `print-area`. Hver side blir en separat A4 (vha. `break-after: page`).
   - Side 1 til N-1 = identisk med dagens plan.
   - Side N = korreksjonsliste (samme rader, men med ekstra kolonne **Endring** og en ekstra rad pr. produkt for **plater +/-**).
   - Etter at print-dialogen er trigget, lagres et nytt snapshot av dagens plan i databasen.
4. Snapshots auto-slettes etter **2 dager** (cron / scheduled function eller cleanup ved skriving).

---

## Korreksjonsliste-layout

Identisk med vanlig produksjonsliste, pluss:

- Ny kolonne **Endring** ytterst til høyre med `+5` / `-2` / blank.
- Ny rad rett under hvert produkt med endring i platenanntall: viser `Plater: +0,5` eller `Plater: -1` (kun hvis ulikt).
- Header endres til: `KORREKSJONSLISTE FOR: {ukedag dd.MM.åå} – endring siden {hh:mm}`.
- Uendrede rader vises også (ifølge ditt valg).

---

## Database (ny tabell)

```text
production_plan_snapshots
  id              uuid pk
  legal_entity_id uuid
  plan_date       date
  taken_at        timestamptz default now()
  taken_by        uuid (auth.uid)
  criteria        jsonb            -- kriteriene som ble brukt
  rows            jsonb            -- snapshot av rader (product_id, qty_to_produce, trays_full, trays_partial)
  expires_at      timestamptz default now() + interval '2 days'
```

- RLS: bruker som tilhører `legal_entity_id` kan lese/skrive (samme mønster som andre produksjonsplan-tabeller).
- Index på `(legal_entity_id, plan_date, taken_at desc)` for å hente nyeste raskt.
- Cleanup: enten en scheduled edge function som sletter `expires_at < now()`, eller en `DELETE` som kjøres ved hver `INSERT` (enkleste løsning, ingen cron).

---

## Kode-endringer

**`src/produksjon/features/produksjonsplan/types.ts`**
- Legg til på `ProduksjonsplanCriteria`:
  ```ts
  print_copies?: number;          // default 1
  print_correction_last?: boolean; // default false
  ```
- Oppdater `DEFAULT_CRITERIA`.

**`src/produksjon/features/produksjonsplan/components/SettKriteriaDialog.tsx`**
- Ny seksjon «Utskrift» med number-input + checkbox.

**Ny hook `useProductionPlanSnapshots.ts`**
- `getLatestForToday(legalEntityId, date)` → siste snapshot for dagen.
- `saveSnapshot(legalEntityId, date, criteria, rows)` → insert + slett utgåtte.

**Ny komponent `CorrectionPlanTable.tsx`**
- Tar `rows` + `previousRowsByProductId` + `columns` props.
- Samme markup som `ProductionPlanTable` men med ekstra **Endring**-kolonne og diff-rad for plater.

**`src/produksjon/pages/ProduksjonsplanPage.tsx`**
- Erstatt `window.print()`-knappen med ny `handlePrint()`-funksjon som:
  1. Henter siste snapshot.
  2. Bygger en `printJob`-state: `{ copies: N, includeCorrection: bool, prevRows: Map | null }`.
  3. Trigger render av `<PrintLayout copies={N} ... />` i `print-area`.
  4. Kaller `window.print()` (etter et kort `setTimeout` så DOM rekker å oppdatere).
  5. Lagrer nytt snapshot.
- Ny komponent `<PrintLayout>` rendrer N seksjoner, hver med `style={{ breakAfter: 'page' }}`, der siste evt. er `<CorrectionPlanTable>`.

**`src/index.css`**
- Legg til `.print-page { break-after: page; }` og `.print-page:last-child { break-after: auto; }`.

---

## Edge cases

- Første utskrift på en ny dag: ingen snapshot finnes → siste kopi blir vanlig liste (med liten merknad i header: «Ingen tidligere snapshot å sammenligne mot»).
- Korreksjon krysser ikke datoer (bevisst valg).
- Snapshot inkluderer kun det minimum av data som trengs for diff (product_id, qty, trays).
- Hvis et produkt finnes i ny liste men ikke gammel → `+full mengde`. Motsatt → vises som egen rad med `-full mengde` og strikethrough på navn.
