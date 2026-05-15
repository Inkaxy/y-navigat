## Mål

Pakksedler skal samles per kunde, dekke alle ordre (inkl. fastordre), oppdateres automatisk hvis nye ordre kommer etter hovedkjøring, og kun skrives ut for valgt dato.

## Dagens situasjon (kort)

- `generate_delivery_notes` lager **én pakkseddel per ordre** (én `delivery_notes`-rad per `orders`-rad).
- Fastordre materialiseres til ordre i starten av "main"-kjøring (allerede på plass).
- "Tilleggkjøring" finnes som manuell handling — ikke automatisk.
- Bulk-utskrift er allerede dato-bundet (`scope.date`).

## Endringer

### 1. Én pakkseddel per kunde (per dato + tur)

Endre `generate_delivery_notes`:

- Loop **per (customer_id, delivery_tour_id)** i stedet for per ordre.
- For hver kunde: opprett **én** `delivery_notes`-rad, og legg alle linjer fra alle ordre for kunden inn som `delivery_note_lines` med `order_id` på linje-nivå (slik at sporbarhet til opprinnelig ordre beholdes).
- `customer_snapshot` / `delivery_address_snapshot` hentes én gang per kunde.
- Sum (`subtotal_excl_vat`, `total_vat`, `total_incl_vat`) summeres på tvers av alle ordrene.
- Ordre med ulik `delivery_tour_id` for samme kunde havner på separate pakksedler (én per tur).

Skip-regel for ordre som allerede er pakket beholdes (ordre med eksisterende ikke-cancelled `delivery_note_line` hoppes over) — dette gjør at "additional"-run kun plukker nye/uplukkede ordre, og slår de sammen med ev. ny pakkseddel for kunden.

### 2. Automatisk pakkseddel ved nye ordre etter hovedkjøring

Ny DB-trigger `trg_orders_auto_pakkseddel` på `orders` (AFTER INSERT OR UPDATE OF status, delivery_date, delivery_tour_id):

- Sjekker om det allerede finnes en fullført "main"-kjøring i `delivery_note_runs` for `(legal_entity_id, delivery_date)`.
- Hvis ja, og ordren ikke allerede har en aktiv pakkseddel-linje, kjører den `generate_delivery_notes(..., p_run_type='additional')` for den datoen og turen.
- Tilleggkjøringen vil da plukke opp den nye ordren og:
  - opprette ny pakkseddel for kunden hvis kunden ikke har én fra før, eller
  - (alternativ B nedenfor) slå den sammen med eksisterende pakkseddel.

**Sammenslåing eller ny pakkseddel?** To alternativer:
- **A (foreslått): Ny separat pakkseddel** for tilleggsordren. Eksisterende pakksedler er allerede skrevet ut/sendt — å endre dem etter print er forvirrende. Brukeren ser klart "tilleggspakkseddel".
- **B: Append til eksisterende pakkseddel** for kunden. Krever at vi aldri printer før alle ordre er inne — bryter "skriv ut og glem"-flyten.

### 3. Utskrift kun for valgt dato

Allerede oppfylt: `useBulkPakksedlerPDF` og `BulkPakkseddelPDFButton` bruker `scope.date` = valgt dato. Per-rad-utskrift i `DeliveryNotesList` bruker også valgt dato. Ingen endring nødvendig — kun verifisering.

## Tekniske detaljer

- **Migrasjon 1**: Erstatt `generate_delivery_notes` med per-kunde-versjon. Beholder samme signatur og returverdi (`jsonb` med `notes_generated`, `lines_generated`, `orders_processed`, …).
- **Migrasjon 2**: Trigger-funksjon `auto_additional_run_for_new_order()` + trigger på `orders`. Trigger må kjøres som `SECURITY DEFINER` med `auth.uid()` → bruker `created_by` på ordren som triggered_by hvis `auth.uid()` mangler.
- Idempotens: skip-regelen i `generate_delivery_notes` (ordre allerede på aktiv pakkseddel) sikrer at trigger ikke dobbeltgenererer.
- `useDeliveryNoteCounts` og dashbordet trenger ingen endringer — tellerne fungerer fortsatt (PAKKSEDLER teller `delivery_notes`, FASTORDRE/DATERTE/RETUR teller ordre uten pakkseddel-linje).

## Åpne spørsmål

1. **Sammenslåing vs ny pakkseddel** for sen-ankomne ordre — A eller B over?
2. **Skal triggeren kjøre umiddelbart** (synkront i samme transaksjon, kan gjøre order-insert tregere) **eller asynkront** (via `pg_notify` + edge function / scheduled job)? Synkron er enklest og raskest å implementere.
3. **Hva med ordre som *endrer* `delivery_date`** etter hovedkjøring — skal gammel pakkseddel-linje annulleres og ny genereres? Sannsynligvis ja, men bekreft.
