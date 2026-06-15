## Mål
Gjøre kakebyggeren komplett ved å innramme den med to nye steg, og deretter koble resultatet til en faktisk henteordre som POS kan plukke opp på hentedagen.

## Steg 1 — Førsteside i kakebyggeren (før vanlige steg)

Nytt obligatorisk start-steg i `src/varer/features/cakeBuilder/CakeBuilder.tsx` (rendret før `steps[0]`, samme `StepHeader`/`StepNav`-rytme). Felter:

- **Hentedato** — datepicker, min = i dag + X (X = `category.lead_time_days` hvis satt, ellers 1). Påkrevd.
- **Hentested** — select over `pickup_locations` for gjeldende `legal_entity_id`. Default = utsalget terminalen er koblet til (kommer inn via ny prop `defaultPickupLocationId`). Kunden kan endre. Påkrevd.
- **Navn** — tekst, påkrevd.
- **Telefon** — tekst (norsk format-validering, ikke streng). Påkrevd.
- **E-post** — tekst, valgfri.

State lagres i en ny `customerInputs`-struct sidestilt med `singleSelections`/`multiSelections`. Inngår i `CakeResult` som `customer_meta = { pickup_date, pickup_location_id, name, phone, email }` (utvider `types.ts`).

`StepHeader` får totalsteg = `steps.length + 2` (start + slutt). Navigasjon: start → eksisterende steg → oppsummering → ny betalings-side → bekreftelse.

## Steg 2 — Sisteside «Betaling»

Etter `summary` (før dagens `confirmedResult`-skjerm) legges et nytt valg-steg med to store kort:

- **Betal nå** — fortsetter dagens flyt, men `payment_mode = "now"`.
- **Betal ved henting** — `payment_mode = "later"`.

Valget lagres på `CakeResult.payment_mode`. `handleConfirmStep` kalles først når brukeren har valgt.

## Steg 3 — POS mottar resultat og oppretter henteordre

`KakebyggerModal` byttes fra ren visning til å lytte på `cake-builder/done`-meldingen fra iframen (via `protocol.ts`/`window.message`). I `src/kiosk/pages/Kasse.tsx`:

1. **Match/opprett kunde** — ny RPC `pos_upsert_customer_order_customer(legal_entity_id, name, phone, email)`: slår opp `customers` på (legal_entity_id, phone), oppretter ellers en minimal "POS-bestilling"-kunde (samme felter brukes som `customer_snapshot`).
2. **Opprett ordre** — ny RPC `pos_create_cake_order(payload)` som:
   - Lager `orders`-rad: `distribution='pickup'`, `delivery_date=pickup_date`, `pickup_location_id`, `final_customer_*` fra inputs, `is_customer_order=true`, `source='pos_kakebygger'`, `status='confirmed'`, `is_paid` settes etter betalingsmodus.
   - Lager `order_lines` for kake-hovedlinje + tilbehør-linjer fra `cake_result`.
   - Lager label-jobb i `label_print_jobs` (samme rutine som dagens kakebygger-bekreftelse — ingen ny utskriftslogikk, går i ordinær kø).
   - Returnerer `order_id` + linjer.
3. **Betal nå** — etter ordre er opprettet, pushes linjene inn i dagens POS-kurv (`cart.add(...)`) med `linked_order_id`-meta. Kassereren tar betalt som vanlig. Ved POS-finalisering markeres ordren `is_paid=true`, og hver linje senere (på hentedagen) får pris 0 (se neste steg).
4. **Betal ved henting** — modal lukkes, toast «Henteordre #N opprettet», ingenting puttes i kurven nå.

## Steg 4 — «Henteordre»-knapp i POS

Eksisterende `function_code`-system har allerede `kakebygger`. Legg til ny funksjon `henteordre` (i `src/pos_styring/keypad/functions.ts` + `KeypadGrid.tsx`/`Kasse.tsx`-switch) som åpner ny komponent `HenteordreModal`:

- Henter `orders` med `delivery_date <= i dag`, `pickup_location_id = terminalens utsalg`, `status in ('confirmed','in_production','ready')`, `picked_up_at is null`.
- Liste: ordrenummer, kundenavn, telefon, dato, betalt/ubetalt-badge.
- Klikk på rad → laster ordrens `order_lines` inn i POS-kurv:
  - Hvis `is_paid=true`: alle linjer settes til pris **0 kr** (kunden kan legge til ekstra varer), og ordren markeres med `picked_up_at=now()` når salget fullføres.
  - Hvis `is_paid=false`: linjene legges inn til full pris. Kunden kan legge til/justere, og betaling skjer normalt. Ordren får `is_paid=true` + `picked_up_at=now()` ved fullføring.

Kurv-modellen utvides med valgfri `pickup_order_id` slik at finalisering kan oppdatere riktig `orders`-rad. RPC `pos_finalize_sale` (eller wrapper) tar imot dette og oppdaterer ordrestatus.

## Tekniske detaljer (utviklerseksjon)

**Frontend-filer som endres:**
- `src/varer/features/cakeBuilder/CakeBuilder.tsx` — nye start/slutt-steg, customer/payment-state, utvidet validering, `StepNav`-flyt.
- `src/varer/features/cakeBuilder/types.ts` — `CakeResult` får `customer_meta`, `payment_mode: 'now' | 'later'`.
- `src/varer/features/cakeBuilder/components/` — to nye små steg-komponenter (`CustomerStartStep.tsx`, `PaymentChoiceStep.tsx`).
- `src/varer/pages/embed/CakeBuilderEmbed.tsx` — ta imot `default_pickup_location_id` query-param, sende videre.
- `src/kiosk/components/KakebyggerModal.tsx` — lytt på `postMessage 'cake-builder/done'`, send terminalens pickup_location som default i embed-URL.
- `src/kiosk/pages/Kasse.tsx` — wire `KakebyggerModal`-resultat til ny `handleCakeResult(result)` som kaller RPC og evt. pusher i kurv. Ny `HenteordreModal` integreres på keypad-funksjon `henteordre`.
- `src/kiosk/components/HenteordreModal.tsx` — ny.
- `src/pos_styring/keypad/functions.ts` — legg `henteordre` i funksjonskatalogen.

**Backend (én migrasjon):**
- RPC `pos_create_cake_order(p_payload jsonb)` — security definer, validerer terminal/operator, oppretter customer (om nødvendig), order, order_lines, label-jobb.
- RPC `pos_list_pickup_orders(p_pickup_location_id uuid, p_date date)` — returnerer åpne henteordrer for utsalg/dato.
- RPC `pos_load_pickup_order(p_order_id uuid)` — returnerer linjer m/ riktig prising (0 kr hvis `is_paid`).
- RPC `pos_complete_pickup_order(p_order_id uuid, p_pos_transaction_id uuid)` — setter `picked_up_at`, `is_paid=true` ved behov, status.
- GRANTs til `authenticated`/`service_role` per konvensjon.
- Ingen schema-endringer på `orders` nødvendig — alle nødvendige kolonner finnes (`distribution`, `delivery_date`, `pickup_location_id` via `customer_snapshot` evt. ny kolonne hvis denne ikke finnes på orders — sjekkes i implementasjon, evt. legges til som `pickup_location_id uuid references pickup_locations` i samme migrasjon).

**Ikke i scope nå:**
- Endringer i eksisterende cake-RPC (`build_cake_order_line`) — den brukes som før til å bygge linje-payload.
- Faktisk e-post/SMS-bekreftelse til kunde (kan kobles på senere via `email_outbox`).
- Reprint av etikett fra henteordre-listen (kan legges til etter behov).
