# Pakkefil med produksjonsplan-kriterier

Pakkefilen (JSON) bygges i dag ut fra alle ordre på leveringsdagen. Den skal filtreres med samme kriterier som produksjonsplan/pakkeliste: tur, hovedvaregrupper, undervaregrupper og kundegrupper. Aggregerings- og sorteringsvalg fra produksjonsplanen gjelder ikke — pakkefilen er per ordre, ikke aggregert per vare.

## Endringer

### 1. Edge-funksjon `pakkesystem-export`
Nye valgfrie query-parametere (samme datamodell som `ProduksjonsplanCriteria`):
- `tours` — komma-separerte tur-nummer (f.eks. `1,2`). Tom = alle.
- `main_categories` — main_category_id-er.
- `sub_categories` — sub_category_id-er.
- `include_no_sub` — `1`/`0`, default `1`.
- `customer_groups` — customer_group_ids.

Filterlogikk:
- Ordre begrenses til valgte tur-nummer via `delivery_tours.tour_number`.
- Ordrelinjer filtreres på produktets `main_category_id` og `sub_category_id`; ved `include_no_sub=1` tas linjer uten sub_category_id også med.
- Kunder filtreres via `customer_group_members`.
- Ordre og produkter uten treff etter filtrering droppes; en ordre uten linjer inkluderes ikke.
- Kriteriene ekkoes tilbake i `filters`-blokka i JSON-en for revisjon.

Gate på pakksedler-generert-status beholdes uendret.

### 2. Push-destinasjoner
`pakkesystem_push_destinations` får en `criteria jsonb` kolonne (default `{}`). Cron-jobben serialiserer kriteriene til query-string når snapshot hentes.

### 3. UI `/ordre/pakkesystem`
- Gjenbruk `SettKriteriaDialog` fra `src/produksjon/features/produksjonsplan/components/` for både manuell nedlasting og per push-destinasjon.
- Skjul aggregation/sort_by/merge_by_main_product i dialogen når `mode="packing_file"` — de er irrelevante for JSON-eksport.
- Ny knapp «Kriterier…» ved nedlasting og ved hver push-destinasjon; viser en kort oppsummering (f.eks. «Tur 1,2 · 3 varegrupper»).
- Kriteriene lagres i komponent-state for manuell nedlasting og i `destination.criteria` for push.

### 4. Test-push i UI
Bruker samme kriterier som destinasjonen har lagret.

## Tekniske detaljer

- Migrasjon: `ALTER TABLE public.pakkesystem_push_destinations ADD COLUMN criteria jsonb NOT NULL DEFAULT '{}'::jsonb;` (ingen policy-endring).
- Edge-funksjon parser query-string til objekt, kaller Supabase med `.in(...)` for lister; tomme lister = ingen filtrering.
- `SettKriteriaDialog` tar allerede `initial` og `onApply(criteria)` — legges inn med et `hiddenFields`-prop for å skjule aggregation-blokka når vi bruker den i pakkefil-kontekst.
- `customer_group_members` join gjøres via `.in("customer_id", ...)` etter et separat oppslag når `customer_groups` er satt.
