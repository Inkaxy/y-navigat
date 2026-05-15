# Hovedvare per produksjonsgruppe + valgfri sammenslåing

## Mål
Når flere varer er pakket ulikt, men er samme bakevare (f.eks. nr. 1 Kneipp og nr. 701 Kneipp), skal de **kunne** slås sammen til én linje på produksjonsplanen — vist som hovedvarens nummer/navn med summert antall. Sammenslåingen må kunne skrus av/på per utskrift.

Eksempel (sammenslåing PÅ):
- Bestilt: nr. 1 Kneipp × 20, nr. 701 Kneipp × 25
- Vises som: **Varenummer 1 Kneipp = 45**

Sammenslåing AV: vises som to linjer (nr. 1 = 20, nr. 701 = 25), som i dag.

## Endringer

### 1. Database
Legg til `main_product_id uuid` (FK → products.id, nullable, ON DELETE SET NULL) på `production_groups`. Hvis ikke satt og sammenslåing er PÅ, faller aggregeringen tilbake på gruppens display_name.

### 2. Innstillinger – Produksjonsgrupper
Utvid `StamdataPage` med ny prop `extraProductPicker` for valg av hovedvare (filtrert til produkter i samme produksjonsgruppe i samme selskap). Vises som ekstra kolonne ("Hovedvare") og felt i ny/rediger-dialog.

### 3. Kriteria – ny toggle
- I `ProduksjonsplanCriteria`: ny `merge_by_main_product: boolean` (default `false`).
- I `SettKriteriaDialog` (under "Slå sammen til produksjonsvarer"): ny checkbox **"Slå sammen varer i samme produksjonsgruppe (vis som hovedvare)"**. Aktiv kun når `aggregation === "per_product"` (de andre modusene aggregerer allerede).

### 4. Produksjonsplan-aggregering (`useProductionPlan.ts`)
Når `merge_by_main_product = true` og `aggregation = per_product`:
- Hent `main_product_id` for hver produksjonsgruppe brukt i resultatet.
- Erstatt aggregeringsnøkkelen for produkter med produksjonsgruppe: bruk `mainProductId` i stedet for produktets egen id.
- Bruk hovedvarens `display_number`, `display_name`, `unit_of_sale`, `pieces_per_tray`, `pieces_per_liter` på den slåtte raden.
- Produkter uten produksjonsgruppe eller uten satt hovedvare beholder sin egen rad.

For `per_production_group` / `per_main_and_production_group`: bruk hovedvarens info når satt (fallback gruppens navn).

## Filer
- `supabase/migrations/...` — `main_product_id` på `production_groups`
- `src/varer/components/stamdata/StamdataPage.tsx` — støtte for hovedvare-velger
- `src/varer/pages/settings/SettingsProductionGroups.tsx` — ny prop
- `src/produksjon/features/produksjonsplan/types.ts` — `merge_by_main_product`
- `src/produksjon/features/produksjonsplan/components/SettKriteriaDialog.tsx` — ny checkbox
- `src/produksjon/features/produksjonsplan/hooks/useProductionPlan.ts` — bruk hovedvare i aggregering
