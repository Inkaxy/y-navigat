## Mål

Gjøre det mulig å opprette/redigere en **fastordre** (løpende ukentlig ordre) direkte fra Leveringskalender-matrisen, uten å forlate siden. Fastordren ligger som en mal på kunden — kunden kan selv endre den senere, og bakeriet får oversikt for forberedelse.

## Endringer

### 1. Ny menyvalg i Handling-dropdown (Leveringskalender)
I `src/ordre/pages/Leveringskalender.tsx`, i seksjonen "Opprette nytt" (rett under "Lag ny returordre"):

- Nytt valg: **"Fastordre (ukentlig mal)"** med ikon `Repeat` (lucide).
- Disablet hvis ingen kunde valgt.
- Åpner et modal-vindu (eksisterende `RecurringScheduleDialog`) med kunden forhåndsvalgt og låst.

### 2. Tilpass `RecurringScheduleDialog` for matrise-bruk
I `src/ordre/components/orders/RecurringScheduleDialog.tsx`:

- Nytt valgfritt prop `lockedCustomer?: { id: string; label: string }`.
  - Når satt og det er en ny mal: skjul kunde-velgeren og vis kundenavn som read-only header.
  - Eksisterende redigeringsflyt (klikker på en eksisterende mal) er uberørt.
- Eksisterende ukematrise (Man–Søn × produkter med tur-velger) brukes som er.

### 3. Vis eksisterende fastordre for valgt kunde
For at brukeren skal se om kunden allerede har en mal:

- Nytt enkelt hook-call i Leveringskalender: hent `recurring_order_schedules` for valgt `customer_id` (filtrert på `is_active = true`).
- Hvis det finnes en aktiv mal: menyvalget endres til **"Rediger fastordre"** og åpner dialogen i edit-modus med den eksisterende malen.
- Hvis ingen: **"Opprett fastordre"** åpner ny mal med kunden låst.

### 4. Liten badge ved siden av kundevelger
Når valgt kunde har en aktiv fastordre: vis liten `Badge` "Fastordre aktiv" ved siden av kunde-Popover-knappen. Klikk åpner samme dialog. Ren visuell snarvei — ingen logikk-endringer.

## Tekniske detaljer

- Tabeller `recurring_order_schedules` og `recurring_order_items` finnes allerede; ingen migrasjon nødvendig.
- `useSaveRecurringSchedule` brukes som er — den håndterer både insert og update.
- Mal er ikke koblet til kalenderukens viste data; den er en separat ukentlig mal som lever uavhengig av faktiske ordrelinjer i matrisen.
- Etter lagring: invaliderer `recurring-schedules`-query slik at "Fastordre aktiv"-badgen oppdateres umiddelbart.

## Filer som berøres

- `src/ordre/pages/Leveringskalender.tsx` — meny-item, dialog-state, badge, kall til `useRecurringSchedules({ customer_id })`.
- `src/ordre/components/orders/RecurringScheduleDialog.tsx` — `lockedCustomer`-prop og betinget rendering av kundevelger.
- `src/ordre/hooks/useRecurringOrders.ts` — utvid `RecurringScheduleFilter` med `customer_id?: string` (liten tilføyelse).

Ingen DB-endringer, ingen edge functions.