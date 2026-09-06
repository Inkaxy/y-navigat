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

## Runde D–F (avslutning)

- **D Pakninger:** `src/ravarer/pages/Pakninger.tsx` skriver ikke lenger direkte til `raw_materials`. Bekreftelse går nå via `set_raw_material_package` (forhåndsvisning → lagring) med «Angre» i toasten. Ser forhåndsvisningen usikker ut (`ok=false`, ukjente enheter eller uteliggere), åpnes `SetPackageDialog` for full gjennomgang i stedet for blind lagring. URL og hurtigtaster er uendret.
- **E Enheter:** `src/varer/lib/bakers.ts` har aliaser for `liter/l/dl/cl/stk` og `convertToGrams` som markerer ufullstendige omregninger (manglende tetthet eller stykkvekt) med forklaring — ingen stille nullvekt.
- **F Varemottak/Varetelling:** `src/ravarer/pages/Varemottak.tsx` viser nå feil fra fakturaer, linjer og enheter samlet i `QueryState` med felles «Prøv igjen». `useGoodsReceipt` henter linjer og bevegelser komplett via `fetchAllRows`; `useStockCount` kaster ved `ok === false` eller ugyldig svar, og telleutkastet beholdes.
- **Verifisering:** typecheck 0, `vitest run` 353/353, eslint rent på berørte filer, `npm run build` grønt.

## Korrigeringsrunde 2 (etter eb6f1b15)

1. **NutritionTab-synk** — ny `src/ravarer/hooks/useNutritionDraft.ts`: «endret» måles mot SIST INNLASTEDE snapshot, ikke mot den nyankomne serverraden. `NutritionTab.tsx` viser `QueryState` til første svar er hydret, beholder brukerutkast ved refetch, blir ren igjen når lagringen kommer tilbake, og nullstiller både utkast og AI-forslag ved bytte av råvare. 6 nye tester i `src/ravarer/hooks/__tests__/useNutritionDraft.test.ts` (forsinket første data, urørt refetch, redigert refetch, lagring, bytte, tom rad).
2. **Variantverdier** — `src/ravarer/lib/foodSuggestions.ts`: `VARIANT_WORDS` + `variantAttributes` gir label→verdi; prosent leses fra råteksten (normaliseringen fjerner «,» og «%»). Samsvar kreves begge veier; ukjent eller konflikt ⇒ manuell. 10 nye tester i `src/ravarer/lib/__tests__/foodSuggestions.safety.test.ts`.
3. **DatasheetSection** — per-næringsfelt-avkrysning sendes som `accepted_nutrition_fields`; allergenfjerning er en egen, ikke forhåndsvalgt bekreftelse med før/etter og sperres ved forkastede verdier; `package_suggestion` beholdes i UI med «Åpne pakning», som åpner `SetPackageDialog` med forslaget forhåndsutfylt (ny valgfri `suggestion`-prop). Ingen «anvendt» uten `applied: true` fra serveren.
4. **apply-datasheet-update** — statusoppdateringen kjøres ikke når `unsetErr` oppstår; komponentbevaring leser `suggested_by_ai` og beholder både koblede og manuelle rader. Reglene ligger nå i `supabase/functions/_shared/datasheet-apply-rules.ts` med 7 tester i `src/ravarer/lib/__tests__/datasheetApplyRules.test.ts`.
5. **Verifisering** — `npm run typecheck` (tsc) exit 0, `npx vitest run` 376/376 (var 353; 23 nye), `npm run build` grønt. Lint på berørte filer: rent bortsett fra 8 forhåndseksisterende `no-explicit-any` + 1 ubrukt import i `DatasheetSection.tsx` og 2 ubrukte importer i `SetPackageDialog.tsx` — ikke innført i denne runden.
6. **Projeksjon** — `projectRfqItems`/`projectLiveItems`/`projectRfqResponses` er uendret og fortsatt dekket av Deno-testen. Kontrollen gjelder KODEN; det finnes fortsatt ingen bekreftet live-DB-kjøring eller edge-deploy av disse funksjonene.

**Gjenstående begrensninger:** `apply-datasheet-update` er fortsatt ikke transaksjonell (krever ny RPC/migrasjon). A–F-runden (avstemming, forhandlingsutfall, pakninger, bakers-enheter, lager) er ikke del av denne runden.

## Etterkontroll av A–F (etter d9981eeb)

1. **Pakningsstørrelse regnet feil ved blandede enheter** — `src/ravarer/lib/packageMath.ts` (ny)
   `computeBaseUnitsPerPackage` normaliserer enheten og regner om til råvarens baseenhet
   (500 g på kg-vare = 0,5 kg, 6 × 500 g = 3 kg). Masse mot volum, ukjent enhet, antall ≤ 0
   og ugyldige tall avvises med melding i stedet for stille fallback til 1.
   `src/ravarer/pages/Pakninger.tsx` bruker funksjonen, forhåndsviser via RPC og lar
   `SetPackageDialog` gjøre selve skrivingen (ingen direkte `.update()` igjen).
   Enter lukker dialogen før ny lagring kan starte; suksessmelding vises bare når `res.ok`.

2. **Volum og stykk ga 0 gram** — `src/varer/lib/bakers.ts`
   `convertToGrams` antar ikke lenger vann for ukjent væske; volum uten tetthet og stk uten
   stykkvekt gir `exact: false` med forklaring. `lineToGrams` bruker `unit_weight_grams` som
   stykkvekt og 1 g/ml kun for rent vann. `fromGrams` gir `NaN` ved ukjent omregning.
   `computeTotals` setter `unitCount = null` og `incomplete = true` når noe mangler;
   `RecipeStatsBar` viser «Minst … g» og et varsel med årsakene, og `RecipePartCard`
   beholder brukerens tall i stedet for å skrive `NaN`.
   Spørringene i `Recipes.tsx`, `RecipeDetail.tsx` og `RecipeSummaryCard.tsx` henter
   `unit_weight_grams`.

3. **Statusvakt ved bekreftelse** — `supabase/functions/reconcile-invoice/validate.ts`
   `needs_review` er igjen bekreftbar; `reconciled`/`flagged` er sperret. Ny blocker
   `invalid_base_price`. Meldingen ved flere priser på samme råvare forklarer F2-kravet og
   ber ikke om å endre fakturalinjene.

4. **Prisenhet i forhandlingssvar** — `supabase/functions/_shared/negotiation-projection.ts`
   `offered_price_unit` er fjernet (prisen gjelder pakningen); `ForhandlingDetail.tsx` setter
   `agreed_price_unit: null`.

5. **Tomme avtaler** — `supabase/functions/apply-negotiation-outcome/`
   `apply_to_supplier` krever endelig, ikke-negativ pris og valgt leverandør; alle ID-er
   kontrolleres mot forhandlingen før første skriving; `is_primary` skrives kun eksplisitt.

6. **Regresjonstester** (manglet helt i A–F)
   - `src/test/packageMath.test.ts` (9)
   - `src/test/bakersUnits.test.ts` (11)
   - `supabase/functions/reconcile-invoice/validate_test.ts` (7)
   - `supabase/functions/apply-negotiation-outcome/validate_test.ts` (6)

### Verifisering
`npm run typecheck` (tsc) exit 0 · `npx vitest run` 396 tester / 42 filer, exit 0 ·
Deno-tester 17 passed, exit 0 · `npm run build` exit 0 ·
`npx eslint` rent på nye/berørte filer (gjenstående `any`-feil i `ForhandlingDetail.tsx` og
`RecipePartCard.tsx` er forhåndseksisterende og utenfor denne rundens omfang).

### Kjente begrensninger
- Ingen live database- eller edge-utrullingsbekreftelse i dette miljøet.
- Databladoppdateringen er fortsatt ikke transaksjonell (krever databaseendring).
- Flere kjøpshendelser per råvare på samme faktura krever F2 (fakturalinje-ID i historikken).

## Blokkerende krasj i «Næring & deklarasjon» (NBH-Q8HZQB-3B18)

**Årsak bekreftet:** `useRawMaterialPage` la BOOLEAN i `["raw_material_nutrition", id]`
og ANTALL i `["raw_material_allergens", id]` — nøyaktig de nøklene `useNutrition`
og `useAllergens` leser som rad/liste. `allergens.find(...)` krasjet på tallet.

**Retting — én datakontrakt per query-nøkkel:**
- `src/ravarer/hooks/useNutrition.ts`: `nutritionQueryOptions` / `allergensQueryOptions`
  (komplette rader), `useNutrition`/`useAllergens` bruker dem.
- `src/ravarer/hooks/useRmSuppliers.ts`: `rmSuppliersQueryOptions`.
- `src/ravarer/hooks/useDatasheets.ts`: `datasheetsQueryOptions` + `DatasheetListRow`.
  Den tidligere avvikende nøkkelen `["raw-material-datasheets", id, "current"]` er borte —
  detaljsiden bruker nå samme liste som databladseksjonen.
- `src/ravarer/hooks/useRawMaterialPage.ts` gjenbruker alle fire og utleder
  `hasNutrition`, `allergenCount`, `hasDatasheet`, `recipeCount` lokalt. Ingen
  `Array.isArray`-fallback. `isLoading`/`isError`/`error` dekker nå ALLE delspørringer,
  ikke bare råvaren. Hydreringen/dirty-baselinen fra forrige runde er urørt.
- `useNutrition.ts` er også ryddet for `any` (allergenkoden bruker DB-enumen).

**Integrasjonstest:** `src/test/rawMaterialNutritionCache.test.tsx` (4 tester) monterer
`useRawMaterialPage` og `NutritionTab`/`useNutrition`/`useAllergens` mot SAMME
QueryClient (cachen mockes ikke bort), i begge monteringsrekkefølger, med og uten
næringsrad/allergener, og verifiserer KPI-oppdatering etter invalidering.

## RFQ-pris er per grunnenhet (A–F-oppfølging)

`SupplierPortal.tsx` ber om «Pris pr {baseUnit} (NOK)». `ForhandlingDetail.tsx` sender nå
`agreed_price_unit: rmBaseUnit(it.raw_material_id)` i stedet for `null`, slik at prisen ikke
deles på pakningsstørrelsen en gang til. Tester i
`supabase/functions/apply-negotiation-outcome/validate_test.ts`: 100 kr/kg med 25 kg pakning
= 100 kr/kg, og 0,10 kr/g = 100 kr/kg.

## Verifisering (exit-koder)
- `npm run typecheck` (tsc) — exit 0
- `npx vitest run` — exit 0, 43 filer / 400 tester (var 42 / 396)
- Deno-tester (reconcile-invoice, apply-negotiation-outcome, validate-rfq-access) — exit 0, 19 tester
- `npm run build` — exit 0
- `npx eslint` på berørte filer — exit 0 (forhåndseksisterende `any` i `ForhandlingDetail.tsx`
  og `RecipePartCard.tsx` er ikke rørt)

## Presisering av testdekning i innlogget app
Testet innlogget via brukerens Chrome/Lovable-iframe: 373 aktive varer, 21/327 matråvarer med
full næring, 2121 matvarer, søk «331-7», og retur fra råvarekort bevarer filter i mobilvisning
(393 px). Ingen levende DB-definisjoner og ingen backend-deploy er verifisert herfra.

## Restarbeid — manuell datakvalitet (ikke rettet automatisk)
- «ANANAS FINSKÅRET I JUICE 227G» er koblet til «Ananas, hermetisk, med sukkerlake» i
  Matvaretabellen. Feil variant (juice vs. sukkerlake) — krever manuell gjennomgang.
- Databladoppdateringen er fortsatt ikke transaksjonell (krever databaseendring).
- Flere kjøpshendelser per råvare på samme faktura krever F2.

## Etterkontroll av 2f9d885b — to regressjoner

### 1. Vellykket lagring sto igjen som «endret» (bekreftet, rettet)
`useNutritionDraft` sammenlignet HELE serverraden med `JSON.stringify`, inkludert
`updated_at`, `verified_at` og `source`. Ved lagring sender `NutritionTab`
`source: sourceOnSave` (Matvaretabellen → «manuell»), så serversvaret avvek alltid
fra utkastet: `userEdited` ble sann, baseline flyttet til den nye raden UTEN å
oppdatere utkastet, og skjemaet ble stående «ulagret» med falsk lagrevakt.

Rettet i `src/ravarer/hooks/useNutritionDraft.ts`:
- `EDITABLE_NUTRITION_FIELDS` + `sameEditableNutrition` — «endret» måles bare på
  feltene brukeren fyller ut. Servermetadata alene endrer ingenting.
- `markSaved(saved, sentDraft)`: eksplisitt bekreftelse av den lagrede serverraden.
  Felt der utkastet har endret seg SIDEN lagringen startet beholdes (fortsatt
  dirty), resten tas fra serverraden. Gjelder bare hvis råvaren ikke er byttet.
- `superseded`: et forsinket/utdatert spørringssvar med de gamle verdiene ruller
  ikke lagringen tilbake.
- `src`-referansen hindrer at en ny tom rad settes på hver render (uendelig løkke).
- `NutritionTab.save()` kaller `markSaved` i `onSuccess`; `useUpsertNutrition`
  returnerer nå en typet `NutritionRow`.

Tester (`src/ravarer/hooks/__tests__/useNutritionDraft.test.ts`, 4 nye):
Matvaretabellen→manuell ved tallendring + nytt `updated_at` blir ren etter lagring
(også etter refetch); redigering under pågående lagring forblir dirty og bevares;
bytte av råvare under lagring hydrerer ikke den gamle raden; servermetadata alene
er ikke en brukerendring.

### 2. Databladets pakningsforslag kunne bli 500 kg (bekreftet, rettet)
Pakningsrettingen i 2f9d885b dekket bare `Pakninger.tsx`. `DatasheetSection` sendte
`ext.package_size_value`/`package_size_unit` rått videre, og `SetPackageDialog` gjorde
`setUnits(String(suggestion.size))` — der feltet er ANTALL GRUNNENHETER. 500 g fra et
datablad ble forhåndsutfylt som 500 kg. I tillegg ble innholdsenheten («g») satt inn i
pakningsnedtrekket, som bare har emballasjetyper.

Rettet med én kontrakt i `src/ravarer/lib/packageMath.ts`:
- `PackageFillSuggestion { size, contentUnit, count?, packageType? }` — innholdsenhet
  og emballasjetype er eksplisitt adskilt.
- `resolvePackageFill(suggestion, baseUnit)` → `converted` (omregnet via `toBaseFactor`,
  med forklarende tekst «500 g = 0,5 kg»), `unconvertible` (forslaget vises, feltet
  fylles IKKE ut, ingen godkjent faktor) eller `none`.
- `SetPackageDialog` bruker funksjonen, fyller pakningsnedtrekket kun fra `packageType`
  når den finnes i `PACKAGE_UNIT_OPTIONS`, og viser omregningen/advarselen ved feltet.
- `DatasheetSection` og `Pakninger.tsx` sender begge forslaget i innholdsenhet;
  Pakninger regner ikke lenger om to ganger.
- Forhåndsvisning, eksplisitt bekreftelse og angre er uendret — dialogen skriver
  fortsatt bare via RPC-ene, aldri automatisk.

Tester (`src/test/packageMath.test.ts`, 7 nye): 500 g → 0,5 på kg-vare, 500 ml → 0,5 på
l-vare, 6 × 500 g → 3, ukjent enhet og masse-mot-volum gir ingen forhåndsgodkjent faktor,
manglende størrelse fyller ingenting, uten forslag skjer ingenting.

### Opprydding
`AlertCircle`-importen og et `no-unused-expressions`-uttrykk i `DatasheetSection.tsx` er
fjernet. De 7 gjenværende `any`-feilene i samme fil er i databladets ekstraksjonsobjekt
og er ikke rørt (utenfor denne runden).

### Verifisering (faktiske statuskoder)
- `npm run typecheck` (tsc) — exit 0
- `npx vitest run` — exit 0, 43 filer / **411 tester** (var 400; 11 nye)
- `npm run build` — exit 0
- `npx eslint` på berørte filer — exit 0 unntatt de 7 forhåndseksisterende `any`-feilene
  i `DatasheetSection.tsx`

Fortsatt ikke verifisert: levende database, edge-utrulling. Databladoppdateringen er
fortsatt ikke transaksjonell.
