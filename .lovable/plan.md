# Klikkbar tur/dag-kolonne → åpne ordren

## Hva du får

I ordrematrisen (`/ordre/leveringskalender`) gjør vi hver tur-kolonne under en dato klikkbar. Klikk på f.eks. «T1» under «Ti. 21.07» åpner en dialog som viser **den ene ordren** for valgt kunde × dato × tur — akkurat som skjermbildene: kunde-header, dag/tur-tittel, linjer med redigerbart antall og pris, kommentar/rabatt/merknad/slett-ikoner, «Ny ordrelinje», sum, og Ferdig/Lagre.

## Interaksjon

- **Klikk på tur-cellen** (der «T1» / «T3» står): åpner `TourOrderDialog`.
- Fjerne dagens ikonrad? Nei — vi beholder Copy/Comment/Delete/Packing-ikonene, men gjør resten av cellen (tallet og bakgrunnen) til en knapp som åpner dialogen. Ikonene stopper klikk-propagasjon.
- Header i dialogen: `Ordre for {kunde} ({kundenr})` + `{Ukedag} {DD.MM.YYYY} — tur {N}` + kjørerute-linje + weather-chip.
- Chip «Erstatter fastordre» vises hvis raden er en aktiv fast-rute (ghost-erstatning finnes allerede i matrisen).

## Redigering

- **Antall**: samme som i matrisen (numerisk input).
- **Pris**: klikk på à-prisen → inline input (tooltip «varepris er X,XX» som i skjermbilde-256). Setter `order_lines.unit_price` og `unit_price_source='manual'`.
- **Kommentar-ikon**: åpner eksisterende `MerknadDialog`.
- **Rabatt-ikon**: liten popover med `discount_percent`.
- **Kopi-ikon**: kopier linje til neste dag (eksisterende `handleCopyNextDay`).
- **Slett-ikon**: setter quantity=0.
- **Ny ordrelinje**: søk i produkter (samme som `AddProductDialog`), legger til linje.
- **Ferdig**: lukker uten lagring; **Lagre**: kjører samme `useSaveMatrix` for dette (date,tour), pluss egne `updateOrderLine`-kall for pris/rabatt-endringer.

## Låsing når fakturert

Ordren låses (read-only) når `orders.status = 'invoiced'` eller `is_paid = true`. Dialogen viser da et grått banner «Ordren er fakturert — kan ikke endres» og skjuler Lagre-knapp.

## Teknisk

- Ny komponent `src/ordre/components/orders/matrix/TourOrderDialog.tsx`.
- Ny hook `useTourOrder(customerId, date, tourId)` som henter `orders` + `order_lines` (join på customer_id/delivery_date/delivery_tour_id, ta nyeste). Realtime på begge tabellene.
- Ny hook `useUpdateOrderLine` for pris/rabatt-oppdateringer (audit_log-innslag som eksisterende endringer).
- Header-endring i `Leveringskalender.tsx` (linje ~1823-1859): wrap tur-cellen i en knapp, ikoner stopper propagasjon.
- Ingen DB-migrasjoner nødvendig — bruker eksisterende felter (`unit_price`, `discount_percent`, `notes`, `merknad`).
- Sum-visning bruker `subtotal_excl_vat` / `total_incl_vat` fra orders-raden.

## Ute av scope (spør før jeg bygger dette)

- Endre selve matrisens layout eller dagens ikon-rad.
- Slett-hele-ordren, kopier-hele-ordren og pakkseddel-knapper nederst (image-252) — dette finnes allerede via kolonne-ikonene og kan gjenbrukes hvis du vil.
- «vis gruppeteller» og «Legg til varer kunden ofte bestiller» fra skjermbilde-252 — kan legges til etterpå.

Vil du at jeg bygger dette som beskrevet, eller vil du justere scope først (f.eks. droppe prisredigering, eller også inkludere Slett/Kopier ordre-knappene nederst)?
