## Steg 7 — Sammensatte råvarer (strukturert) + Brødskala'n

To sammenhengende endringer som begge berører råvare-modellen og `compute-product-declaration`. Bygges som én pulje med felles migrasjon, ny edge-logikk og UI på både råvare-detalj og produkt-deklarasjon.

---

### Del A — Strukturerte sammensatte råvarer

**Mål:** erstatt fritekst-deklarasjon på sammensatte råvarer med komponent-rader, slik at dekomponering, allergener og QUID-aggregering blir korrekt etter Forordning 1169/2011.

#### A.1 Datamodell

```sql
alter table raw_materials
  add column is_composite boolean not null default false,
  add column components_reviewed_at timestamptz;

create table raw_material_components (
  id uuid primary key default gen_random_uuid(),
  parent_raw_material_id uuid not null references raw_materials(id) on delete cascade,
  component_raw_material_id uuid references raw_materials(id) on delete restrict,
  primary_ingredient_name text,
  percentage numeric not null check (percentage > 0 and percentage <= 100),
  is_explicit_percentage boolean not null default true,
  sort_order int not null default 0,
  allergens allergen_type[],          -- bare brukt når fritekst (ikke koblet)
  is_quid_relevant boolean not null default false,
  created_at timestamptz default now(),
  check (
    (component_raw_material_id is not null and primary_ingredient_name is null) or
    (component_raw_material_id is null and primary_ingredient_name is not null)
  )
);
create index on raw_material_components (parent_raw_material_id, sort_order);
```

RLS speiles fra `raw_materials` (lese: alle med varer-tilgang, skrive: write/approve/admin).

#### A.2 AI-migrering av eksisterende fritekst

- Ny edge-funksjon `parse-composite-ingredient` (Lovable AI Gateway, `google/gemini-3-flash-preview`, structured tool-calling) som tar `{ raw_material_id }`, leser `raw_material_nutrition.ingredient_declaration`, returnerer komponent-array `{ name, percentage|null, is_explicit }`.
- Ny side `/varer/innstillinger/sammensatte-ravarer` med "Migrer fra fritekst"-knapp:
  - lister kandidater (rader med `ingredient_declaration` ikke-tom og `is_composite=false`),
  - kjører AI på valgt rad (eller batch),
  - lagrer som `raw_material_components` med `primary_ingredient_name`, setter `is_composite=true`, lar `components_reviewed_at` være null → vises med 🟡 review-banner.
- Implisitt prosent-fordeling: hvis bare noen er gitt, fyll resten i synkende rekkefølge slik at sum = 100, marker `is_explicit_percentage=false`.

#### A.3 UI på råvare-detalj (NutritionTab)

- Toggle "Sammensatt råvare" (`is_composite`).
- Når på: vis seksjon med drag-and-drop-liste over komponenter:
  - Rad: `☰ navn — XX %`. Klikk åpner dialog: type (eksisterende råvare via autocomplete / fritekst), prosent, allergener (bare for fritekst), `is_quid_relevant`.
  - Sum-status nederst: ✓ 100 %, ⚠ 50–89 % (info: "vann/luft kan utgjøre resten"), ❌ < 50 % eller > 100 %.
  - Auto-sortering desc; manuell overstyring tillatt med advarsel.
- Hvis `components_reviewed_at IS NULL` og rader finnes → 🟡 banner: "AI har foreslått komponenter. Verifiser før bruk." Knapp "Marker som gjennomgått" setter timestamp.
- Når av: skjul listen; behold rader (slettes ikke).

#### A.4 Endringer i `compute-product-declaration`

Bygg om linje-aggregering:

1. For hver `recipe_line`/`extra_line`:
   - hvis råvare ikke `is_composite` → behold linja som før.
   - hvis `is_composite` → hent komponenter (rekursivt, maks 3 nivåer for å hindre loops), splitt mengden etter prosent: `child_grams = parent_grams * pct / 100`.
2. Etter rekursiv flate-utbretting: aggregér på nøkkel
   - `component_raw_material_id` hvis satt,
   - ellers normalisert `primary_ingredient_name` (lowercase, trim, fjern parentes-suffix).
   - Summér `effective_grams`, samle kilde-referanser (for tooltip), behold `is_quid_relevant` hvis satt på en av kildene.
3. Allergener: fra koblet råvare hvis komponent har `component_raw_material_id`, ellers fra `allergens`-array på komponenten. Master-linja sin egen allergen-liste brukes IKKE for `is_composite`-råvarer (komponentene tar over).
4. Sortér aggregert liste desc → ny QUID-rangering.
5. Render-regel: hvis EN sammensatt råvare ikke er aggregert sammen med noen andre, skriv `parent (k1, k2, …)`. Hvis komponenter er slått sammen på tvers av flere parents, skriv komponentene flatt (uten parent-wrapper). Beslutningen tas pr komponent: hvis komponentens kilder kommer fra én og samme parent → wrap-form; ellers flat.
6. Næring pr 100 g uendret prinsipp, men nå basert på dekomponerte linjer (komponentens råvare brukes når koblet; fritekst-komponenter teller ikke i næring-dekning og vises i datakvalitets-banner).

Datakvalitet utvides med:
- `composite_lines_unreviewed` (parent uten `components_reviewed_at`)
- `composite_lines_text_only` (komponenter uten råvare-kobling — påvirker næring + allergen-dekning).

#### A.5 Rapporter

`Vareliste` / "Ufullstendige råvarer"-rapport får:
- ny kolonne **Komponenter** (status: ikke-sammensatt / verifisert / krever review / sum ≠ 100 %),
- filter "Sammensatte uten verifiserte komponenter".

---

### Del B — Brødskala'n

#### B.1 Datamodell

```sql
alter table raw_materials
  add column grain_classification text;          -- enum-liknende, validert app-side
alter table products
  add column show_breadscale boolean default null;   -- null = arv fra legal_entity-default
alter table legal_entities
  add column breadscale_default_enabled boolean not null default false;

create table recipe_grain_score (
  product_recipe_link_id uuid primary key references product_recipe_links(id) on delete cascade,
  total_flour_grams numeric,
  coarse_grams_weighted numeric,
  grain_score_pct numeric,
  category text,                  -- 'fint' | 'halvgrovt' | 'grovt' | 'ekstra_grovt'
  classification_complete boolean,
  unclassified_count int default 0,
  unclassified_names text[],
  computed_at timestamptz default now()
);
```

Tillatte verdier for `grain_classification` (CHECK-constraint):
`sifted_flour, whole_grain_flour, whole_grains, wheat_bran, rye_bran, oat_bran, gluten_free_grain, other_flour, not_grain`.

#### B.2 Beregningslogikk (i `compute-product-declaration`)

Etter dekomponering (Del A) — bruk de samme flate linjene:

```text
for hver linje:
  c = klassifisering
  if c in (sifted_flour, other_flour): total += g
  elif c in (whole_grain_flour, whole_grains, gluten_free_grain): total += g; coarse += g
  elif c == wheat_bran: coarse += g * 4.5
  elif c == rye_bran:   coarse += g * 4.0
  elif c == oat_bran:   coarse += g * 2.0
  else: skip (not_grain / null)

pct = coarse / total * 100
kategori:
  0–25.9    -> fint
  26–50.9   -> halvgrovt
  51–75.9   -> grovt
  76+       -> ekstra_grovt
```

Edge-funksjonen returnerer `breadscale: { pct, category, total_flour_grams, coarse_grams_weighted, contributors[], unclassified[] }` og oppserter `recipe_grain_score` med service-rolle.

#### B.3 UI

**Råvare-detalj (NutritionTab):** dropdown "Brødskala-klassifisering" med 9 verdier + "ikke valgt". Synlig alltid (uten kategori-filter for nå — enklest), med info-tekst ved siden.

**Vare-detalj → Deklarasjon-tab:** ny seksjon "Brødskala'n":
- 4-firkant SVG (fyll ut antall firkanter etter kategori), kategori-tekst, prosent.
- Bidragsbrudd-tabell: per ingrediens g + faktor + vektet g.
- "⚠ N ingredienser ikke klassifisert" med inline-knapp "Klassifiser" → navigerer til råvare-detalj.
- Toggle pr produkt: "Vis Brødskala'n på etikett" (`products.show_breadscale`, fallback til `legal_entities.breadscale_default_enabled`).
- Vises kun hvis effektiv toggle = true. Default-toggle er innstilling pr legal entity (ny side `Innstillinger → Brødskala'n` med BKLF-info-tekst).
- Hvis `total_flour_grams / sum(all_grams) < 0.6`: info "Brødskala'n er sannsynligvis ikke aktuelt for dette produktet."

**Etikett-preview:** legg til linje "BRØDSKALA'N: <kategori> (<pct> %)" + 4-firkant SVG når toggle er på.

#### B.4 BKLF-info

På innstillinger-siden: forklarende tekst + lenke til BKLF om at merket krever avtale.

---

### Felles tekniske detaljer

- Alle migrasjonsendringer i én SQL-pulje: `raw_material_components`, kolonner på `raw_materials`/`products`/`legal_entities`, `recipe_grain_score`, RLS, indekser.
- `compute-product-declaration` får ny seksjon for dekomponering + grain score; gammel `compute-recipe-declaration` (proxy) endres ikke.
- Ny edge: `parse-composite-ingredient` (Lovable AI Gateway, structured output via tool calling).
- Frontend-types: regenererer `supabase/types.ts` automatisk etter migrasjon.

### Definition of done

- Sammensatte råvarer kan registreres strukturert med komponenter, prosent, allergener og review-status.
- Eksisterende fritekst-deklarasjoner kan AI-parses og verifiseres pr rad.
- Deklarasjonen aggregerer salt og andre delte komponenter på tvers av råvarer; QUID rangerer på samlet mengde.
- Allergener inkluderer komponent-allergener.
- Brødskala-klassifisering settes pr råvare, brødskala-prosent + kategori beregnes pr produkt-kobling og caches i `recipe_grain_score`.
- Deklarasjon-tab viser brødskala-merke med 4-firkant SVG, bidragsbrudd og advarsel ved ukomplette klassifiseringer.
- Etikett-preview kan inkludere brødskala.
- Datakvalitets-banner viser nye tellere for sammensatte råvarer som mangler review eller råvare-kobling.

### Ikke i scope

- Faktisk BKLF-merke-grafikk (vi rendrer enkel SVG selv).
- Bulk-klassifisering av råvarer (én og én via dropdown nå; bulk kan komme senere).
- Auto-kobling av fritekst-komponenter til eksisterende råvarer ved similarity (kun manuell kobling fra komponent-dialogen i denne puljen).
