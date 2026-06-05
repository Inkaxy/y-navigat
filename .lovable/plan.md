# Korreksjonsmodus — t.o.m. valgt dato

I dag behandler korreksjonsmodus kun ordre på nøyaktig valgt dato. Endringen gjør modusen til et "korrigér før fakturering"-verktøy: alt av daterte ordre og returordre med leveringsdato ≤ valgt dato vises, og kan dekkes av én "Hovedkjøring".

## Endringer

**1. Tellinger (`useDeliveryNoteCounts`)**
- Ta `mode` som parameter.
- I `correction`: bytt `eq("delivery_date", date)` → `lte("delivery_date", date)` for både ordre-tellingene og aktive pakksedler. Bare daterte og retur teller; fastordre settes til 0 (skjules uansett i UI).

**2. Liste over pending ordre (`usePendingOrdersList`)**
- Ta `mode` som parameter.
- I `correction`: filtrer `delivery_date <= date`. Begrens til typene `datert` / `retur` (fastordre er ikke relevant her).
- Pakket-sjekk (`fetchPackedOrderIds`) må også bruke `lte`.
- Returner `delivery_date` per rad så listevisningen kan vise faktisk leveringsdato.

**3. Pakksedler-liste (`useDeliveryNotesList`)**
- Ta `mode` som parameter.
- I `correction`: `lte("delivery_date", date)`, og returner `delivery_date` per rad.

**4. Listeside (`DeliveryNotesList.tsx`)**
- Les `mode` fra URL og videresend til hookene.
- Når `mode === "correction"`: vis leveringsdato-kolonne per rad (i stedet for global header-dato), og oppdater overskrift til "t.o.m. {dato}".
- Sjekk at navigasjon fra widget-kortene tar med `mode=correction` (ligger allerede i URL — sørg for at det propageres).

**5. Dashboard (`DeliveryNoteDashboard.tsx`)**
- Send `mode` til `useDeliveryNoteCounts`.
- Sørg for at widget-kortene navigerer med `&mode=correction` slik at listen arver modus.
- Hovedkjøring-knappen i korreksjonsmodus:
  - Aktiv når `counts.datert + counts.retur > 0`.
  - Tekst: `Hovedkjøring (N ordre t.o.m. {dato})`.
  - Ved kjøring: hent unike `delivery_date` for pending datert/retur ≤ valgt dato, kall RPC `generate_delivery_notes` per dato sekvensielt med `run_type='main'`. Aggregér resultatet i én toast.
- Bekreftelsesdialog oppdateres til å si "t.o.m. {dato}" i korreksjonsmodus.
- Tilleggkjøring / Korreksjonskjøring / Angre / "Skriv ut alle" forblir per-dato (uendret) — vises som i dag.

**6. RPC**
- Ingen DB-endringer. Vi itererer per dato fra klienten siden `generate_delivery_notes` er per-dato.

## Tekniske detaljer

- `mode` defaulter til `"date"` i alle hooks → eksisterende kallsteder uendret.
- `queryKey` utvides med `mode` for å unngå cache-kollisjon.
- Sekvensiell RPC-kjøring (ikke parallell) for å unngå låsekonflikter på pakksedel-tellere.
- Hvis ingen pending dato finnes: vis info-toast og avbryt.
