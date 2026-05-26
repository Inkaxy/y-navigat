## Runde 2 — Eksisterende ordre, endringer og kobling

Mål: ticket-systemet skal forstå når en epost gjelder en *eksisterende* ordre, foreslå hvilken, og — for endringer — vise konkret hva som skal endres med trygg godkjenning før lagring.

Bygger videre på Runde 1 (`analyze-email-with-ai`, `AiSuggestionCard`, `tickets.ai_suggestion`, `tickets.related_order_id`). Klassifiseringen (`request_type`) finnes allerede; den brukes nå aktivt.

---

### 1. Utvidet AI-analyse: kandidat-ordre + endringsforslag

**Edge-funksjon `analyze-email-with-ai`:**

- Før AI-kallet, hent kandidat-ordre for kunden(e) som matcher epost/navn/telefon i bodyen:
  - Aktive ordre (`status` ∈ open, confirmed, in_production, ready) for kunden de siste 60 dager + alle fremtidige hentedatoer.
  - Top 10 kandidater, send som strukturert kontekst (id, ordrenr, hentedato, hentested, status, antall linjer, kort linje-sammendrag, kaketekst, allergi).
- Schema utvides med:
  - `candidate_orders: [{ order_id, order_number, why_match, match_confidence, snapshot }]` — AI velger 0–3 fra kandidatlisten den fikk.
  - `referenced_order: { order_id, order_number, match_confidence } | null` — den AI tror eposten *handler om* (én).
  - `change_intent: { target_order_id, changes: [{ field, current_value, proposed_value, reasoning, confidence }], cancellation_reason? } | null` — kun satt når `request_type ∈ change | cancellation`.
- Felt som kan endres (whitelist): `delivery_date`, `delivery_time`, `pickup_location_id`, `cake_text`, `allergies`, `customer_notes`, `production_notes`, `delivery_address_*`, og per produktlinje: `quantity`, `flavor`, `filling`, `decoration`, `size_or_servings` + `add_line` / `remove_line`.
- Bytt til **tool-calling / structured output** for garantert schema (oppfølging av Runde 1-svakheten).
- System-prompt får eksplisitte regler: "Hvis kunden refererer til en eksisterende bestilling, sett `referenced_order` til den mest sannsynlige kandidaten. Bare foreslå endringer som er entydige; ellers la confidence være lav."

**Frontend `aiSuggestion.ts`:** legg til typer for `CandidateOrder`, `ReferencedOrder`, `ChangeIntent`, `ProposedChange`.

### 2. UI: "Foreslåtte ordre å koble til"

Nytt kort i `AiSuggestionCard` (eller egen `RelatedOrdersCard`), vises når `candidate_orders.length > 0` **og** `!ticket.related_order_id`:

- Liste over kandidater: ordrenr, hentedato (relativ), hentested, kort linje-sammendrag, confidence-badge, "hvorfor"-tekst.
- Den med høyest confidence (eller `referenced_order`) er fremhevet øverst.
- Hver rad har "Koble til"-knapp → setter `tickets.related_order_id` + `tickets.linked_at` + audit.
- Sekundærknapp "Vis ordre" åpner ordren i ny tab.
- Når ticket allerede er koblet: vis aktuell kobling med "Bytt"/"Fjern kobling"-handlinger.

### 3. Endrings-flyt: forslag → godkjenning → lagring

Når `request_type = "change"` **og** `change_intent` finnes:

- Nytt `ChangeProposalCard` under "Foreslått handling" i AI-panelet.
- Viser en diff-tabell: `Felt | Nåværende verdi | Foreslått ny verdi | AI-begrunnelse`.
- Hvert forslag har egen checkbox (default på hvis confidence ≥ 0.8). Ansatt kan redigere "ny verdi" inline før godkjenning.
- Hovedknapp: **"Bruk valgte endringer på ordre"** → åpner bekreftelses-dialog som viser endelig diff + krever eksplisitt "Bekreft og lagre".
- Ved bekreftelse: kall ny edge-funksjon `apply-ticket-change` som:
  1. Validerer at brukeren har skrivetilgang på ordre-app.
  2. Henter ordren, sjekker at `referenced_order.order_id` matcher.
  3. Skriver kun de whitelistede feltene som er huket av.
  4. Logger til `order_audit_log` (kilde: `ticket:<id>`, AI-forslag JSON, hvem som godkjente).
  5. Legger en kommentar/aktivitet på ordren: "Endret fra ticket #X av <bruker>".
  6. Setter `tickets.status = 'resolved'` hvis "marker ferdig"-checkbox er på.
- Frontend invaliderer ordre- og ticket-queries, viser toast.

### 4. Kansellering

Når `request_type = "cancellation"`:

- Vis tilsvarende kort med rød tint, "Kunden ønsker å kansellere ordre #X" + `cancellation_reason`.
- Knapp: **"Kanseller ordre"** → bekreftelses-dialog → samme edge-funksjon, men setter `orders.status = 'cancelled'` + grunn i internal note.
- Aldri auto-kanseller; alltid manuell bekreftelse.

### 5. Spørsmål / Reklamasjon

`request_type ∈ question | complaint`:

- Ingen endrings-CTA, men vis `referenced_order` (hvis funnet) tydelig + "Vis ordre"-knapp.
- AI-panelet beholder sammendrag og foreslått handling som tekst (Runde 1).

### 6. Bakoverkobling fra ordre

I `OrderDetail.tsx`: hvis det finnes tickets med `related_order_id = order.id`, vis liste under "Aktivitet" med ticket-emne, status, dato — slik at ansatte ser hele konversasjonen rundt en ordre.

### 7. Logging og sikkerhet

- All `apply-ticket-change` skriver til eksisterende `order_audit_log` + `ai_call_log` med `action: 'apply_change'` / `'cancel_order'`.
- RLS: `apply-ticket-change` kjører som user, sjekker `has_app_write_access('ordre')`.
- Endringer på `tickets.related_order_id` logges via eksisterende `audit.ts`.

---

### Filer som endres

- `supabase/functions/analyze-email-with-ai/index.ts` — kandidat-ordre, endrings-schema, tool-calling.
- `supabase/functions/apply-ticket-change/index.ts` — **ny**.
- `src/ordre/lib/aiSuggestion.ts` — nye typer.
- `src/ordre/components/orders/AiSuggestionCard.tsx` — koble inn kandidat + endrings-kort, eller splitte ut.
- `src/ordre/components/orders/RelatedOrdersCard.tsx` — **ny**.
- `src/ordre/components/orders/ChangeProposalCard.tsx` — **ny**.
- `src/ordre/pages/TicketDetail.tsx` — montere de nye kortene.
- `src/ordre/pages/OrderDetail.tsx` — vise tickets koblet til ordren.
- `src/ordre/hooks/useTickets.ts` — mutation for `linkToOrder` / `unlinkOrder`.

### Bevisst ikke i denne runden

- Auto-foreslå **nye produktlinjer** fra endringer (kun whitelistede felt + qty på eksisterende linjer).
- AI-svarutkast ("foreslå bekreftelses-epost").
- Bulk-koble flere tickets.
- Endre allerede leverte ordre (kun aktive/fremtidige).
- Avansert konflikthåndtering hvis to brukere endrer samtidig (vi stoler på siste-skriver-vinner + audit).

### Migrasjoner

Ingen schema-endringer nødvendig — `tickets.ai_suggestion` er `jsonb` og rommer alt nytt. Vurderer kun en valgfri `tickets.linked_at timestamptz` for sortering; legges til hvis det blir nyttig under bygging.
