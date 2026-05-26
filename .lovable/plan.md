## Mål for runde 1

Gjøre ticketen til et reelt arbeidsverktøy: når en ansatt åpner en ticket skal AI allerede ha tolket eposten, foreslått ordrefelt, flagget mangler/risiko og lagt klar én knapp som åpner en ordre-opprettelse forhåndsutfylt med AI-data. Ordre og ticket kobles begge veier. Listen får små badges som viser type/mangler/koblet.

Senere runder (ikke nå): separate AI-knapper for avklaringsmail/bekreftelse/svarforslag, ny full ticket-liste med filtre, bekreftelse-generering med mal, "foreslå eksisterende ordre"-kobling, statushistorikk-tidslinje, produksjons/butikk-notat-generering.

---

## 1. Utvidet AI-analyse (én samlet analyse)

Utvider `analyze-email-with-ai`-edge-funksjonen og `tickets.ai_suggestion`-jsonb til å inneholde alt vi trenger for runde 1. Ingen ny tabell — alt ligger i én strukturert jsonb.

Nytt schema for `ai_suggestion`:

- `request_type` — én av: `new_order`, `change`, `cancellation`, `question`, `complaint`, `internal`, `unclear`, `spam`
- `summary` — kort norsk sammendrag (1–3 setninger)
- `suggested_action` — kort tekst: "Opprett ny ordre", "Koble til eksisterende ordre #…", "Send avklaring", "Lukk som spam"
- `customer_match` — som i dag (id, navn, confidence)
- `order_fields` — strukturert utkast til ordre:
  - `delivery_date`, `delivery_time`
  - `pickup_location_hint` (fritekst kunden skrev, f.eks. "Majorstua")
  - `delivery_address_*` (hvis nevnt)
  - `customer_notes`, `internal_notes`, `production_notes`
  - `cake_text`, `allergies`, `special_requests`
  - `contact_phone`, `contact_email`
- `products[]` — som i dag + `size_or_servings`, `flavor`, `filling`, `decoration`
- `missing_info[]` — liste over felt som mangler (norsk label + maskinkode), f.eks. `[{ code: "phone", label: "Telefonnummer" }]`
- `risks[]` — `[{ severity: "red"|"yellow"|"green", code, message }]` (åpningstid, frist, allergi, uklar dato, kanskje-duplikat, osv.)
- `field_confidence` — map med confidence per nøkkelfelt (`delivery_date`, `customer_id`, `pickup`, hver produktlinje)
- `reasoning_per_field` — kort begrunnelse per nøkkelfelt ("kunden skrev 'Majorstua'")
- `confidence_score` — total
- `reasoning` — overordnet

Endringer i edge-funksjonen:
- Oppdater Zod-schema + systemprompt med nye felt og typer henvendelser.
- Sender med ekstra kontekst: hentesteder/lokasjoner (fra eksisterende `pickup_locations` hvis tilgjengelig) og produksjonsfristregler hvis enkelt tilgjengelig.
- Beholder lagring i `tickets.ai_suggestion`. Ingen schema-endring på tabellen (jsonb).

---

## 2. Forbedret ticket-detaljside (split-view)

Erstatter dagens vertikale stack i `src/ordre/pages/TicketDetail.tsx` med to-kolonne layout (responsiv: stacker under `lg`):

**Venstre kolonne — kundekommunikasjon**
- Original epost (renset HTML) — som i dag
- Vedlegg — som i dag
- Tidligere sendte svar — som i dag
- Svar-felt — som i dag (uten endring i denne runden)
- Internt notat — som i dag

**Høyre kolonne — AI-arbeidspanel** (sticky på desktop)
- Header med type-badge (farge per `request_type`) + confidence
- AI-sammendrag
- Foreslått handling (én tydelig CTA, se §3)
- Manglende info (rød/gul liste)
- Risiko (badge-liste m/ severity-farger via design-tokens)
- Foreslåtte ordrefelt (kompakt visning, viser feltnavn → AI-forslag + confidence-prikk)
- Foreslåtte produktlinjer
- Begrunnelse (collapsible)
- "Analyser på nytt" — bevares

Handlingsrad over kolonnene beholdes (status, prioritet, tildelt). "Opprett ordre fra ticket" flyttes inn i AI-panelets CTA.

Bruker eksisterende design-tokens (`--brand-ink`, `--brand-bronze`, `--popover` osv.) — ingen nye farger.

---

## 3. "Opprett ordre fra ticket"-flyt

Beholder dagens mekanisme: knappen navigerer til `/ordre/ordrer/ny?ticket_id=…`. Den siden eksisterer og kobler allerede ticketen til ordren etter lagring (`tickets.related_order_id`, `status = in_progress`). Vi utvider:

**NewOrder.tsx — lese AI-forslag**
- Når `ticket_id` finnes, last `ai_suggestion` fra ticketen.
- Forhåndsutfyll (kun hvis bruker ikke har endret feltet):
  - `customer` → hvis `customer_match.customer_id` finnes
  - `deliveryDate`, `deliveryTime`
  - `customerNotes`, `internalNotes` (inkluder kaketekst/allergier/spesialønsker som tekst hvis ingen dedikerte felt finnes)
  - Leveringsadresse hvis AI har foreslått
  - Produktlinjer fra `products[]` (kun de med `product_id`; resten legges som forslagstekst i intern note slik at ansatt kan velge manuelt)
- Vis en "AI-forhåndsutfylt"-banner øverst med liste over felt AI fylte ut, og en "Tøm AI-forslag"-knapp.
- Vis mangler/risiko-pillene fra `ai_suggestion` som ikke-blokkerende advarsler.

**Toveis kobling — bekreftelse av nåværende oppførsel**
- Ved lagring av ordren: oppdaterer `tickets` med `related_order_id`, `status = 'in_progress'` (allerede implementert linje 682 i NewOrder.tsx) — utvider til også å sette `status = 'resolved'` hvis bruker huker av "marker ticket som ferdig" i lagre-dialog.
- Ordren får `source = 'ticket'`, `source_reference = ticket.id` (kolonnene finnes allerede).

**OrderDetail — link tilbake til ticket**
- Hvis `orders.source = 'ticket'` og `source_reference` er en gyldig ticket-uuid, vis en liten "Fra ticket: <emne>"-lenke i toppen av OrderDetail.

---

## 4. Ticket-liste — minimum-badges

Liten endring i `TicketsList.tsx` (og evt. `useTickets`):
- Vis fargekodet badge for `ai_suggestion.request_type` (med norsk label).
- Vis "Mangler info"-badge når `ai_suggestion.missing_info.length > 0`.
- Vis "Koblet til ordre"-badge når `related_order_id` finnes (lenke til ordren).
- Vis "AI-forslag klart" når `ai_status = 'success'` og ingen ordre er koblet ennå.
- Vis rød "Risiko"-badge når noen `risks[].severity = 'red'`.
- Ingen endring i kolonner, filtre eller statuser i denne runden.

---

## 5. Sporbarhet — minimal logging

Ingen ny tidslinje-UI i denne runden, men vi logger viktige hendelser i eksisterende `ai_call_log` der det passer (allerede dekker AI-analyse). Ny `audit`-entry for "ordre opprettet fra ticket" bruker eksisterende `audit`-mønster i `src/ordre/lib/audit.ts` — kall i success-handleren i NewOrder når `ticket_id` er satt.

---

## Filer som endres

- `supabase/functions/analyze-email-with-ai/index.ts` — utvidet schema + prompt + ekstra kontekst
- `src/ordre/components/orders/AiSuggestionCard.tsx` — render nye felt (type, mangler, risiko, foreslåtte ordrefelt, per-felt confidence)
- `src/ordre/pages/TicketDetail.tsx` — split-view layout
- `src/ordre/pages/NewOrder.tsx` — les og forhåndsutfyll fra `ai_suggestion`; AI-banner; "marker ticket ferdig"-checkbox
- `src/ordre/pages/OrderDetail.tsx` — "Fra ticket"-lenke når `source = 'ticket'`
- `src/ordre/pages/TicketsList.tsx` — nye badges
- (Ingen DB-migrasjon — alt nytt ligger i eksisterende `ai_suggestion`-jsonb)

---

## Det som EKSPLISITT ikke gjøres nå

- Separate AI-knapper (avklaringsmail, bekreftelse, svarforslag)
- Generering av ordrebekreftelse med mal
- "Foreslå eksisterende ordre"-koblings-UI (AI returnerer ikke kandidater ennå)
- Full ny ticket-liste med filtre, søk på telefon/ordrenr, per-lokasjon
- Nye ticket-statuser (`ai_forslag_klart`, `trenger_avklaring` …) — bruker dagens 5 statuser fortsatt
- Tidslinje-UI på ticket og ordre
- Produksjons/butikk-notat-generering som egne strukturerte felt
- Endring av tabellstruktur for orders/tickets (kun jsonb-utvidelse)
