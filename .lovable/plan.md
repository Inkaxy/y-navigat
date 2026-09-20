# Koble eksisterende oppskrift til en vare

## Hva finnes allerede
NBHub har allerede en varig kobling mellom vare og oppskrift (`product_recipe_links`), og den brukes i dag av deklarasjonsberegningen på serveren, merkedata og kostmotoren. Samme oppskrift kan allerede deles av flere varer. Det som mangler er veien inn: varekortet lar deg bare *opprette* en ny oppskrift, ikke velge en som finnes. Derfor bygger jeg videre på dagens kobling — ingen ny datamodell og ingen kopiering av oppskrifter.

## 1. Velg og koble oppskrift
- Fanen «Oppskrift» får to handlinger når varen mangler oppskrift: **Koble eksisterende oppskrift** (hovedhandling) og **Opprett oppskrift** (beholdes).
- Søkbar dialog over oppskrifter du har tilgang til i selskapet, med navn, nummer, status, utbytte og enhet der det finnes.
- Før du bekrefter: en forhåndsvisning som viser oppskriften (ingredienser, utbytte, deigvekt, kostnad) og en tydelig liste over hva koblingen vil tilføre varen — og hva som mangler grunnlag.
- Koblingen peker på originaloppskriften. Ingen kopi.

## 2. Tilpass oppskriften til varen
Koblingen får felter du selv bekrefter:
- hvordan oppskriftens utbytte svarer til varens salgsenhet (per stykk, per vekt eller flerpakning),
- antall enheter per salgsenhet (f.eks. 8 boller per pakke) og eventuell vekt per salgsenhet.

Ingenting utledes fra varenavnet. Er enhetene uavklarte eller uforenlige, stopper beregningen og sier hvorfor, i stedet for å vise et tall som ser komplett ut.

## 3. Bruk i hele varekortet
- **Oppskrift**: koblet oppskrift, ingredienser, utbytte, koblingens innstillinger, kostnad per stykk og per salgsenhet, og hva som mangler.
- **Produksjon**, **Deklarasjon**, **Kalkyle & pris**, **Pakke**, **Varedetaljer**: viser oppskriftsgrunnlaget gjennom de beregningene som allerede finnes, med tydelig merking av hva som kommer fra oppskriften, hva som er beregnet, og hva som er manuelt satt på varen.
- Koblingen endrer aldri salgspris, varenummer, navn eller andre uavhengige vareopplysninger av seg selv.

## 4. Oppdateringer, sikkerhet og logg
- «Åpne oppskrift», «Bytt oppskrift» og «Fjern kobling». Fjerning sletter aldri oppskriften.
- Kobling, bytte og fjerning logges med bruker og tidspunkt i eksisterende logg.
- Manuelt vedlikeholdte varedata og godkjente deklarasjoner overskrives ikke. Endres oppskriften etter en godkjenning, beholdes den godkjente versjonen og merkes for ny gjennomgang.
- Tilgang håndheves på serveren (dagens regler på kobling og oppskrift), underoppskrifter telles én gang, og sirkulære referanser avvises slik i dag.

## Teknisk
- Migrasjon: nye kolonner på `product_recipe_links` for salgsenhet-tilpasning (`sales_unit_basis`, `units_per_sales_unit`, `sales_unit_weight_g`, samt hvem som bekreftet og når). Ingen nye tabeller, ingen endring av eksisterende RPC-kontrakter.
- Ny delt hjelpefil som regner om oppskriftsutbytte → vare/salgsenhet, med eksplisitte «mangler grunnlag»-årsaker (ingen stille nullverdier).
- Ny dialog `LinkRecipeDialog` og utvidet `RecipeSummaryCard`; gjenbruk av `computeTotalsForRecipe`, `computeRecipeCost`, `computeUnitCount`, `compute-product-declaration` og `compute-recipe-label`.
- Tester: kobling av eksisterende oppskrift, flerpakning (8 per pakke), underoppskrift uten dobbelttelling, manglende utbytte/pris/enhet, endret oppskrift mot godkjent deklarasjon, og at manuelle data ikke overskrives. Syntetiske testdata; ingen eksisterende varekoblinger røres. Ingen publisering.
