## Hva som er feil

Kunder-appen har sin egen, isolerte selskapsvelger (`SelectedEntityProvider` i `src/kunder/state/SelectedEntityContext.tsx`) som lagrer valg i localStorage-nøkkelen `kunder_selected_legal_entity`. Det finnes **ingen UI** for å bytte selskap inne i Kunder-appen — banneret har bare en "Ny kunde"-knapp. Topbar/CompanySelector skriver kun til den globale `SelectionProvider` (`nbhub.selection`), så bytter der påvirker ikke Kunder.

Resultat for deg nå:
- `selected` i Kunder leses fra localStorage og treffer enten et selskap uten kunder (NB AS) eller `__ALL__`. Verifisert i DB: de 2 kundene (Teie, Meny Eiktoppen) ligger i NBE (`751709bc-...`), ikke i selskapet velgeren peker på.
- "Ny kunde" er disabled fordi `canCreateInScope = !isAll && !!selected && hasKunderWrite` — enten `isAll = true` (`__ALL__`) eller selected peker på et entity hvor du faktisk har skrive-tilgang men ikke ser kundene som ligger i NBE.

Du har skrive-tilgang (daglig_leder/plattform_ansvarlig → admin på `kunder`-appen), så tilgang er ikke problemet — det er bare at appen viser feil selskap og ikke gir deg mulighet til å bytte.

## Fiks

Fjern den isolerte Kunder-konteksten og bruk global `SelectionProvider` (samme som Ordre/Råvarer bruker). Da følger Kunder-appen selskapsvelgeren i topbar.

### Endringer

1. **`src/kunder/state/SelectedEntityContext.tsx`** — beholdes som tynn adapter:
   - `useSelectedEntity()` returnerer nå `{ selected, setSelected, isAll }` basert på `useSelection()` fra `@/providers/SelectionProvider`. `selected = legalEntityId` (eller `ALL_ENTITIES` hvis det er satt eksplisitt). `setSelected` kaller `setLegalEntityId` og invaliderer `customers`/`customer`/`price-lists` queries.
   - `SelectedEntityProvider` blir en passthrough som ved første mount sjekker: hvis global `legalEntityId` er null og `defaultEntityId` finnes (brukerens primær-entity), kall `setLegalEntityId(defaultEntityId)`. Migrer eventuell verdi fra `kunder_selected_legal_entity` én gang og slett nøkkelen.

2. **`src/App.tsx`** — `KunderEntityProvider` beholdes som er (sender fortsatt `defaultEntityId={access?.primaryEntityId}`).

3. **Ingen endringer i `CustomerList.tsx` / `useCustomers.ts`** — de leser fortsatt via `useSelectedEntity()`.

### Migrering av eksisterende localStorage

I provider-mount: hvis `localStorage.kunder_selected_legal_entity` finnes og global `legalEntityId` er null, sett global til den verdien, så fjern nøkkelen.

### Verifisering etter implementering

- Last `/kunder/kundeliste` — selskapet i topbar skal styre listen.
- Bytt selskap i topbar til NBE → 2 kunder vises (Teie, Meny Eiktoppen — Meny er inactive, så filter "Aktive" viser kun Teie).
- "Ny kunde"-knapp aktiv når et spesifikt selskap er valgt.
