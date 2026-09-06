# Råvarer — kontrollrunde 06.09.2026

Rammer: ingen migrasjoner, ingen nye tabeller/kolonner, ingen datarydding, ikke publisert.
Endringer i edge-funksjonene `apply-datasheet-update`, `validate-rfq-access` og
`validate-live-confirmation-access` var eksplisitt del av oppgaven.

## 1. Massekobling mot Matvaretabellen — utført
- `src/ravarer/pages/KobleMatvaretabellen.tsx`: samlet lastetilstand for både dekning og
  matvareliste, feil viser feilmelding (ikke lenger «Ingenting å koble»), «Prøv igjen»
  henter begge på nytt. Koblede rader forsvinner fra lista, enkelt- og masseoperasjoner
  kan ikke overlappe, og massekoblingen gir én oppsummering med antall som feilet.
- `src/ravarer/hooks/useMatvaretabellen.ts`: `useApplyMatvaretabellen` tar `silent`
  (ingen toast per rad i bulk), invaliderer dekning og alle råvarenøkler via felles
  `invalidateRawMaterial`, og gjør bare før/etter-oppslag av deklarasjonsnavn når det
  faktisk skal vises.

## 2. Dekningsgrad — utført
- `src/ravarer/hooks/useNutritionCoverage.ts`: skiller `complete` / `incomplete` /
  `missing`, bryter ned på kilde (matvaretabellen, datablad, manuell, analyse) og
  regner oppskriftsvektet dekning. `energy_kcal` alene teller ikke som komplett;
  åtte felter kreves, fiber er frivillig. Reelle nullverdier bevares (0 ≠ mangler).
  `safe_to_overwrite` hindrer at massekobling overskriver manuelle/datablad-verdier.
- `src/ravarer/pages/Matvaretabellen.tsx`: KPI-en viser de tre tilstandene med
  forklaring og en gjennomgangsliste for ufullstendige rader.

## 3. Forslag fra Matvaretabellen — utført
- `src/ravarer/lib/foodSuggestions.ts`: `assessSuggestions` sperrer automatisk kobling
  når topp 2 ligger innenfor `AMBIGUITY_MARGIN` (0,08), når toppscoren er under
  `AUTO_LINK_MIN_CONFIDENCE` (0,8), eller når kandidatene skiller seg på beskyttede
  varianter (fettprosent, hel/lett/skummet, rå/kokt/tørket/stekt, saltet/usaltet,
  glutenfri, sukkerfri). Årsaken vises i lista og brukeren må velge selv.
  Prosenten presenteres som likhet, ikke som kalibrert sikkerhet.

## 4. Allergenforslag — utført
- `src/ravarer/components/tabs/NutritionTab.tsx`: «Foreslå allergener» skriver ikke
  lenger. Forslagene vises i et forhåndsvisningskort med avhuking, «Godkjenn valgte»
  og «Forkast forslagene»; bare avhukede forslag lagres, med oppsummering av feil.
  Skjemaet synkes bare fra databasen når feltene er urørte eller råvaren byttes, slik
  at et bakgrunnsoppdatert svar ikke kaster bort ulagret arbeid. Lagrevakt og
  tastatursnarvei for lagring er uendret.

## 5. `apply-datasheet-update` — utført, med én dokumentert begrensning
- Alle lesinger og skrivinger sjekker `{ error }`. Feil samles i `failures`, og
  databladet merkes `applied` bare når lista er tom. Svaret har status 207 ved delvis
  feil, og grensesnittene (`DatasheetSection.tsx`, `DatabladBulk.tsx`,
  `useMissingNutrition.ts`) melder fra i stedet for å vise «lagret».
- Allergener: diffen valideres først. Inneholder AI-svaret ukjente koder
  (`rejected`), fjernes ingen eksisterende allergener. Fjerning krever i tillegg
  eksplisitt menneskelig godkjenning via `allergen_removals` i `accepted_fields`.
- Næring: `accepted_nutrition_fields` håndheves i backend — fravalgte felter skrives
  ikke.
- Pakning: skrives ikke rått lenger. Funksjonen returnerer
  `follow_ups.package_suggestion`, og brukeren fullfører i pakningsdialogen
  (`set_raw_material_package`), som også regner om kostprisen.
- Komponenter: rader som er koblet til en egen råvare bevares; bare tidligere
  AI-forslag uten kobling erstattes.
- **Gjenstår (krever databaseobjekt):** operasjonen er ikke transaksjonell. En feil
  midtveis kan etterlate delvis anvendte endringer. Bør flyttes til en
  transaksjons-RPC `apply_datasheet_update(...)` når nye databaseobjekter tillates.

## 6. Portallekkasje (E8) — utført
- Nytt `supabase/functions/_shared/negotiation-projection.ts` med eksplisitt
  SELECT-liste **og** eksplisitt responsprojeksjon for begge portalene.
  `validate-rfq-access` og `validate-live-confirmation-access` bruker den nå;
  `select("*")` er borte. Interne felter (`actual_cost_baseline`, `target_price`,
  interne notater, margin- og walk-away-felter) kan ikke lenger følge med, heller ikke
  nye kolonner som legges til i tabellen senere.
- Token- og tilgangskontrakten er uendret. `SupplierPortal.tsx` og
  `LiveConfirmationPortal.tsx` er lest gjennom; alle felter de bruker er med.
- Tester: `supabase/functions/validate-rfq-access/projection_test.ts` injiserer interne
  felter og verifiserer at de ikke lekker. 4 tester, exit 0.

## 7. Verifisering
- `npx tsgo --noEmit -p tsconfig.app.json` — exit 0, ingen utdata.
- `npx vitest run` — 37 filer, 353 tester, alle grønne.
- Deno-tester for `validate-rfq-access` — 4 passed, 0 failed.
- `npx eslint` på berørte filer — rent, bortsett fra preeksisterende `any` i
  `src/varer/hooks/useMissingNutrition.ts` (ikke innført av denne runden).
- `npm run build` — grønn.

## Ikke verifisert
- Live databasekontroll av F1/F2/F3 (funksjoner/triggere) er ikke gjort: tilgangen til
  databasespørringer er blokkert i dette miljøet (`database_not_managed`).
- Edge-funksjonene er endret i kode. Om de er deployet i miljøet er ikke bekreftet her.
- E7 og F1–F6 er ikke erklært ferdig.
