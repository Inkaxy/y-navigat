
## Mål

Pakksedler-modulen skal følge denne modellen:

- **Fastordre-feltet** (gul boks) teller alle fastordre for valgt dato — både materialiserte (i `orders`) og ikke-materialiserte (aktive `recurring_order_schedules`) som ikke er pauset.
- **Daterte ordre-feltet** teller daterte/kundeordre uten pakkseddel for valgt dato.
- **Returordre-feltet** teller returordre uten pakkseddel.
- **Pakksedler-feltet** (blå) teller og viser kun faktiske pakksedler for valgt dato.
- En fastordre som redigeres flyttes automatisk til «daterte ordre» (`is_customer_order = true`).
- Legges en ny ordre inn etter at hovedkjøring er kjørt → tilleggkjøring/ny pakkseddel.

## Endringer

### 1. Pakksedler-listen (`DeliveryNotesList.tsx`) leser `type`-param

I dag ignoreres `type=fast|datert|retur` fra URL — alle widgets havner i samme visning, og fastordre-virtualrader vises overalt. Endre slik at listen får fire moduser:

```text
type=fast    → "Fastordre for {dato}" — viser pending recurring + materialiserte fastordre
               uten pakkseddel. Knapp: "Generer pakksedler" (kjører hoved-/tilleggkjøring).
type=datert  → "Daterte ordre for {dato}" — viser orders.is_customer_order=true uten pakkseddel.
type=retur   → "Returordre for {dato}" — viser orders.is_return=true uten pakkseddel.
(default)    → "Pakksedler for {dato}" — viser kun rader fra delivery_notes. Ingen virtualrader.
```

Fjern «Fastordre — ikke generert»-badgen og «Generer X fastordre»-knappen fra default-visningen — de hører hjemme kun i `type=fast`.

### 2. Ny hook for daterte/retur-køer

Lag `useUnpackedOrders(date, tourId, kind)` som returnerer ordre-rader (`orders` joinet med `customers`/`delivery_tours`) som ennå ikke er dekket av en aktiv pakkseddel for valgt dato. Brukes av `type=datert` og `type=retur`. Logikken finnes allerede delvis i `useDeliveryNoteCounts` (sett av `packedOrderIds`).

### 3. Fastordre-listen viser begge typer i én tabell

Slå sammen:
- Pending recurring (fra `usePendingRecurringOrderRows`) — vises som «Mal»-rad uten ordre-nr.
- Materialiserte fastordre (orders med `is_customer_order=false`, `is_return=false`, ikke-pakket) — vises med ordre-nr.

Felles knapp «Generer pakksedler ({n})» kjører hovedkjøring for valgt tur/dato (samme RPC som i dag).

### 4. Redigering av fastordre → datert

Når en bruker åpner en materialisert fastordre og endrer linjer/antall, sett `orders.is_customer_order = true` i samme mutation. Dette gjør at ordren forsvinner fra fastordre-feltet og dukker opp under «Daterte ordre». (Krever liten endring i ordre-edit-flow — identifiser stedet og legg til feltet ved første endring.)

### 5. Tilleggkjøring etter ny ordre

I dag finnes «Tilleggkjøring» som dropdown-handling. Bekreft at den fanger nye ordre lagt inn etter hovedkjøring (sjekk RPC `generate_delivery_notes` i runType=`additional`). Vis en liten «N nye ordre siden hovedkjøring — kjør tilleggkjøring»-banner i dashboardet når antallet > 0.

## Tekniske detaljer

- Filer som endres: `src/ordre/pages/DeliveryNotesList.tsx`, ny `src/ordre/hooks/useUnpackedOrders.ts`, små justeringer i `usePendingRecurringOrders.ts` (eksporter «materialized fastordre»-rader også, eller slå sammen i listen).
- Ingen DB-migrasjon nødvendig.
- `type`-param leses via `useSearchParams`. Tittel og knapper byttes basert på modus.
- Dashboard-tellerne (`useDeliveryNoteCounts`) er allerede korrekte — ingen endring der.

## Det vi IKKE gjør

- Ingen automatisk materialisering av fastordre ved sidelast (du var tydelig på at det krever manuell kjøring).
- Ingen endring på pause-håndtering (utelates fortsatt helt).
- Ingen endring på pakksedler-feltet/listen ut over å fjerne virtualradene.
