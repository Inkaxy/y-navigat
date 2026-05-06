# Omfattende oppskrift- og kalkulasjonsmodul

Behold dagens menyer og ruter (`/varer/oppskrifter`, `/varer/vareliste`, `ProductDetail`-faner). Vi bytter ut **innholdet** i Oppskrift-, Deklarasjon- og (ny) Kalkyle-fanen, og introduserer master-oppskrift som kan brukes av flere produkter.

## 1. Datamodell (migrasjon)

Ny separat oppskriftstabell — uavhengig av produkt — slik at flere produkter kan dele én oppskrift.

```text
recipes (master)
 ├─ recipe_lines           (base-ingredienser, sortert)
 ├─ recipe_labor_lines     (Produksjon/Dekorasjon/Håndtering/Transport — timer + timepris)
 └─ recipe_packaging_lines (pose/eske/etikett — antall + pris)

product_recipe_links
 ├─ product_id
 ├─ recipe_id
 ├─ yield_weight_g          (vekt på ferdig produkt — overstyrer master)
 ├─ units_per_batch         (antall enheter — overstyrer master)
 ├─ extra_lines (jsonb)     (per-produkt ekstra ingredienser, f.eks. dekor)
 ├─ extra_packaging (jsonb)
 └─ price_overrides (jsonb) (netto/engros pr produkt)
```

Eksisterende `product_recipes`-tabell migreres: hver rad blir en `recipes`-master + en `product_recipe_links`-rad. Ingen data går tapt.

Globale defaults: `legal_entity_settings.default_hourly_rate` (400 kr), `default_vat_rate` (15%), `target_db_pct` (40 %).

## 2. UI — Oppskrift-fanen (RecipeEditor v2)

Inspirert av Excel-arket, men moderne kort-basert layout:

```text
┌─────────────────────────────────────────────────────────────┐
│ [Tebriks]   Brukes av: 3 produkter ▾    [Lagre ny versjon]  │
├──────────────────────────┬──────────────────────────────────┤
│ INGREDIENSER             │ ARBEID                           │
│ # Råvare    Mengde Pris  │ Produksjon  4 t × 400 = 1600     │
│ 1 Hvetemel  30000g 5,70  │ Dekorasjon  0 t × 400 =    0     │
│ 2 Sukker    1500g 11,15  │ Håndtering  0,5 × 400 =  200     │
│ + Legg til               │ Transport   0,5 × 400 =  200     │
│                          │ Total arbeid:          2 000     │
│ Total råvare:  820,28    │                                  │
├──────────────────────────┼──────────────────────────────────┤
│ EMBALLASJE               │ NØKKELTALL (live)                │
│ Pølsepose × 1   1,00     │ Vekt:    110 g                   │
│ + Legg til               │ Enheter: 656                     │
│                          │ Kost/stk: 4,30 kr                │
│                          │ DB: 2,20  DG: 34 % ⚠            │
└──────────────────────────┴──────────────────────────────────┘
```

- Inline-redigering på alle linjer, autosave med debounce
- Drag-handle for sortering, hurtigtast `+` for ny linje
- Råvarepris hentes fra `raw_materials.current_cost_price` (live)
- Cmd/Ctrl+K åpner råvare-søk

## 3. UI — Produkt-tilknytning ("Brukes av")

På master-oppskriften: liste over koblede produkter med mulighet til å:
- Legge til/fjerne produkt
- Per produkt: overstyre `vekt`, `enheter pr batch`
- Per produkt: legge til **ekstra ingredienslinjer** (dekor, valmuefrø, etc.) og **ekstra emballasje**
- Se hvert produkts egne nøkkeltall side-om-side

I `ProductDetail` → Oppskrift-fanen vises master read-only + en "Tillegg for dette produktet"-seksjon for ekstra-linjene.

## 4. UI — Kalkyle-fanen (ny)

Erstatter dagens enklere visning. Layout speiler høyresiden av Excel-arket:

- **Salgspriser** (4 redigerbare kort): Salgspris NETTO, Pris Engros, Salgspris m/embalasje ENGROS, Salgspris m/embalasje EGNE UTSALG
- **Resultat-kolonne** per pris: Brutto fortjeneste %, DB kr, DG %, mva inn/ut
- Fargekoding: grønn ≥ target_db_pct, gul innen 5pp under, rød ellers
- **What-if slider**: råvarepris ±X %, arbeidstid ±Y % → ser umiddelbart effekt på DG
- **Sammenligning**: hvis oppskriften brukes av flere produkter, vis tabell med DG per produkt

## 5. Beregningsmotor

Ren TS-funksjon `calculateRecipeMetrics(master, link, settings)` returnerer alle tall — brukt av UI for live preview, og av en `compute-recipe-cost` edge function for batch-rekalkulering når råvarepriser endres.

Formler (matcher Excel):
- `total_raw = Σ(mengde_g/1000 × pris_kg) + Σ ekstra_linjer`
- `total_labor = Σ(timer × timepris)`
- `cost_per_unit = (total_raw + total_labor) / units_per_batch`
- `db = pris_netto − cost_per_unit − emballasje_per_stk`
- `dg = db / pris_netto`

## 6. Migrering av eksisterende data

Engangsskript i SQL-migrasjonen: hver rad i gamle `product_recipes` blir én `recipes` + én `product_recipe_links`. Navnet på master-oppskriften = produktnavnet (kan endres etterpå). Brukeren kan så slå sammen master-oppskrifter som er like via "Slå sammen oppskrift"-knapp.

## 7. Leveranse i steg

1. **Migrasjon** — nye tabeller + datamigrering + RLS
2. **Beregningsmotor + hooks** — `useRecipe`, `useProductRecipeLink`, `calculateMetrics`
3. **RecipeEditor v2** — inkl. arbeid + emballasje
4. **"Brukes av"-panel + per-produkt tillegg**
5. **Kalkyle-fane v2** — fire priser + what-if
6. **Deklarasjon** — oppdater `compute-recipe-declaration` til å lese fra ny modell (inkl. ekstra-linjer)

Hvert steg er testbart for seg. Du godkjenner steg-for-steg som før.

## Det vi IKKE bygger nå

- Versjonering med rollback (kun forward — beholdes som i dagens spec)
- Halvfabrikat-råvarer (oppskrift som blir råvare i annen oppskrift)
- Faktisk PDF-utskrift av kalkyle (kun skjerm + CSV-eksport)

---

Si fra om du vil justere noe (f.eks. felt-navn, om "ekstra-linjer" skal være egen tabell i stedet for jsonb, eller om vi skal starte med et annet steg) — ellers begynner jeg på **Steg 1: migrasjon**.