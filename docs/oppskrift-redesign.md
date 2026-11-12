# Oppskriftssiden – redesign (spesifikasjon)

Gjelder ruten `/varer/oppskrifter/:id` (`src/varer/pages/RecipeDetail.tsx` og `src/varer/components/recipes/**`).
Bestilt av Henrik 10.11.2026. Bildene `01`–`06` viser en klikkbar prototype av målbildet.

## 1. Hva som er problemet i dag

- Samme mangel vises fire steder: kostvarselet i `RecipeStatsBar`, `RecipeWarningsBanner`, «Rett dette før utskrift» og «Pliktfelt etter 1169/2011».
- Alt ligger på én lang side. Koblede varer og lønnsomhet er gjemt nederst som en liten stripe (`RecipeProductLinks`).
- Brutto og DG2 per koblet vare vises ikke på oppskriften, bare én DG2 for primærvaren i statslinjen.
- Fremgangsmåten ligger under «Prosess» og er vanskelig å finne.

## 2. Målbilde

Fem faner øverst, og et fast sidepanel til høyre som er synlig på alle faner.

| Fane | URL-verdi (`?tab=`) | Innhold |
|---|---|---|
| Oppskrift | `oppskrift` (standard) | Ingredienser i deler, registrering gram/prosent, skalering, oppskriftsinfo og vekt |
| Fremgangsmåte | `fremgangsmate` | Steg (øverst), tidslinje, deigtemperatur, notater, dekor, bilde |
| Varer og lønnsomhet | `varer` | Kostgrunnlag, koblede varer med Brutto og DG2 per prisnivå, koble til/fra |
| Merking | `merking` | Dagens merkefane |
| Historikk | `historikk` | Oppskriftsversjoner, godkjente deklarasjoner, deling |

Sidepanelet har to kort:

- **Nøkkeltall:** deigvekt, antall emner, råvarekost per kg, råvarekost per emne, selvkost per emne, selvkost per kg.
- **Gjenstår:** én samlet liste i to grupper, «Må rettes før godkjenning» og «Bør sjekkes». Hvert punkt er en knapp som bytter til riktig fane og setter fokus på feltet eller linjen. Når listen er tom vises «Alt påkrevd er på plass».

Fanene viser antall åpne punkter (rødt merke når noe sperrer, gult når det bare bør sjekkes) og en hake når fanen er ferdig.

## 3. Dette er prototype, ikke fasit

Prototypen viser struktur, innhold og oppførsel. Den er ikke en pikselmal.

- **Bruk prosjektets designsystem:** papir/navy/bronse, Fraunces/Inter, Lucide, tokens (`text-caption`, `px-page` osv.) og eksisterende komponenter (`ModulePage`, `PageHeader`, `SectionTabs`, `DataTable`, `QueryState`). Ikke kopier fargene, hex-kodene eller skriftene i bildene.
- **Eksplisitt lagring beholdes.** Bildene viser «Alle endringer lagret». Det skal ikke bygges. `Lagre oppskrift`, `StickySaveBar`, `useUnsavedChangesGuard`, kladdgjenoppretting og konfliktvarsel virker som i dag.
- **Tallene og varene i bildene er eksempeldata.**
- **Knappen «Godkjenn» i bildene** er dagens godkjenning av deklarasjon (`ApproveDeclarationDialog`, `useApproveDeclaration`). Det skal ikke lages en ny godkjenningsflyt.

## 4. Ufravikelige krav (data og kontrakter)

1. Ingen migrasjoner, ingen nye tabeller, ingen endringer i RPC-er, edge-funksjoner, RLS eller triggere.
2. Ingen data skal endres av selve ombyggingen. `product_recipe_links`, `recipe_declaration_versions`, `product_declaration_overrides`, `products.declaration_version_id`, manuelle deklarasjoner og merkevalg skal være urørt. Alle varer beholder kobling, primærflagg, arvet/overstyrt deklarasjon og godkjent versjon.
3. Skriving skjer bare gjennom dagens skriveveier: `useRecipeSave`, `useRecipeEditor`, `addLink`/`removeLink` med `afterLinkChange` i `RecipeProductLinks`, `useApproveDeclaration`, `saveClaim` i `LabelTab` og `LabelInfoCard`. Ingen nye klient-`UPDATE`.
4. Beregninger gjenbrukes: `computeRecipeCost`, `fetchBakersRawMaterials`, `useProductMargins` (RPC `product_margins`), `useRecipeLabelCalculated`, `buildLabelChecklist`, `scaleRecipe`. Ingen parallell kost- eller marginberegning i klienten. Ukjent er ikke 0: manglende grunnlag vises som ufullstendig.
5. Tilgang som i dag (`canWrite`, `useUserAccess`). Lesebrukere ser alt, men kan ikke endre.
6. Eksisterende URL-er skal fortsatt virke: `?tab=merking`, `?rename=1` og returparameteren (`listReturnHref`). Ankrene `seksjon-*` og `merking-*` brukes av `focusRecipeLine` og sjekklisten og må fortsatt føre til riktig sted, nå via fanebytte.
7. Kodestandard i prosjektkunnskapen gjelder: TypeScript strict, TanStack Query, `QueryState`, filer under 400 linjer, 44 px trykkflater, kontroll på 390/1280/1440. `RecipeDetail.tsx` er 1620 linjer og bør deles i én komponent per fane.
8. Ikke publiser.

## 5. Fase 1 – skall, sidepanel og lønnsomhet (bygges nå)

### 5.1 Faner og sidepanel
- Erstatt dagens to faner med de fem i tabellen over. Fanen leses fra og skrives til `?tab=`.
- Flytt eksisterende innhold uendret inn i riktig fane (se 5.2–5.5).
- Nytt sidepanel med «Nøkkeltall» og «Gjenstår». På smal skjerm legges panelet over faneinnholdet, og «Gjenstår» kan foldes sammen.
- «Nøkkeltall» henter tallene `RecipeStatsBar` allerede får (`displayTotals`, `cost`). Bakerfaglige tall (melvekt, hydrering, salt, gjær) blir stående på Oppskrift-fanen.
- «Gjenstår» samler:
  - varslene fra `useRecipeWarnings` (i dag `RecipeWarningsBanner`),
  - det som sperrer merkingen: `missing_data.block_reasons` og feilene fra `buildLabelChecklist`,
  - lønnsomhet: prisnivå med status `rod` og prisnivå uten pris, fra `product_margins`.
- Sperrende punkter kommer først. Punkter som bare er anbefalinger (for eksempel oppbevaring) legges under «Bør sjekkes».
- `RecipeWarningsBanner` og kostvarselet i statslinjen fjernes fra visningen når «Gjenstår» dekker dem. Ingen varsel skal forsvinne: alt som vises i dag skal finnes i «Gjenstår».

### 5.2 Fane Oppskrift
- Uendret innhold: `RecipeSection` «Ingredienser» (med `RecipePartCard`), skalering (`ScalePanel`) og «Oppskriftsinfo og vekt».

### 5.3 Fane Fremgangsmåte
- Rekkefølge: `RecipeStepsEditor` øverst, deretter `StepTimeline`, `DoughTempPanel`, «Notater», «Dekor / ferdiggjøring» og `RecipeImageUpload`.

### 5.4 Fane Varer og lønnsomhet (ny visning, bilde 03)
- **Kostgrunnlag** øverst: råvarekost per bakst og per emne, arbeid og energi slik `product_cost` returnerer dem. Bare visning i fase 1.
- **Tabell**, én rad per koblet vare:
  - Vare: navn, varenummer, salgsenhet, primærmerke og om deklarasjonen er arvet eller overstyrt (som i dag).
  - Kost per enhet: råvare, selvkost (råvare + lønn + energi) og selvkost per kg.
  - Én kolonne per prisnivå (internpris, engros, utsalg): pris eks. mva, pris per kg, Brutto % og DG2 %.
  - Målene (`target_brutto_pct`, `target_dg2_pct`) står i kolonneoverskriften eller i cellen.
  - Status fra RPC-en (`gronn`, `gul`, `rod`, `forelopig`, `ikke_vurdert`, `halvfabrikat`, `ingen_pris`) vises med tekst eller ikon i tillegg til farge.
  - Raden kan åpnes: kostoppsett, DB2 i kroner, avvik mot mål i prosentpoeng og «pris som trengs» per nivå.
- Kilopris = pris / vekt per salgsenhet. Bruk vekten som finnes på varen eller koblingen. Mangler vekten, vises «–» med forklaring, ikke 0.
- Har varen ikke kost (`has_cost = false`), vises årsakene fra `cost.notes` i raden i stedet for tall, og de tas med i «Gjenstår».
- «Koble til produkt» og «Koble fra» flyttes hit med nøyaktig samme logikk og bekreftelsesdialog som i `RecipeProductLinks`.
- Formlene er de som ligger i `product_margins`: Brutto = (pris − råvare) / pris. DG2 = (pris − råvare − lønn − energi) / pris.

### 5.5 Fane Merking og fane Historikk
- Merking: `LabelTab` uendret i fase 1.
- Historikk: versjonshistorikken med «Gjenopprett» (flyttet fra «Koblede varer og historikk»), en skrivebeskyttet liste over godkjente deklarasjonsversjoner (`useRecipeDeclarationVersions`) og inngang til `ShareRecipeDialog`.

### 5.6 Toppen
- Navn, status og «Flere handlinger» som i dag, med alle dagens valg. «Lagre oppskrift» som i dag.

## 6. Fase 2 – merking (egen bestilling, bilde 04 og 05)

- Ett kort «Deklarasjon og næringsinnhold» med bryter «Automatisk beregning». Av = manuell inntasting av ingrediensliste og næringsinnhold. Dette er dagens Beregnet/Manuell med ny presentasjon, ikke ny lagring.
- Én sjekkliste for pliktfelt i stedet for to. Felt som mangler fylles ut i raden.
- Merker som brytere med status: Brødskalaen, Nøkkelhullet og 100 % norsk/Nyt Norge. Bryteren låses når kravene ikke er oppfylt.
- Nettovekt per koblet vare med forslag fra ferdigvekten.
- Etikett med varevelger, størrelse og antall.
- Allergenkontroll i manuell modus: godkjenning sperres når et allergen fra råvarene mangler eller ikke er fremhevet i teksten. Allergener fremheves i ingredienslisten og gjentas ikke utenfor den (matinformasjonsforskriften artikkel 21). Spormerking krever begrunnelse.

## 7. Fase 3 – oppskrift (egen bestilling, bilde 01)

- Hurtigskalering over `ScalePanel`: antall ganger med pluss/minus, hurtigvalg og ønsket antall emner. Avrunding, svinn og «lagre som ny» i `ScalePanel` beholdes.
- Kolonne «Kr/kg» og «Til bakst» i ingredienslisten, datakvalitet som merkelapper på linjen.
- «Legg i prisrunde» fra lønnsomhetstabellen.

## 8. Akseptkriterier for fase 1

1. Alle funksjoner som finnes på siden i dag er fortsatt tilgjengelige, og lagring, kladd, konfliktvarsel og skalering oppfører seg som før.
2. Ingen rad i databasen er endret av ombyggingen.
3. `/varer/oppskrifter/:id?tab=merking` åpner merkefanen. Klikk i «Gjenstår» fører til riktig fane og felt.
4. For en oppskrift med flere koblede varer vises Brutto og DG2 for hver vare og hvert prisnivå, med samme tall som `product_margins` gir.
5. Varer uten kostgrunnlag viser årsaken, ikke 0.
6. Eksisterende tester er grønne. Nye rene funksjoner (sammenstilling av «Gjenstår», kilopris) har tester.
7. Kontrollert på 390, 1280 og 1440 px.

## 9. Bilder

- `01-oppskrift.png` – Oppskrift-fanen med åpnet ingredienslinje og skalering
- `02-fremgangsmate.png` – Fremgangsmåte-fanen
- `03-varer-lonnsomhet.png` – Varer og lønnsomhet med åpnet vare
- `04-merking-automatisk.png` – Merking, automatisk beregning
- `05-merking-manuell.png` – Merking, manuell inntasting
- `06-historikk.png` – Historikk

---

## Fase 2 – slik ble det bygget

Bygget på `/varer/oppskrifter/:id?tab=merking` uten databaseendringer. Godkjent deklarasjon (`recipe_declaration_versions` via `products.declaration_version_id`) er fortsatt fasit; ny versjon oppstår bare i `ApproveDeclarationDialog`.

**A. Én side.** Underfanene Deklarasjon / Datakvalitet / Etikett / Merker er fjernet. Venstre kolonne har kortene Status og neste handling → Deklarasjon og næringsinnhold → Pliktfelt på etiketten → Koblede varer → Merker. Etiketten står til høyre fra 1280 px (fast ved rulling), under kortene på smal skjerm. Ankrene `merking-*` og «Gjenstår» ruller nå direkte til kortet/feltet; snarveien venter til kortet er montert.

**B. Deklarasjon og næringsinnhold.** Bryteren «Automatisk beregning» er det gamle valget Beregnet/Manuell: den bytter bare visningen og skriver ingenting; «Lagre som gjeldende kilde» og «Godkjenn» er som før. På: beregnet tekst og næring skrivebeskyttet, og når næringen ikke kan brukes vises årsaken med «Gå til linjen som mangler data» og «Legg inn manuelt». Av: tekstfelt, allergenfelt og næring per 100 g som før, med merknad om at manuelle verdier ikke følger oppskriften. «Kopier fra beregnet» fyller bare skjemaet. Datadekning og datakvalitet ligger nederst i kortet, åpent når noe mangler.

**C. Pliktfelt.** «Rett dette før utskrift» og «Pliktfelt etter 1169/2011» er slått sammen til én liste fra `buildLabelChecklist` (samme kladdgrunnlag som forhåndsvisningen og «Gjenstår»), delt i Påkrevd og Anbefalt/frivillig. Nettovekt, holdbarhet, oppbevaring og opprinnelse redigeres i raden med samme lagring og samme vakt som det tidligere kortet «Etikettopplysninger».

**D. Koblede varer.** Som før, med «Synk alle nå» og lenke til varens deklarasjon. Hver vare viser nettovekt per salgsenhet (koblingen eller varen) og om den er bekreftet. «Sett nettovekt» åpner salgsenhetsskjemaet fra varekortet og lagrer via `conditionalLinkUpdate` (samme betingede skrivevei). Forslaget (antall × ferdigvekt, ellers deigvekt) fyller bare feltet. «Bruk forslag på alle» er ikke bygget, fordi det ville vært flere skrivinger på én gang.

**E. Merker.** Brødskala'n og Nøkkelhullet er rader med bryter (`label_claim_grain`/`label_claim_keyhole`, lagret med `saveClaim`), status, kort begrunnelse og «Vis detaljer». Låsene bruker de eksisterende vurderingene (`lib/labelClaims.ts`). 100 % norsk vises per vare, bare lesing, med lenke til varen.

**F. Allergenkontroll (art. 21).** `lib/manualAllergenCheck.ts` sammenligner manuell ingrediensliste med beregnede allergener. Fremheving er `*stjerner*`, `<strong>`/`<b>` eller VERSALER. Manglende eller ufremhevet allergen er feil (vises i kortet, i «Gjenstår» og blant sperrene for manuell kilde). Treff bare via synonym eller delvis fremheving er «Bør sjekkes». Spormerking har veiledning om risikovurdering.

**G. Etiketten.** Forhåndsvisning, «Sist godkjente»/«Ny beregning», etikettprofil og utskrift er uendret. Utskriftsknappen viser «(N gjenstår)», og «N gjenstår — vis sjekklisten» fører til pliktfeltene. Varevelger og antall er ikke bygget: etikettkoden har bare størrelsesvalg.

**Åpne punkter som krever databaseendring:** lagret begrunnelse for spormerking (nytt felt). 100 % norsk fra oppskriftssiden (i dag skrives feltet bare sammen med andre sertifiseringer på varen).

**Funn:** Den trykte etiketten har ingen «Inneholder»-linje. Skjermvisningen viser «Inneholder:» bare når ingredienslisten mangler. Den eksisterende sjekken `allergenIsHighlighted` i `labelChecklist.ts` godtar et allergen som står i teksten selv uten fremheving. Den er ikke endret, men den manuelle kontrollen over fanger dette for manuell kilde.

Syntetisk forhåndsvisning: `/forhandsvisning/merking` (`?modus=manuell`).
