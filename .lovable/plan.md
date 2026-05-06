# Råvaremodulen — Pulje 1: Fundament

Bygger råvareregister, næringsinnhold/deklarasjon, og leverandører + manuell prishistorikk. Faktura-import (Pulje 2) og prisinnsikt (Pulje 3) kommer senere.

## Tilpasninger til eksisterende prosjekt

- **Tenant**: Bruker `legal_entities` i stedet for `organizations`. Alle nye tabeller får `legal_entity_id`.
- **Tilgang**: Bygger på eksisterende `positions` + `position_app_access` for app-tilgang til `ravarer`. Legger til `is_owner boolean` på `positions` for konsernvisning på tvers av selskap.
- **Skrive-roller**: RLS-policyer baserer seg på at brukeren har `position_app_access` med `level in ('admin','manager','editor')` for `ravarer`-appen og er knyttet til riktig `legal_entity` via `user_positions`.
- **Suppliers**: Opprettes nytt, eid pr `legal_entity`.
- **Recipes**: Legger til nullable `raw_material_id` + `quantity_grams` på `recipe_lines` (forberedelse for Modul F i Pulje 3, ingen migrering av eksisterende rader).

## Migrasjon (én SQL-fil)

**Nye tabeller** (alle med `legal_entity_id`, RLS aktivert):
- `suppliers` — leverandørregister
- `raw_materials` — kjernen (sku, navn, kategori, base_unit, package_size/unit, current_cost_price, agreed_price, lager, primær leverandør)
- `raw_material_nutrition` — næring pr 100 g + deklarasjon, opprinnelse, e-numre, datablad-URL, verifisering
- `raw_material_allergens` (+ enums `allergen_type`, `allergen_presence`) — 24 EU-allergener × tilstand
- `raw_material_suppliers` — kobling med supplier_sku, pakning, avtalt pris, gyldighet, avtale-URL, `is_primary`, siste fakturapris
- `raw_material_supplier_aliases` (+ enums `alias_type`, `alias_status`) — for senere fakturamatching, klar nå
- `raw_material_price_history` — append-only prislogg pr leverandør med kilde

**Endringer på eksisterende:**
- `positions`: `is_owner boolean default false`
- `recipe_lines`: `raw_material_id uuid references raw_materials(id)` (nullable), `quantity_grams numeric` (nullable)
- `apps`: oppdater `ravarer` status fra `planned` → `in_development`

**Storage buckets:**
- `raw-material-datasheets` (privat)
- `supplier-agreements` (privat)

**Helper-funksjon (SECURITY DEFINER):**
- `public.has_ravarer_access(_user_id uuid, _legal_entity_id uuid, _min_level text)` — returnerer boolean. Brukes i alle RLS-policyer for å unngå rekursjon.
- `public.is_ravarer_owner(_user_id uuid)` — sjekker `is_owner`-flagg via `user_positions` → `positions`.

**RLS-mønster på alle org-eide tabeller:**
- SELECT: tilgang til `legal_entity_id` ELLER `is_ravarer_owner = true`
- INSERT/UPDATE/DELETE: `has_ravarer_access(..., 'editor')` på `legal_entity_id` (eier kan ikke skrive — read-only på tvers)
- Child-tabeller (`raw_material_nutrition`, `_allergens`, `_suppliers`, `_aliases`, `_price_history`) sjekker via parent's `legal_entity_id`.

## App-rute og navigasjon

- Ny rute: `/ravarer` med `AppAccessGuard appCode="ravarer"`
- Følger `/varer`-mønsteret: egen `RavarerAppProvider`, egen `AppHeaderBanner`, sub-nav med pille-styling
- Sidebar/sub-nav: **Vareliste** (default), **Kategorier** (admin), **Import** (CSV)

## Modul A — Råvareregister

**`/ravarer/vareliste`** — listeside
- Tabell (shadcn): SKU, Navn, Kategori, Primær leverandør, Kostpris (kr/enhet), Sist oppdatert, Status-badge
- Søk på navn/SKU + filtre: kategori, leverandør, aktiv, "mangler næring", "mangler allergen", "mangler avtalt pris"
- Knapper: **Ny råvare** (modal), **Importer CSV**, **Eksporter CSV**

**`/ravarer/vareliste/:id`** — detaljside med 6 tabs:
1. Oversikt — grunndata + lager
2. Næring & deklarasjon (Modul B)
3. Leverandører & priser (Modul C)
4. Prisinnsikt (Pulje 3 — placeholder nå)
5. Brukt i oppskrifter (Pulje 3 — placeholder)
6. Fakturahistorikk (Pulje 2 — placeholder)

**Validering:**
- SKU unikt pr `legal_entity_id` (DB-constraint + form-feedback)
- `current_cost_price >= 0`
- Hvis `is_packaging = true` skjul tabs 2 (næring/allergen)

**CSV-import** (`/ravarer/import`)
- Last opp CSV → kolonne-mapping-UI → preview med valideringsfeil → atomisk insert
- Felter: sku, navn, kategori, base_unit, package_size, package_unit, primary_supplier (navn-oppslag), agreed_price

**Kategoristyring** (`/ravarer/innstillinger/kategorier`)
- Enkel CRUD-side. Kategorier lagres på `raw_materials.category` (text). Forenklet løsning: bare distinct-liste med rename-funksjon (UPDATE av matchende rader). Defaults seedes første gang: mel, sukker, fett, frø, frukt/bær, smaksetting, melkeprodukter, egg, emballasje.

## Modul B — Næring og deklarasjon

Egen tab på detaljsiden.

**Næring pr 100 g** (react-hook-form + zod):
- Energi (kJ/kcal) — auto-beregn fra makro hvis tomt: `kJ = 37·fett + 17·karbo + 17·protein + 8·fiber`, `kcal = kJ/4.184`. Overstyrbart med "Bruk auto"-knapp.
- Fett, mettet fett, karbo, sukker, fiber, protein, salt
- Validering: sum ≤ 100 g (warning, ikke blokkerende)

**Deklarasjon:**
- Tekstfelt "Ingrediensdeklarasjon"
- Allergen-grid: 24 allergener × 3 tilstander (inneholder / kan inneholde spor / fri for) som radio
- E-nummer-tags med autocomplete fra fast liste (E100–E1525, statisk JSON i frontend)
- Opprinnelsesland: ISO 3166 alpha-2 dropdown + "EU"/"Ikke-EU"

**Datablad:**
- Filopplasting til `raw-material-datasheets` (path: `{legal_entity_id}/{raw_material_id}/{filename}`)
- PDF-preview (object-tag)
- "Verifisert"-knapp setter `verified_at` + `verified_by`

## Modul C — Leverandører og prishistorikk

Egen tab på detaljsiden.

**Leverandørliste:**
- Tabell: leverandør, supplier_sku, supplier_product_name, pakning, avtalt pris, sist fakturert (kommer i Pulje 2 — vis "—" nå), primær-badge
- Knapper: **Legg til leverandør** (modal), rad-klikk = edit
- Avtaledokument-opplasting til `supplier-agreements`, utløpsdato med fargekoding (rød < 30 d, gul < 90 d)

**Prishistorikk-graf** (recharts `LineChart`):
- En linje pr leverandør, avtalt pris som horisontal stipla referanse
- Markører pr observasjon med tooltip (dato, pris, kilde, leverandør)
- Periodevelger: 3M / 6M / 1Å / 3Å / Alt

**Manuell prisregistrering** (modal):
- Felter: pris, dato, leverandør, kilde (`manual`/`agreement`/`price_list`), notat
- Sjekkboks "Sett som gjeldende pris" → oppdaterer `raw_materials.current_cost_price` + `price_updated_at` + `price_source`
- Skriver alltid til `raw_material_price_history`

**Tabell under graf:**
- All historikk, sorterbar, CSV-eksport

## Tekniske detaljer

- **Frontend-mappe**: `src/ravarer/` (følger `varer/`/`kunder/`-mønster) med `pages/`, `components/`, `hooks/`, `lib/`, `context/`
- **Datahenting**: `@tanstack/react-query` med `useLegalEntity` for tenant-context (henter aktiv legal_entity fra `SelectionProvider`)
- **Skjemaer**: `react-hook-form` + `zod`
- **UI**: shadcn-komponenter, semantic tokens, samme bakeri-pille-styling som resten
- **Norsk språk** overalt (UI, valideringsmeldinger, toasts via sonner)
- **Norsk tallformat**: bruk `Intl.NumberFormat('nb-NO')` for pris/mengde
- **Routes registreres** i `src/App.tsx` med `Shell` + `AppAccessGuard` + `RavarerAppProvider`-wrapper

## Definition of Done — Pulje 1

1. Bruker med `editor`-tilgang til `ravarer` for et `legal_entity` kan opprette, redigere og slette en råvare
2. Næring (med auto-energi) og 24 allergener kan registreres og vises riktig
3. Datablad og avtaledokument kan lastes opp og åpnes
4. Leverandører kan kobles til råvare med avtalt pris og pakning
5. Manuell prisregistrering oppdaterer `current_cost_price` og lager rad i historikken
6. Prisgraf viser historikk pr leverandør med avtalt pris som referanse
7. CSV-import fungerer atomisk med validering
8. Eier-konto (position med `is_owner = true`) ser råvarer på tvers av alle legal entities (read-only)
9. Alle tabeller har RLS aktivert; ingen lekkasje på tvers av tenants for ikke-eiere

Pulje 2 (faktura/matching) og Pulje 3 (innsikt/SSB/varsler) bygges separat etter at Pulje 1 er testet på reelle data.