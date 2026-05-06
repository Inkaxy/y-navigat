## Steg 6 — Deklarasjon og næring pr produkt

Mål: deklarasjon, allergener og næring beregnes pr **produkt-kobling** (master + dette produktets `extra_lines`), ikke pr master-oppskrift. Manuelle overstyringer flyttes fra master til kobling med arv som fallback.

### 1. Migrasjon — flytt deklarasjon fra `recipes` til `product_recipe_links`

Behold feltene på `recipes` som default (arv), legg til overstyringer på koblingen.

```sql
alter table product_recipe_links
  add column declaration_mode declaration_mode,           -- null = arv fra recipes
  add column manual_ingredient_declaration text,
  add column manual_nutrition jsonb,
  add column manual_allergen_summary jsonb,
  add column declaration_updated_at timestamptz,
  add column declaration_updated_by uuid references auth.users(id);
```

Refaktorer overrides-tabell til å peke på koblingen:

```sql
alter table recipe_declaration_overrides
  rename to product_declaration_overrides;
alter table product_declaration_overrides
  add column product_recipe_link_id uuid references product_recipe_links(id) on delete cascade;

-- Migrer: ta første link pr recipe (kun én link i dag etter Steg 1-migrering)
update product_declaration_overrides pdo
set product_recipe_link_id = (select id from product_recipe_links where recipe_id = pdo.recipe_id limit 1);

alter table product_declaration_overrides
  alter column product_recipe_link_id set not null,
  drop column recipe_id;
```

RLS: speil eksisterende policies på koblings-id (les/skrive hvis bruker har tilgang til produktet).

Dataflytting fra `recipes` til primær link (kun der `recipes.declaration_mode != 'auto'` eller manuelle felter er fylt):
```sql
update product_recipe_links prl
set declaration_mode = r.declaration_mode,
    manual_ingredient_declaration = r.manual_ingredient_declaration,
    manual_nutrition = r.manual_nutrition,
    manual_allergen_summary = r.manual_allergen_summary,
    declaration_updated_at = r.declaration_updated_at
from recipes r
where r.id = prl.recipe_id
  and prl.is_primary = true
  and (r.declaration_mode <> 'auto' or r.manual_ingredient_declaration is not null);
```
(Felter på `recipes` beholdes som default for nye koblinger.)

### 2. Nytt view `product_nutrition_calculated`

Erstatter `recipe_nutrition_calculated`. Slår sammen `recipe_lines` (master) + `product_recipe_links.extra_lines` (jsonb-array), konverterer mengder til gram, vekter næring pr 100 g, og bruker `prl.yield_weight_g` med fallback til `recipes.yield_weight_g` og deretter beregnet (`total_input_grams * (1 - yield_loss_pct/100)`).

Output-kolonner: `product_recipe_link_id`, `product_id`, `ingredient_count`, `ingredients_with_nutrition`, `total_input_grams`, `final_weight_grams`, og `*_per_100g` for alle 9 næringsfelter (samme presisjon som dagens view).

### 3. Edge function — omdøp og omskriv

`compute-recipe-declaration` → `compute-product-declaration`.

Input: `{ product_recipe_link_id: uuid }` (frontend slår opp via primær link for produktet — kan også støtte `product_id` som convenience).

Logikk:
1. Hent link + master-recipe + produkt.
2. Aktiv modus = `link.declaration_mode ?? recipe.declaration_mode`.
3. Bygg samlet linje-liste = `recipe_lines` ∪ `link.extra_lines` (hver linje merket `source: "master" | "extra"`).
4. Beregn gram pr linje (samme `toGrams` som i dag, men også for extra-linjer).
5. Sortér samlet desc på effektive gram → ingrediensliste (én QUID-rangering på tvers).
6. Allergen-aggregering på tvers av master + extra (`contains` / `may_contain`).
7. Næring hentes fra nytt `product_nutrition_calculated` for `final_weight_grams` og `*_per_100g`.
8. Manuell overstyring: `link.manual_*` vinner; ellers `product_declaration_overrides` pr felt.
9. `data_quality` skiller `master_lines_without_nutrition` vs `extra_lines_without_nutrition`, og varsler om manglende `yield_weight_g`.

Response inkluderer `product_name` (fra produkt, ikke recipe), `source_breakdown` pr linje for UI-visning.

Beholder gammel `compute-recipe-declaration` som tynn proxy som slår opp primær link og kaller den nye, så ingenting brekker akutt. Slettes når UI er flyttet.

### 4. UI — `DeclarationTab.tsx`

Endre fra recipe-basert til link-basert oppslag:
- Hent `product_recipe_links` (primær) for `productId` i stedet for `recipes`.
- Modus-velger viser "Arvet fra master (auto)" som default-valg + mulighet til å overstyre pr produkt. Visuelt chip: "Overstyrt pr produkt" når `link.declaration_mode` er satt.
- Manuelle felter (ingrediens-tekst, næringstall, allergen-summary) lagres på `product_recipe_links`.
- Edge-call bruker `product_recipe_link_id`.
- Datakvalitets-banner viser separate tellere: master-mangler vs extra-mangler, og advarer hvis hverken kobling eller master har `yield_weight_g`.
- Etikett-forhåndsvisning bruker `productName` (allerede prop).
- Visuell merking: extra-linjer i ingrediensliste-preview får liten "+" badge så bruker ser hva som kommer fra tillegg.

### 5. UI — "Brukes av"-banner på master-oppskrift

`RecipeProductLinks.tsx` finnes allerede med chips. Utvid med:
- For hvert produkt: vis kort sammendrag av tillegg (`extra_lines.length` → "+ 2 tillegg") og lenke til produktets Deklarasjon-tab (`/varer/vareliste/:id?tab=deklarasjon`).
- Info-tekst: "Endringer i denne oppskriften påvirker alle N produktene."

### 6. Opprydning

- Frontend slutter å lese `recipes.declaration_mode` etc. — feltene blir default-arve.
- Etter at all UI er flyttet og verifisert: slett gammel `compute-recipe-declaration` (egen oppfølging).

### Definition of done

- Deklarasjon/næring pr `product_recipe_link_id`.
- `extra_lines` påvirker både næring, ingrediensliste og allergener.
- QUID rangerer master + extra samlet.
- Modus-velger støtter arv eller overstyring pr produkt; manuelle verdier vinner over master.
- "Brukes av"-banner lenker til hvert produkts deklarasjon.
- Datakvalitets-banner skiller master vs extra og varsler ved manglende `yield_weight_g`.
- Eksisterende `recipe_declaration_overrides`-rader er migrert til `product_declaration_overrides` med korrekt `product_recipe_link_id`.

### Ikke i scope nå

- Ekte versjonshistorikk pr deklarasjon.
- Sletting av default-feltene på `recipes` (beholdes som arv).
- Bulk-redigering av deklarasjon på tvers av flere produkter samtidig.
