# Steg 1 — Kartlegging (rapport, ingen endringer)

## 1. Aktivt selskap i Shell

- **Provider:** `src/providers/SelectionProvider.tsx`
- **Hook:** `useSelection()` → returnerer `{ legalEntityId: string | null, outletId, setLegalEntityId, setOutletId }`. Persistert i `localStorage` under nøkkelen `nbhub.selection`.
- **UI som setter den:** `src/components/layout/CompanySelector.tsx` og `src/components/layout/CompanyBlock.tsx` (begge kaller `setLegalEntityId`).
- Ingen "loading"-state — `legalEntityId` er enten en UUID eller `null`.

## 2. Rotårsak

Begge app-modulene har sin egen kontekst som **hardkoder** NB:

- `src/varer/context/AppContext.tsx` — bruker ikke `useSelection()` i det hele tatt. Alle queries i `/varer` importerer konstanten direkte:
  ```ts
  import { NB_LEGAL_ENTITY_ID } from "@/varer/lib/constants";
  ```
- `src/ravarer/context/RavarerContext.tsx` — eksponerer `legalEntityId`, men setter det til `NB_LEGAL_ENTITY_ID` (linje 58). Hookene under `/ravarer` bruker `useRavarer().legalEntityId`, som derfor alltid er NB selv om selskapsvelgeren byttes.

Resultat: platform-admins ser NB sine rader uansett valg, fordi RLS slipper dem gjennom og frontend filtrerer på en konstant.

## 3. /varer — alle steder som må scopes

Alle treff er på `NB_LEGAL_ENTITY_ID`. SELECT-er (must bli `.eq('legal_entity_id', activeLegalEntityId)` + `enabled: !!activeLegalEntityId`):

| Fil | Linjer | Tabell(er) |
|---|---|---|
| `src/varer/pages/ProductList.tsx` | 49,56 / 117,122 | products, price_lists |
| `src/varer/pages/ProductDetail.tsx` | 100–110 | product_main_categories, product_sub_categories, product_pages, sales_groups, production_groups, legal_entities, products, production_departments |
| `src/varer/pages/PriceLists.tsx` | 210–339 | price_lists, products, product_main_categories, product_sub_categories, price_list_items, special_prices |
| `src/varer/pages/PriceListDetail.tsx` | 49,54 | products |
| `src/varer/pages/Recipes.tsx` | 20,21 | recipes (via products!inner.legal_entity_id) |
| `src/varer/pages/SpecialPrices.tsx` | (ikke vist over — sjekkes) | special_prices m.fl. |
| `src/varer/pages/cakebuilder/NewCategoryDialog.tsx` | 58,106,… | cake_categories |
| `src/varer/pages/cakebuilder/CakeBuilderList.tsx` | (treff på `NB_LEGAL_ENTITY_ID`) | cake_categories |
| `src/varer/pages/cakebuilder/CakeBuilderDetail.tsx` | (treff) | cake_steps/options |
| `src/varer/pages/cakebuilder/CakeBuilderPreview.tsx` | (treff) | cake_categories |
| `src/varer/components/products/RawMaterialAutocomplete.tsx` | 67,72 | raw_materials |
| `src/varer/components/products/QuickCreateProductDialog.tsx` | 67,72 | product_main_categories |
| `src/varer/components/products/RecipeProductLinks.tsx` | 51,56 | products |
| `src/varer/components/products/detail/CakeBuilderSection.tsx` | 59,65 | cake_categories |
| `src/varer/components/products/detail/tabs/ReturOverridesTable.tsx` | 48 | products/return_overrides |
| `src/varer/components/products/detail/tabs/NavnOgNummerTab.tsx` | 46 | RPC-kall (`p_legal_entity_id`) |
| `src/varer/components/prices/SpecialPriceDialog.tsx` | 215, 270 | special_prices |
| `src/varer/components/prices/OfferPriceListsDialog.tsx` | 56,62, 197 | price_lists, special_price_list_offers |
| `src/varer/components/prices/ReturView.tsx` | 22,29 / 39,44 / 53 | products, price_lists, price_list_items |
| `src/varer/components/stamdata/StamdataPage.tsx` | 136,141, 151, 183,191, 278 | dynamisk (alle stamdata-tabeller) |
| `src/varer/lib/audit.ts` | 90 | audit_log INSERT |
| `src/varer/context/AppContext.tsx` | 87 | brukes kun til `hasPositionInNb` (skal beholdes) |

INSERT/UPDATE-er som setter `legal_entity_id: NB_LEGAL_ENTITY_ID` i dag:

- `StamdataPage.tsx:278` (insert stamdata-rad)
- `RawMaterialAutocomplete.tsx:234` (insert raw_materials)
- `QuickCreateProductDialog.tsx:104` (insert products)
- `SpecialPriceDialog.tsx:270` (insert special_prices)
- `OfferPriceListsDialog.tsx:197` (insert price_lists)
- `NewCategoryDialog.tsx:58` (storage-path) + insert cake_categories
- `audit.ts:90` (insert audit_log)
- RPC i `NavnOgNummerTab.tsx:46` (`p_legal_entity_id` arg)

Ikke kontrollert pr. linje, men må gjennomgås når vi fikser:
- `src/varer/pages/SpecialPrices.tsx`
- `src/varer/pages/RecipesCleanup.tsx`
- `src/varer/pages/cakebuilder/*`
- evt. `assortments` / `product_deviations` — finnes ikke i grep over `/varer`; sannsynligvis ikke implementert i denne modulen ennå. Rapporteres som "ikke funnet — bekreftes".

## 4. /raavarer — alle steder som må scopes

Indirekte via `useRavarer().legalEntityId`. Filer som leser/skriver:

| Fil | Bruk |
|---|---|
| `src/ravarer/hooks/useRawMaterials.ts` | SELECT/INSERT raw_materials |
| `src/ravarer/hooks/useSuppliers.ts` | SELECT/INSERT suppliers |
| `src/ravarer/hooks/useAgreements.ts` | SELECT agreements (via raw_materials!inner) |
| `src/ravarer/hooks/useNegotiations.ts` | SELECT/INSERT negotiations |
| `src/ravarer/hooks/usePurchaseStats.ts` | RPC `p_legal_entity_id` |
| `src/ravarer/hooks/useTripletex.ts` | SELECT credentials/log (param-drevet — OK) |
| `src/ravarer/components/NewSupplierDialog.tsx` | SELECT/INSERT suppliers |
| `src/ravarer/components/NewAgreementDialog.tsx` | storage-path |
| `src/ravarer/components/PurchaseStatsCard.tsx` | RPC |
| `src/ravarer/pages/DatabladBulk.tsx` | INSERT datasheets |
| `src/ravarer/pages/innstillinger/MatchToleranser.tsx` | SELECT/INSERT match_tolerances |
| `src/ravarer/pages/innstillinger/KategorierSettings.tsx` | SELECT raw_materials |
| `src/ravarer/pages/forhandlinger/ForhandlingWizard.tsx` | RPC |
| `src/ravarer/components/TripletexStatusCard.tsx` | SELECT (over flere selskap, OK) |

Fix-punkt for /raavarer er én linje: `RavarerContext.tsx:58` — ikke hardkode NB, men hente fra `useSelection()`.

## 5. Antakelser/avklaringer (svar gjerne før Steg 2)

- Embed/public flow `src/varer/pages/embed/CakeBuilderEmbed.tsx` leser `legal_entity_id` fra URL — **beholdes som i dag** (ekstern bruker, ingen Shell-context).
- `useAppContext().hasPositionInNb` (varer/AppContext.tsx) er bevisst NB-spesifikk gating (gammel pulje 1). Den bør på sikt erstattes av en sjekk mot valgt selskap, men er ikke en query-lekkasje. **Beholdes uendret i denne batchen** med mindre du vil ha den fjernet.

---

# Steg 2 — Fix-plan (etter godkjenning)

1. **Felles "active legal entity" i moduler**
   - `src/varer/context/AppContext.tsx`: les `useSelection().legalEntityId`, eksponer som `legalEntityId: string | null` på `useAppContext()`.
   - `src/ravarer/context/RavarerContext.tsx`: bytt `legalEntityId: NB_LEGAL_ENTITY_ID` → `legalEntityId: useSelection().legalEntityId ?? ""`. Endre type til `string | null` og tilpass hooks.

2. **Erstatt `NB_LEGAL_ENTITY_ID`-bruk i `/varer`** (alle filer i tabell 3) med `const { legalEntityId } = useAppContext();` og:
   - SELECT: `.eq('legal_entity_id', legalEntityId)` + `enabled: !!legalEntityId`
   - Query keys: `["…", legalEntityId, …]`
   - INSERT: `legal_entity_id: legalEntityId`, kast feil hvis `null`
   - UPDATE/DELETE: legg til `.eq('legal_entity_id', legalEntityId)` som ekstra forsvar
   - RPC-kall: send `p_legal_entity_id: legalEntityId`

3. **Tom-state UI**
   - I `ProductList`, `PriceLists`, `Recipes`, `Vareliste`, `Leverandorer`, etc.: vis "Velg et selskap" når `legalEntityId` er null/undefined i stedet for en tom tabell.

4. **Behold `NB_LEGAL_ENTITY_ID`-konstanten** kun for backwards-compat i:
   - `embed/CakeBuilderEmbed.tsx` (ikke aktuelt, leses fra URL)
   - `audit.ts` — bytt til aktivt selskap
   - `AppContext.tsx`'s `hasPositionInNb`-sjekk (beholdes inntil videre)

5. **Cache-invalidasjon** — alle `qc.invalidateQueries({ queryKey: ["…"] })` som i dag matcher per-tabell-prefix vil fortsatt fungere, men query-keys vil nå inneholde selskap så ulike selskap holdes adskilt automatisk.

# Steg 3 — Verifisering

- Bytt aktivt selskap NB → NK → MK i Shell, screenshots av `/varer` og `/varer/raavarer` (forventet 0 rader for NK/MK).
- INSERT-test i NK: opprett en råvare → SQL: `select legal_entity_id, count(*) from raw_materials group by 1;` → bekreft NK-id, og at NB-listen ikke endres.
- SQL-rapport for `products` og `raw_materials` per selskap.

## Avklaringer ønsket

- OK å endre `RavarerContext.legalEntityId` fra `string` til `string | null`? (Berører ~14 filer, men kun typer.)
- OK å fjerne hardkodet `NB_LEGAL_ENTITY_ID` fra `varer/lib/audit.ts` (audit-loggen får da valgt selskap)?
- Skal `hasPositionInNb`-gatingen i `varer/AppContext.tsx` erstattes med "har posisjon i valgt selskap"? Anbefaler ja, men ikke en del av denne batchen om du vil holde scope minimalt.
