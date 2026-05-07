## Status

Phase A er ferdig: modus-velger, `LiveForhandlingSetup`, `LiveForhandlingWorkspace` med søk, faktagrunnlag, Avtalt/Park/Avslå, sanntids-besparelse, og avslutning som kopierer sammendrag / mailto.

Denne planen dekker Phase B – det som gjenstår fra spesifikasjonen.

## Datamodell

**Migrasjon — utvide `negotiation_items`:**
- `live_status` utvides med verdier: `unconfirmed_active`, `confirmed`
- `live_confirmed_at timestamptz`, `live_confirmed_by_supplier boolean default false`
- `live_supplier_note text` (notat fra leverandør under bekreftelse)
- `live_datasheet_url text` (peker til opplastet PDF i Storage)
- `live_datasheet_skipped boolean default false` ("sendes separat")

**Migrasjon — utvide `negotiations`:**
- `live_session_paused boolean default false`
- `live_confirmation_deadline timestamptz`
- `live_auto_apply_on_confirm boolean default true`
- `live_send_reminder_after_days int default 7`

**Storage:**
- Ny bucket `negotiation-datasheets` (private). RLS: leverandør med gyldig token kan upload (via signed URL fra edge function); legal entity-medlemmer kan lese.

**RLS:** Eksisterende `negotiation_live_events` og `negotiation_items` policies gjenbrukes. Tokenisert tilgang gjøres via service-role i edge functions (samme mønster som RFQ).

## Edge functions

**Ny: `validate-live-confirmation-access`**
Kopi av `validate-rfq-access`-mønster: tar token + passord, validerer mot eksisterende `negotiation_recipients` (gjenbruker token-feltene), returnerer signed session-token + minimal forhandlings-data (kun avtalte items).

**Ny: `submit-live-confirmation`**
Tar session-token + array av `{ negotiation_item_id, confirmed: bool, supplier_note?, datasheet_path?, datasheet_skipped? }` + payment_terms_days. Per linje:
- Hvis `confirmed=true`: sett `live_status='confirmed'`, `live_confirmed_at=now()`.
- Hvis avvist med notat: behold `tentatively_agreed`, lagre `live_supplier_note`.
- Logger event `confirmation_submitted` per linje.
- Når alle `tentatively_agreed`/`unconfirmed_active` er løst: hvis alle confirmed og `live_auto_apply_on_confirm=true`, kall internt `apply-negotiation-outcome`-logikk for hver linje (eller marker `negotiations.status='concluded'` + `concluded_at`).

**Ny: `request-live-datasheet-upload`**
Tar session-token + `negotiation_item_id`, returnerer signed upload URL til `negotiation-datasheets/<negotiation_id>/<item_id>.pdf`.

**Utvide `generate-rfq-credentials`** (eller ny `generate-live-credentials` som wrapper) til å håndtere `negotiation_mode='live'` — samme token/passord-mekanisme, bare annen e-post-template.

## Frontend

**Endring i `LiveForhandlingWorkspace` avslutnings-dialog:**
Erstatt nåværende "kopier/mailto" med ekte avslutnings-modal:
- Sammendrag (avtalt/parket/urørt + total besparelse)
- Mottaker-felt (forhåndsutfylt fra recipient, redigerbart)
- Frist for bekreftelse (default 14 dager)
- Toggles: vis pris-snapshot, auto-oppdater `raw_material_suppliers`, send påminnelse etter 7 dager
- "Avslutt og send →":
  1. Setter `live_session_ended_at`, `status='awaiting_confirmation'`, `live_confirmation_deadline`
  2. Kaller `generate-rfq-credentials` (eller ny wrapper) for å lage token + passord
  3. Kopierer ferdig e-post-tekst (med token-URL `https://nbhub.no/bekreftelse/<token>`) til utklippstavle + tilbyr mailto

**Pause-knapp:** legg til i live-header — toggler `live_session_paused`, viser "Pauset"-banner.

**Re-åpne behandlede:** Klikk på rad i "Allerede behandlet" → setter `live_status='discussing'`, logger `item_reopened`. Krever liten endring i `LiveForhandlingWorkspace`.

**Park/Avslå begrunnelse:** vis lite prompt (textarea) når park/avslå klikkes — lagres i `live_notes`.

**Ny: `LiveTidslinje`-komponent** (drawer i `ForhandlingDetail`) som viser kronologisk `negotiation_live_events` med ikon per `event_type`.

**Endring i `ForhandlingDetail`:** når `negotiation_mode='live'` og status er `awaiting_confirmation` eller `concluded`, vis live-spesifikk visning:
- Liste over avtalte items med bekreftelses-status (✅ confirmed / ⏳ venter / ⚠️ supplier-notat)
- Knapper: "Send påminnelse" (mailto), "Aktiver bekreftede selv om alt ikke er bekreftet" (kaller funksjon som setter ubekreftede til `unconfirmed_active` og kjører apply for confirmed)
- "Vis møte-tidslinje" → `LiveTidslinje`-drawer

**Ny rute `/bekreftelse/:token`** — `LiveConfirmationPortal`:
- Login (token + passord) via `validate-live-confirmation-access`
- Liste over avtalte items, hver med:
  - Snapshot av avtalt pris/pakning/avtale-måneder
  - Sjekkboks "Jeg bekrefter"
  - PDF-opplastings-knapp (kaller `request-live-datasheet-upload`, så direkte upload til signed URL) + sjekkboks "Datablad sendes separat"
  - Notat-felt
- Generelle vilkår: betalingsdager
- "Bekreft alle"-snarvei + "Lagre kladd" (lagrer i localStorage)
- "Send bekreftelse" → `submit-live-confirmation`. Validering: hver bekreftet linje må ha datablad eller "sendes separat".

## Filer

**Nye:**
- `supabase/migrations/<ts>_live_confirmation.sql`
- `supabase/functions/validate-live-confirmation-access/index.ts`
- `supabase/functions/submit-live-confirmation/index.ts`
- `supabase/functions/request-live-datasheet-upload/index.ts`
- `src/ravarer/pages/forhandlinger/LiveConfirmationPortal.tsx`
- `src/ravarer/pages/forhandlinger/components/LiveEndSessionDialog.tsx`
- `src/ravarer/pages/forhandlinger/components/LiveTidslinjeDrawer.tsx`
- `src/ravarer/pages/forhandlinger/components/LiveConfirmationStatusList.tsx`
- `src/ravarer/hooks/useLiveConfirmation.ts`

**Endrede:**
- `src/App.tsx` — rute `/bekreftelse/:token`
- `src/ravarer/pages/forhandlinger/LiveForhandlingWorkspace.tsx` — pause, re-åpne, park/avslå-begrunnelse, ny avslutnings-dialog
- `src/ravarer/pages/forhandlinger/ForhandlingDetail.tsx` — live-spesifikk visning ved awaiting_confirmation/concluded
- `src/ravarer/hooks/useNegotiations.ts` — type-utvidelser

## Levering

Stort omfang — foreslår å splitte i to PRs hvis ønsket:

**B1 (nå):** Migrasjon + avslutnings-dialog + edge functions + leverandør-portal + grunnleggende status-visning. Pause/re-åpne/tidslinje kan komme i B2.

**B2 (etterpå):** Pause, re-åpne, park-begrunnelse, møte-tidslinje, påminnelses-flyt, manuell aktivering ved delvis bekreftelse, "datablad allerede aktuelt"-gjenbruk.

Si fra om du vil at jeg leverer alt i én eller splitter — så kjører jeg i gang.
