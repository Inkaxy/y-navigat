## Mål

Fastordre (`recurring_order_schedules` + `recurring_order_items`) skal automatisk bli til ekte rader i `orders` + `order_lines` for valgt leveringsdato, slik at de plukkes opp av eksisterende `generate_delivery_notes`-flyt og kommer med på pakksedler, faktura, ordreliste osv.

## Designvalg

- **Materialisering skjer som første steg inne i `generate_delivery_notes`** (samme RPC-kall). Dermed trenger vi ikke endre frontend-flyten — knappen "Generer pakksedler" gjør alt i én transaksjon.
- **Idempotent**: hver `(customer_id, delivery_date, recurring_schedule_id)` materialiseres maks én gang. Re-kjøring lager ikke duplikater.
- **Bare for `run_type='main'`**: `additional`/`correction` materialiserer ikke fastordre på nytt (de plukker opp evt. nye manuelle ordre / lager korreksjon av eksisterende).
- **Respekter pause**: kunder med aktiv `delivery_pauses` for datoen hoppes over (samme regel som ordre-iterasjonen).
- **Respekter ukedag og gyldighet**: `recurring_order_items.weekday` må matche datoens ISO-ukedag, og `valid_from`/`valid_to` på schedule.
- **Tur-tilordning**: hvis `recurring_order_items.tour_id` er satt → bruk den. Hvis NULL → fall tilbake til kundens default-tur for ukedagen (samme regel som `useRecurringGhost`'s ekspansjon, men forenklet til én tur per linje for å unngå dobling). Trenger avklaring — se "Åpne spørsmål".
- **Pris**: hentes via samme prisfunksjon som "Ny ordre" bruker (kundespesifikk → prisliste → standard). Vi gjenbruker eksisterende SQL-funksjon hvis den finnes; ellers ny intern helper.
- **Kilde-sporing**: nye ordre får `source = 'recurring'` og `source_reference = recurring_schedule_id::text` så de er filtrerbare i ordrelista.

## Endringer

### 1. Database (migration)

- **Ny kolonne** på `orders`:
  - `recurring_schedule_id uuid NULL REFERENCES recurring_order_schedules(id) ON DELETE SET NULL`
  - Unik partial index: `UNIQUE (legal_entity_id, customer_id, delivery_date, recurring_schedule_id) WHERE recurring_schedule_id IS NOT NULL` — sikrer idempotens.

- **Ny SQL-funksjon** `materialize_recurring_orders(p_legal_entity_id uuid, p_delivery_date date, p_tour_filter uuid[]) RETURNS int` (antall nye ordre):
  - Loop: alle aktive schedules der `valid_from`/`valid_to` dekker datoen og kunde ikke er på pause.
  - For hver `recurring_order_items` der `weekday = isodow(p_delivery_date)`:
    - Bestem tur (item.tour_id eller fallback til kundens default-tur for ukedagen).
    - Hvis `p_tour_filter` er satt og turen ikke er med, hopp over.
    - Hopp over hvis ordre med samme `(legal_entity, customer, dato, schedule_id)` finnes.
    - Insert i `orders` (`status='confirmed'`, `source='recurring'`, snapshot kunde + adresse).
    - Insert linjer i `order_lines` med pris og snapshot fra produkt.
    - Beregn totaler.

- **Endre `generate_delivery_notes`**: helt øverst, hvis `p_run_type = 'main'`, kall `materialize_recurring_orders(...)` og inkluder antallet i `details`-jsonb.

### 2. Frontend

- **`useGenerateDeliveryNotes`**: legg til `recurring_orders_created?: number` i resultat-typen og vis i toast ("X fastordre opprettet, Y pakksedler generert").
- **OrdersList**: legg til filter/badge for `source = 'recurring'` så brukeren ser hvilke ordre som kom fra fastordre.

## Åpne spørsmål

1. **Tur-fallback når `recurring_order_items.tour_id` er NULL**: hva er kundens "default-tur for ukedag"? Skal vi
   - (a) bruke den ene aktive turen for ukedagen hvis det kun finnes én, ellers feile/varsle, eller
   - (b) lese et nytt felt på kunde (`default_tour_id`), eller
   - (c) tvinge brukeren til alltid å sette `tour_id` på items (validering i fastordre-dialog)?
2. **Pris-kilde**: Finnes det allerede en SQL-funksjon for prisoppslag, eller skal vi gjenskape logikken? (Sjekkes ved implementering.)
3. **Ordre-status ved opprettelse**: `confirmed` (klar for produksjon) eller `awaiting_confirmation` (krever manuell godkjenning)? Anbefaling: `confirmed` siden fastordre per definisjon er forhåndsgodkjent.

Si fra om svarene på (1) og (3), så kjører jeg migrasjonen.
