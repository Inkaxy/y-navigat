# Plan: Varer-app — Oppskrifter, Deklarasjon, Kalkulasjon

Stor leveranse i tre steg. Jeg ber om godkjenning før jeg starter, og stopper mellom hvert steg slik at du kan teste.

## Forutsetninger jeg verifiserer først (diagnostikk, ingen kodeendringer)

Før migrering kjører jeg lese-spørringer mot DB for å bekrefte/justere planen:
- Faktisk skjema for `recipes`, `recipe_lines` (kolonnenavn for fritekst, mengde, enhet, utbytte, svinn).
- Om `raw_materials` har `unit_weight_grams`, `base_unit`, `current_cost_price`, `price_updated_at`.
- Om `raw_material_nutrition` / `raw_material_allergens` finnes med forventede felt.
- Om `legal_entities`-tabellen heter det.
- Eksisterende versjoneringslogikk på `recipes` (trigger eller app-logikk).
- Om `pg_trgm` extension er aktivert (for fuzzy-match ved migrering).

Hvis noe avviker fra spec'en (f.eks. andre kolonnenavn), justerer jeg SQL og UI-koblinger før Steg 1.

---

## Steg 1 — Datamodell + migrering

### Migrasjoner (én samlet fil)
1. `recipe_parts`-tabell (recipe_id, name, sort_order, instructions, prep_time_minutes, rest_time_minutes).
2. `recipe_lines`: nye kolonner `recipe_part_id`, `include_in_declaration` (default true), `is_quid_relevant` (default false), `custom_declaration_text`.
3. `recipes`: nye kolonner `requires_cleanup`, `bulk_proof_minutes`, `shape_proof_minutes`, `bake_temp_celsius`, `bake_time_minutes`, `steam_seconds`, `cooling_minutes`, `production_notes`, `declaration_mode` (enum), `manual_ingredient_declaration`, `manual_nutrition` jsonb, `manual_allergen_summary` jsonb, `declaration_updated_at`, `declaration_updated_by`.
4. `recipe_declaration_overrides`-tabell.
5. `products`: `packaging_cost_per_unit`, `labor_cost_per_unit`, `energy_cost_per_unit`.
6. `legal_entity_margin_thresholds`-tabell, seedet pr legal_entity med default-terskler (30/50/60/5/90).
7. View `recipe_nutrition_calculated` (enhetskonvertering + næring/100g med svinn).
8. RLS på alle nye tabeller speiler eksisterende mønster i Varer-appen.

### Datamigrering (i samme migrasjon, etter DDL, før constraints)
1. Aktiver `pg_trgm` om nødvendig.
2. For hver eksisterende `recipes`-rad: opprett `recipe_parts`-rad "Hoveddel" (sort_order 0) og sett alle tilhørende `recipe_lines.recipe_part_id` til denne.
3. Fuzzy-match fritekst-ingredienser mot `raw_materials.name` (samme legal_entity, similarity ≥ 0.7 og dominant treff). Koble og logg.
4. Marker oppskrifter med gjenværende ukoblede linjer som `requires_cleanup = true`.
5. Sett `recipe_lines.recipe_part_id NOT NULL`. **`raw_material_id NOT NULL` settes IKKE i denne migrasjonen** — det skjer i en oppfølger etter at oppryddings-rapporten er kjørt manuelt (ellers blokkerer constraint hele driften). Dette presiserer jeg i koden med kommentar + TODO-migrasjon.
6. Trigger som setter `requires_cleanup = false` automatisk når alle linjer i en oppskrift har `raw_material_id`.

### Bekrefter eksplisitt
Versjonering: ingen ny `recipes`-versjon ved råvareprisendring. Kalkulasjon er live. Hvis dagens versjoneringstrigger gjør noe annet, dokumenterer jeg det i diagnostikk-svaret før Steg 2.

**STOPP — venter på din OK for å starte Steg 2.**

---

## Steg 2 — UI: Oppskrift-tab

- Erstatt fritekst-input i `RecipeEditor` med autocomplete mot `raw_materials` (filtrert på legal_entity, søker name + sku, viser kategori, kostpris, primær leverandør). "+ Opprett ny råvare" åpner Råvarer-appens `NewRawMaterialDialog` med pre-fylt navn.
- Strukturerte deler: collapsible seksjoner pr `recipe_part`, drag-and-drop (dnd-kit) på deler og linjer, inline-redigerbar tittel, ⋮-meny (rediger, slett med advarsel, opp/ned, dupliser).
- Fremgangsmåte + prep/rest-tider pr del.
- Produksjonsparametre-seksjon under alle delene.
- Total tid-beregning vist øverst (Aktiv / Hvile/heving).
- Default: skjul del-header når kun én del finnes.
- Ny rute `/varer/oppskrifter/krever-opprydding` med KPI-kort + tabell + "Rydd opp"-knapp som dyplinker til oppskrift-detalj.
- Sidebar i Varer: lenke til oppryddings-rapport under Oppskrifter (med count-badge).

**STOPP — venter på din OK for å starte Steg 3.**

---

## Steg 3 — Tabs Deklarasjon + Kalkulasjon

### Backend
- Edge function `compute-recipe-declaration`: leser `recipe_nutrition_calculated`, bygger ingrediensdeklarasjon på tvers av deler (QUID-sortert i gram desc, allergener i `<strong>`, prosent for QUID-relevante), aggregerer allergen-sammendrag (contains / may_contain), returnerer datakvalitet og warnings. Respekterer `declaration_mode` og overrides.
- Auto-foreslå `is_quid_relevant` når råvarens navn er ord i produktnavnet (case-insensitive, ord-grense).

### Deklarasjon-tab (ny i venstre meny på vare-detaljside, mellom Oppskrift og Priser)
- Modus-velger (3 kort) med bekreftelse ved tap av manuelle data.
- Datakvalitets-banner med dyplenker til råvare for å fylle inn manglende næring/allergen.
- Under-tabs:
  - **A. Næring/100g**: norsk standardrekkefølge, lås-ikon pr rad i `auto_with_overrides`.
  - **B. Ingrediensdeklarasjon**: preview-boks (HTML med `<strong>`) + redigerbar tabell (Mengde / Råvare / Inkluder / QUID / Tilpasset tekst).
  - **C. Allergener**: auto-aggregert "Inneholder" + "Kan inneholde spor av", manuelt redigerbar i manual-modus.
- "Forhåndsvis etikett"-modal med Skriv ut / Kopier tekst / Last ned PDF (jsPDF) / Lukk.

### Kalkulasjon-tab (ny, mellom Deklarasjon og Priser)
- 5 KPI-kort (Råvarekostnad/enhet, /100g, Salgspris, DB, DG fargekodet via terskler fra `legal_entity_margin_thresholds`).
- Margin-varsler (negativt DB, DG under terskel, fall > N pp på 90 dager via prishistorikk, utdaterte priser).
- Kostnadsbreakdown-tabell sortbar på % av total, med fargekodet pris-alder.
- Hva-om-kalkulator (sliders for råvarepris og salgspris).
- Marginhistorikk: Recharts line chart 12 mnd, terskel-linjer, markører på prisendringer > 1 pp impact.
- Tilleggskostnader-seksjon (emballasje/arbeid/energi) som oppdaterer "Total kostnad" og "DG inkl. tilleggskostnader".
- Margin-terskler redigerbar i Varer-innstillinger pr legal_entity.

---

## Tekniske detaljer
- Alle nye tabeller får RLS som speiler eksisterende `recipes`/`products`-policyer (skrivetilgang via Varer-appens access-rolle på riktig legal_entity).
- Edge function bruker service role internt, validerer JWT + tilgang i kode. CORS via standard `corsHeaders`.
- Frontend: kun semantic tokens, ingen hardkodede farger. Inter-typografi, eksisterende kortstil.
- `react-query` invalidates ved alle mutasjoner. `dnd-kit` for drag-and-drop (allerede i prosjektet ellers vi legger den til).
- Ingen endringer i Råvarer-appens UI utover at `NewRawMaterialDialog` må kunne åpnes fra Varer med pre-fylt navn + callback.

## Hva som IKKE bygges (per spec)
PDF/ZPL-etikett som ekte print, rollback-versjonering, halvfabrikat-råvarer, tetthet pr råvare, produksjonsplanlegging.

## Rekkefølge
1. Diagnostikk (read-queries) → juster SQL.
2. Migrasjon (Steg 1) → STOPP.
3. UI Oppskrift (Steg 2) → STOPP.
4. Deklarasjon + Kalkulasjon (Steg 3) → ferdig.

Si fra om du godkjenner, eller om du vil at noe (f.eks. `raw_material_id NOT NULL` umiddelbart, eller annen rekkefølge) endres.