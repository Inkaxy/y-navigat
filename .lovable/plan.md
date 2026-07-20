## Bakgrunn

I dag settes `delivery_notes.finalized_at` aldri — hverken kode eller database gjør det. Alle 27 eksisterende pakksedler står som `draft`, og kundeportalen (`portal_list_delivery_notes` filtrerer på `finalized_at IS NOT NULL`) viser derfor ingenting. Vi lukker gapet ved å finalisere automatisk ved hovedkjøring, og gi mulighet for å "tilbakekjøre" (av-finalisere) enkelt eller i bulk.

## Endringer

### 1) Auto-finaliser ved hovedkjøring
- Utvid `generate_delivery_notes(...)` (databasefunksjonen som allerede kalles fra `useGenerateDeliveryNotes`) slik at når `p_run_type = 'main'`:
  - Alle nye pakksedler opprettes med `status='finalized'`, `finalized_at = now()`, `finalized_by = auth.uid()`.
- `additional` og `correction` finaliseres også automatisk (samme regel) — bruker sa "ved hovedkjøring", men i praksis vil både tilleggs- og korreksjonskjøringer også produsere pakksedler som skal ut til kunde. Bekreft under review om `additional`/`correction` skal beholde `draft`-flyt i stedet.
- Legg `notes_finalized` i returtypen (informativt).

### 2) Tilbakekjøring (av-finalisering)
Ny RPC `unfinalize_delivery_notes(p_ids uuid[], p_reason text)`:
- Setter `status='draft'`, nullstiller `finalized_at`/`finalized_by`.
- Nekter hvis pakkseddelen er `cancelled` eller allerede referert av en pakkesystem-eksport / retur-ordre-kobling (sjekk `finalized_at IS NOT NULL`-avhengige rader).
- Logger til `delivery_note_runs` med `run_type='unfinalize'` (ny variant) for sporing.

### 3) UI

**`DeliveryNotesList.tsx` (bulk):**
- Ny sekundærknapp "↩ Tilbakekjør valgte" ved siden av "Skriv ut valgte" — synlig kun når minst én valgt rad har `status='finalized'`.
- Bekreftelsesdialog med årsak (`p_reason`), toast med antall.

**`DeliveryNoteDetail.tsx` (enkelt):**
- Ny knapp "↩ Tilbakekjør pakkseddel" når `status='finalized'`.
- Vis `finalized_at`/`finalized_by` i header når satt.

**Statusstripe i lista:** oppdater `statusVariant` slik at `finalized` er default-visning etter hovedkjøring (allerede definert, bare mer synlig).

### 4) Backfill av eksisterende data
Éngangs data-oppdatering (via insert-verktøyet, ikke migrasjon): sett `finalized_at = created_at`, `status='finalized'` på alle 26 eksisterende `draft`-rader som ikke er `cancelled`, slik at Teies pakksedler dukker opp i kundeportalen umiddelbart.

### 5) Kundeportal
Ingen endring nødvendig — `portal_list_delivery_notes` fortsetter å filtrere på `finalized_at IS NOT NULL` og vil nå returnere alle finaliserte rader.

## Tekniske detaljer

- `delivery_note_runs.run_type` må tillate `'unfinalize'` (sjekk CHECK-constraint; utvid ved behov).
- RPC-ene skal være `SECURITY DEFINER` med `SET search_path = public` og sjekke at kaller har tilgang til `legal_entity_id` (samme mønster som `generate_delivery_notes`).
- `useGenerateDeliveryNotes` og en ny `useUnfinalizeDeliveryNotes` invaliderer `delivery-notes-list`, `delivery-note-counts`, `delivery-note-runs`.
- Ingen endring i `pakkesystem-export` — den krever fortsatt finaliserte pakksedler og vil nå faktisk finne dem.

## Åpne spørsmål (kan avklares under implementering)

1. Skal `additional` og `correction` også auto-finaliseres, eller kun `main`?
2. Skal tilbakekjøring være tillatt hvis pakkseddelen allerede er eksportert til Pakkesystem, eller blokkeres helt?