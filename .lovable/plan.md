## Oversikt

Bygger en ny "Live forhandling"-modus (over bordet) som komplement til eksisterende RFQ-flyt. Bruker fører forhandlingen i sanntid, søker opp råvarer, ser faktagrunnlag, og fyller inn avtalt pris fortløpende. Etter møtet sendes oppsummering til leverandør for bekreftelse.

## Datamodell

**Migrasjon 1 — utvide `negotiations`:**
- `negotiation_mode text not null default 'rfq'` ('rfq' | 'live')
- `live_session_started_at timestamptz`
- `live_session_ended_at timestamptz`
- `live_facilitator_id uuid` (auth.users)
- `live_location_format text` ('physical' | 'video' | 'phone')

**Migrasjon 2 — utvide `negotiation_items`:**
- `live_status text default 'pending'` (pending | discussing | tentatively_agreed | agreed | declined | parked)
- `live_agreed_price numeric`, `live_agreed_price_unit text`
- `live_agreed_package_size numeric`, `live_agreed_package_unit text`
- `live_agreed_price_per_base_unit numeric`
- `live_agreed_contract_months int`
- `live_agreed_min_volume numeric`, `live_agreed_min_volume_unit text`
- `live_agreed_payment_terms_days int`
- `live_agreed_at timestamptz`, `live_agreed_by uuid`
- `live_notes text`

**Migrasjon 3 — ny tabell `negotiation_live_events`:**
Felter: `id`, `negotiation_id` (FK cascade), `negotiation_item_id` (FK cascade nullable), `event_type`, `event_data jsonb`, `note text`, `created_by`, `created_at`. Indeks på `(negotiation_id, created_at)`.

**RLS:** Samme mønster som eksisterende negotiation-tabeller — knyttet til `legal_entity_id` via `negotiations`-relasjon.

## UI-flyt

### 1. Type-velger (modal)
Når bruker klikker "+ Forhandling" i `ForhandlingerList`, åpne dialog som tilbyr:
- **RFQ** (eksisterende wizard) → navigerer til `/ravarer/forhandlinger/ny`
- **Live forhandling** → navigerer til `/ravarer/forhandlinger/live/ny`

### 2. Live forberedelse-side (`LiveForhandlingSetup`)
- Velg leverandør (dropdown med søk)
- Tittel (auto-foreslått: "Q{kvartal} reforhandling {leverandør}")
- Sted/format (radio: fysisk/video/telefon)
- Notater (textarea)
- Checkbox: "Forhåndslast alle aktive råvarer fra {leverandør}" (viser antall via `useRmSuppliers`)
- "Start forhandling" → opprett negotiation + items + event 'session_started' → naviger til arbeidsflate

### 3. Live arbeidsflate (`LiveForhandlingWorkspace`)
Egen layout, minimalt menystøy. Topp:
- Rød pulsindikator + "LIVE FORHANDLING · {leverandør} · {Xt min}" (live timer)
- Fasilitator-navn + leverandør
- Knapper: "Pause", "Avslutt →"

Hovedinnhold (tre seksjoner i prioritert rekkefølge):

**A. Søk og legg til** (Command-stil søk)
- Input: skriv navn → liste over råvarer (filter: ikke allerede i forhandling)
- "Legg til" → setter `live_status='discussing'`, åpner kort

**B. Aktivt diskusjons-kort** (`LiveItemCard`, status=discussing)
- Stort råvare-navn
- Faktagrunnlag-blokk: bruker `usePurchaseStats` for volum 12mnd, kostnad, snittpris; eksisterende avtalt pris fra `useRmSuppliers`; trend 24mnd
- Forslag: enkel beregning (f.eks. snittpris - 5%)
- Inputs: pris, prisenhet, pakning, pakningsenhet, avtalemåneder, min ordre, betalingsdager
- Auto-beregner `live_agreed_price_per_base_unit` via `_shared/units.ts`-mønster
- Notat-felt
- Knapper: **Avtalt** / **Park** / **Avslå** (skriver event + oppdaterer item)

**C. Behandlet-liste**
- Kompakt liste over items med status agreed/parked/declined
- Klikk → utvid for å redigere

**Footer:**
- "{X} av {Y} råvarer behandlet · Total besparelse: {kr}/år"

### 4. Avslutt-flyt (`LiveForhandlingSummary`)
- Sett `live_session_ended_at`, status=concluded
- Vis sammendrag: alle agreed items, totale besparelser
- Knapp: "Send oppsummering til leverandør for bekreftelse" → bruker eksisterende RFQ-credentials-flyt for å gi leverandør tilgang til en bekreftelses-portal (kan komme i senere iterasjon — for nå: kopier sammendrag til utklippstavle + send via mailto)

## Filer

**Nye:**
- `src/ravarer/pages/forhandlinger/NewNegotiationTypeDialog.tsx` — type-velger
- `src/ravarer/pages/forhandlinger/LiveForhandlingSetup.tsx`
- `src/ravarer/pages/forhandlinger/LiveForhandlingWorkspace.tsx`
- `src/ravarer/pages/forhandlinger/LiveForhandlingSummary.tsx`
- `src/ravarer/pages/forhandlinger/components/LiveItemCard.tsx`
- `src/ravarer/pages/forhandlinger/components/LiveItemSearch.tsx`
- `src/ravarer/pages/forhandlinger/components/LiveTimer.tsx`
- `src/ravarer/hooks/useLiveNegotiation.ts` — CRUD for live-state, events, items
- `supabase/migrations/...sql` — schema-utvidelser + RLS

**Endrede:**
- `src/App.tsx` — nye ruter `/ravarer/forhandlinger/live/ny` og `/ravarer/forhandlinger/live/:id`
- `src/ravarer/pages/forhandlinger/ForhandlingerList.tsx` — bruk type-velger; vis mode-badge på rader; klikk på live-forhandling → workspace istedenfor detail
- `src/ravarer/pages/forhandlinger/ForhandlingDetail.tsx` — render forskjellig basert på `negotiation_mode` (live viser oppsummering med events, RFQ uendret)
- `src/ravarer/hooks/useNegotiations.ts` — utvid `NegotiationRow` og `NegotiationItemRow` med nye felt

**Ingen endring i:** RFQ-wizard, supplier portal, eksisterende edge functions.

## Tekniske detaljer

- **Live timer:** `useEffect` med `setInterval(1000)` som regner ut diff mot `live_session_started_at`
- **Optimistic updates:** Bruk `useMutation` med `onMutate` for snappy UX i workspace
- **Event logging:** Hver knappetrykk (avtalt/park/avslå/note) logges automatisk via en `logLiveEvent`-helper
- **Søk:** Reuse `useRawMaterials` med klient-side fuzzy filter (cmdk-stil); ekskluder råvarer som allerede har item i denne forhandlingen
- **Faktagrunnlag:** Reuse `usePurchaseStats` per råvare (kjører for aktivt kort)
- **Ingen sanntids-multibruker**: Én fasilitator i taget; ingen Supabase realtime-abonnement i denne iterasjonen
- **Leverandør-bekreftelse:** Iterasjon 1 — mailto + utklippstavle; iterasjon 2 (senere) — gjenbruke RFQ-token-mekanisme for confirm-portal

## Levering i to faser

**Fase A (denne PR):** Migrasjoner + type-velger + setup + workspace + lagring av events/agreements + ny rute. Avslutt-knappen lukker sesjonen og setter status=concluded med klipp/mailto-summary.

**Fase B (senere, ved ditt klarsignal):** Confirm-portal for leverandør med token-tilgang og datablad-opplasting per item, samt automatisk push til `raw_material_suppliers` (parallell til `apply-negotiation-outcome`).
