# Kartlegging: allergener, deklarasjoner, grovhet og bilder i NBHub

Kun diagnose. Ingen kodeendringer, migrasjoner eller RLS-endringer er gjort.

## 1) Tabeller (public) — produkt/deklarasjon/allergen/næring/grovhet/bilde

Radtall er `pg_stat_user_tables.n_live_tup` (estimat).

| Tabell | Rader | Rolle |
|---|---|---|
| `products` | 697 | Hovedtabell for varer + effektiv deklarasjon (snapshot) |
| `recipes` | 350 | Oppskrifter, deklarasjonsmodus + manuelle felt |
| `product_recipe_links` | 5 | Kobling produkt↔oppskrift, kan overstyre modus/manuelle felt |
| `recipe_label_calculated` | 11 | Beregnet merkefasit pr oppskrift (deklarasjon, næring, allergener, grovhet, nøkkelhull) |
| `product_declaration_overrides` | 0 | Feltvise overstyringer for `auto_with_overrides` |
| `product_nutrition_calculated` | VIEW | Beregnet næring pr produkt (kan ikke skrives til) |
| `recipe_nutrition_calculated` | VIEW | Beregnet næring pr oppskrift |
| `recipe_grain_score` | VIEW | Grovhet pr produkt/oppskrift-kobling |
| `recipe_lines` | 2457 | Ingredienslinjer (QUID, deklarasjonstekst, mel-overstyring) |
| `recipe_parts` | 406 | Deler/preferment |
| `raw_materials` | 373 | Råvarer, `declaration_name`, `grain_classification`, `cereal_type`, `is_composite` |
| `raw_material_allergens` | 15 | Allergener pr råvare (enum + presence) |
| `raw_material_nutrition` | 21 | Næring + `ingredient_declaration` + `e_numbers` pr råvare |
| `raw_material_components` | 2 | Sammensatte råvarer, med `allergens text[]` pr komponent |
| `raw_material_datasheets` | 93 | Datablad-PDF + AI-uttrekk (`ai_extracted`) |
| `matvaretabellen_foods` | 2121 | Referansenæring fra Matvaretabellen |
| `label_field_catalog` | 49 | Katalog over etikettfelt |
| `label_print_profiles` / `label_print_jobs` / `label_units` | 1 / 24 / 3 | Etikettoppsett og utskrift |
| `cake_images` / `cake_image_formats` / `cake_image_prints` | 3 / 14 / 2 | Kakebilder (spiselig print), mm-format, DPI-kvalitet |
| `pos_product_images` | 0 | POS-bilder pr produkt (tom) |

Fullstendige kolonnelister ble hentet ut; de viktigste er gjengitt under punkt 3 og 5. Si fra hvis du vil ha komplett kolonnedump pr tabell i rapportform.

Sentrale kolonner i `products` for dette formålet:
`id, legal_entity_id, display_number, code, display_name, description, product_category, unit_of_sale, pieces_per_unit, weight_per_unit_grams, status, ean_code, gtin, epd_number, internal_sku, image_url, datasheet_url, in_web_shop, keywords, manual_ingredient_declaration, manual_allergens_contains text[], manual_allergens_may_contain text[], manual_nutrition_per_100g jsonb, manual_declaration_updated_at/by, declaration_needs_review, declaration_review_reason, cert_nokkelhull, cert_norsk_100, show_breadscale, breadscale_mode, breadscale_value, breadscale_manual_value, breadscale_pct, shelf_life_chilled_days, shelf_life_frozen_days, label_mode, label_profile_id, print_declaration_labels`.

## 2) Dagens datainnhold (målt nå)

Av 697 produkter (alle `status=active`):

- ingrediensliste (`manual_ingredient_declaration`): **1**
- allergener «inneholder»: **0** · «kan inneholde»: **0**
- næring (`manual_nutrition_per_100g`): **1**
- grovhet `breadscale_value`: **1** · `breadscale_pct`: 0 · `breadscale_mode`: 697 × `manual`
- bilde (`image_url`): **35**
- identifikatorer: `code` 697, `display_number` 697, `gtin` 94, `ean_code` 0, `internal_sku` 0, `epd_number` 0
- produkter med oppskriftskobling: **5** (`product_recipe_links`)

Råvaresiden: 373 råvarer, 21 med næring, 14 med ingredienstekst, 48 med `declaration_name`, 15 allergenrader totalt (13 «contains», 1 «may_contain»).
Oppskrifter: 350 (281 `auto`, 69 `manual`), men bare **11** har beregnet merkefasit i `recipe_label_calculated`, og de eksemplene som finnes har `coverage_by_weight_pct = 0` (næringsdata mangler på råvarene).

Eksempelrader (utdrag, tre brød/kaker — kun ett produkt har faktisk deklarasjon):

1. **Herregårdsbrød** (`display_number` 22, `code` herreg_rdsbr_d_22, `cert_nokkelhull` true, `breadscale_value` 4, bilde satt, `in_web_shop` true)
   `manual_ingredient_declaration`: `<p>Vann, <strong>rug</strong> (helkorn og sammalt fin) (36 %), <strong>hvete</strong>mel, solsikkekjerner, linfrø, maltmel (<strong>bygg</strong>), brun farin, salt, gjær, tørket surdeig av <strong>rug</strong>, surhetsregulerende middel E330, fortykningsmiddel E412, melbehandlingsmiddel (E300, amylase (inneholder bærer fra <strong>hvete</strong>stivelse)).</p>`
   `manual_allergens_contains`: `[]` · `manual_allergens_may_contain`: `[]`
   `manual_nutrition_per_100g`: `{energy_kj 1044, energy_kcal 249, fat_g 6, saturated_fat_g 0.6, carbs_g 35.8, sugars_g 3.4, fiber_g 10, protein_g 7.9, salt_g 0.9}`
2. **Færderbrød** (nr 4, `gtin` 7059260000216) — ingen deklarasjon, ingen allergener, ingen næring, ingen bilde.
3. **Hvasserbrød** (nr 11, `gtin` 7059260011182) — samme: alt tomt.

Konklusjon: strukturen finnes, **innholdet gjør det i praksis ikke ennå**. Allergenfeltene på produkt er tomme for 697 av 697 produkter, også for det ene produktet som har deklarasjonstekst (allergenene ligger der bare som `<strong>`-markering i teksten).

## 3) Allergenstruktur

To parallelle nivåer:

**Råvarenivå (strukturert, normalisert):** `raw_material_allergens(raw_material_id, allergen allergen_type, presence allergen_presence)`.
- `allergen_type` (25 verdier): `gluten_wheat, gluten_rye, gluten_barley, gluten_oats, gluten_spelt, crustaceans, eggs, fish, peanuts, soybeans, milk, nuts_almond, nuts_hazelnut, nuts_walnut, nuts_cashew, nuts_pecan, nuts_brazil, nuts_pistachio, nuts_macadamia, celery, mustard, sesame, sulphites, lupin, molluscs`.
- `allergen_presence`: `contains | may_contain | free_from`.
- Altså: **korntype og nøttetype er spesifisert**, ikke bare «gluten»/«nøtter», og «inneholder» vs «spor av» er tydelig skilt. `free_from` finnes som eksplisitt verdi.
- I tillegg har `raw_material_components.allergens text[]` (fritekst-array) for sammensatte råvarer, og `raw_materials.cereal_type` / `grain_classification` for korn.

**Produkt-/oppskriftnivå (denormalisert snapshot):**
- `products.manual_allergens_contains text[]` og `manual_allergens_may_contain text[]` — skillet finnes, men verdiene er **frie tekststrenger, ikke enum**.
- `recipes.manual_allergen_summary jsonb` og `product_recipe_links.manual_allergen_summary jsonb`, formatet `{contains: [], may_contain: []}`.
- `recipe_label_calculated.allergens jsonb` med samme `{contains, may_contain}`-form, produsert av edge-funksjonene `compute-recipe-label` / `compute-product-declaration` (delt logikk i `supabase/functions/_shared/declaration-core.ts`).

**Glutenfri vs. bakt uten gluten:** finnes **ikke**. Eneste beslektede felter er `keyhole`/`cert_nokkelhull`/`label_claim_keyhole` (nøkkelhull) og `free_from` på råvarenivå. Det er ingen produktflagg for «glutenfri», «bakt uten gluten», «laget i lokale med gluten» eller tilsvarende fritt-for-påstand.

## 4) Tedebe

- **Ingen API-integrasjon.** Det finnes ingen Tedebe-edge-funksjon, ingen Tedebe-secret og ingen base-URL i prosjektet.
- Det som finnes er en **filimport**: `src/varer/lib/tedebeImport.ts` parser Tedebes F82-eksport (CSV/XLSX) med fem kolonner: `varenummer, varenavn, utsalgspris eks mva, engrospris eks mva, momskode`. Dette er kun varenummer, navn og pris — **ingen deklarasjonsfelter**.
- `integrations`-tabellen er **tom** (ingen rader), og `src/pages/admin/Integrasjoner.tsx` har kun en ikke-seedet katalogoppføring `{ type: "tedebe", name: "Tedebe", desc: "Råvarer-katalog og databladimport." }`.
- Deklarasjoner legges altså inn **manuelt** eller beregnes fra oppskrift/råvarer (AI-uttrekk fra datablad via `extract-datasheet` / `parse-declaration-pdf`). Ingen synk, ingen cron.
- De nye Tedebe-endepunktene (`ingredients, labelNote, breadScale, allergens[], traces[], nutrition[], alsoAppliesTo[]`) er dermed helt ubrukte i dag — men de mapper nesten 1:1 mot NBHub: `ingredients` → `manual_ingredient_declaration`, `allergens[]`/`traces[]` → `manual_allergens_contains`/`_may_contain`, `nutrition[]` → `manual_nutrition_per_100g`, `breadScale` → `breadscale_*`, `labelNote` har ingen mottaker i dag.

## 5) Identifikatorer på produkt

| Felt | Type | Dekning | Merknad |
|---|---|---|---|
| `id` | uuid | 697 | Intern nøkkel, brukt av alle relasjoner |
| `display_number` | bigint | 697 | **Tedebe-varenummeret** — importen matcher på dette |
| `code` | text | 697 | Slug generert fra navn (`herreg_rdsbr_d_22`) |
| `gtin` | text | 94 | Utfylt for en del brød |
| `ean_code` | text | 0 | Finnes, aldri utfylt |
| `internal_sku` | text | 0 | Tom |
| `epd_number` | text | 0 | Tom |
| `account_reference`, `statistics_group` | text | — | Regnskap/statistikk, ikke identitet |

Det finnes **ingen Susoft-produktnummer** noe sted i skjemaet. For HQ-kobling er det reelt bare to kandidater i dag: `products.id` (uuid, stabil) og `display_number` (Tedebe-nummer, den eneste menneskelesbare nøkkelen med full dekning).

## 6) Tilgang utenfra — dagens mønstre

Det finnes **ingen** lese-API for deklarasjoner/allergener i dag. Tre etablerte mønstre kan gjenbrukes:

1. **Push til Nettside NB (dagens deklarasjonsflyt utover).** DB-funksjonen `push_products_to_nettside()` (SECURITY DEFINER) bygger en JSON-payload av aktive produkter med `in_web_shop = true` og gyldig pris, og POSTer den via pg_net til `nettside_sync_settings.site_sync_url` (`https://hgmxphpmqilhhskiwvwk.supabase.co/functions/v1/sync-product-in`) med en kanalhemmelighet fra `vault.decrypted_secrets` (`nettside_channel_secret`). Payloaden inneholder allerede `declaration {ingredients, allergens_contains, allergens_may_contain}`, `nutrition`, `cert_nokkelhull`, `cert_norsk_100`, `show_breadscale`, `breadscale_value`, `ean_code`, `gtin`, `image_url`, kategorier og pris. Siste push: 2026-09-02 16:00, 9 produkter, 11 hoppet over uten pris. Status og trigger ligger i `nettside_sync_settings` / `nettside_sync_state`, og `trg_breadscale_auto_sync` / `trg_recipe_breadscale_changed` trigger resync ved endring.
2. **Pull med API-nøkkel (pakkesystem).** Edge-funksjonen `pakkesystem-export` (`verify_jwt = false`) tar `Authorization: Bearer <api-key>` mot `pakkesystem_api_keys` (nøkler utstedes av `pakkesystem-create-key`), returnerer versjonert JSON og har innebygd JSON Schema via `?schema=1`. Dette er det nærmeste mønsteret for det HQ trenger.
3. **Innkommende med delt hemmelighet.** `nettside-order-in` (`verify_jwt = false`) validerer en kanalhemmelighet.

Anbefalt mønster for HQ er nr. 2: en ny lese-endepunkt-funksjon med API-nøkkel, ikke direkte PostgREST-tilgang (RLS på `products` er entitetsbasert og gir ikke ekstern anon-lesing).

## Det største hinderet

Skjemaet er godt nok til å være fasit, men **datagrunnlaget er ikke der ennå**: 1 av 697 produkter har deklarasjon, 0 har strukturerte allergener, 35 har bilde, og den beregnede motoren har 0 % næringsdekning fordi råvarene mangler næringsdata (21 av 373). Skal NBHub være eneste fasit for HQ, må innfyllingen løses før eller samtidig med API-et — enten via de nye Tedebe-endepunktene eller ved å fullføre råvare-/oppskriftsdataene.

## Forslag til neste steg (ikke utført)

1. Tedebe-deklarasjonssynk: ny edge-funksjon som henter `ingredients, labelNote, breadScale, allergens[], traces[], nutrition[]` og matcher på `products.display_number`.
2. Normaliser produktallergener til `allergen_type`-enumet i stedet for `text[]`, og legg til et eksplisitt «glutenfri / bakt uten gluten»-felt.
3. Les-API for HQ etter `pakkesystem-export`-mønsteret, nøkkelbasert, med versjonert schema og `products.id` + `display_number` som nøkler.
