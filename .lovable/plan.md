# Ny etikett-modus: «Per kundeordre»

## Mål
Legg til et fjerde valg i nedtrekkslisten **Skrive etikett** på vare-detalj → Produksjon. Når en kunde bestiller flere av samme vare i samme ordre, skal alt komme på én felles etikett — uavhengig av antall.

Eksempel: Kunde bestiller 5 kneipp → 1 etikett (ikke 5).

## Sammenligning med eksisterende modi

| Verdi | Etikett |
|---|---|
| `none` | Ingen |
| `per_unit` | 1 per stk (5 kneipp = 5) |
| `per_order_or_note` | 1 per ordre + 1 ekstra per merknad |
| `per_note` | Kun hvis merknad |
| **`per_order` (ny)** | **Nøyaktig 1 per kundeordre — ignorerer antall og merknad** |

## Endringer

### Database (migrasjon)
Oppdater `public.get_label_products_for_date` slik at `CASE`-uttrykket som beregner `total_labels` får en ny gren:
```
WHEN 'per_order' THEN COUNT(DISTINCT el.order_id)::INTEGER
```
Ingen schema-endring nødvendig — `label_mode` er allerede `text` uten CHECK-constraint.

### Frontend
- `src/varer/lib/productSchema.ts`: legg `"per_order"` i `LABEL_MODES`-enum.
- `src/varer/lib/constants.ts`: legg til
  - option `{ value: "per_order", label: "Per kundeordre" }`
  - beskrivelse: «Én etikett per ordre, uansett antall stk eller merknad.»
- `src/produksjon/features/etiketter/types.ts`: utvid `LabelMode`-union med `"per_order"`.
- `src/produksjon/features/etiketter/components/LabelProductsTable.tsx`: legg `per_order`-badge i `MODE_LABELS`.

### Etikett-utskrift
Eksisterende per-stk-løkke i utskrift må sjekkes — for `per_order` skal det produseres nøyaktig 1 etikett per ordre (sum av antall vises som tekst på etiketten, men er ett fysisk merke). Jeg sjekker `useLabelPrintJobs`/skriverflyten ved implementering og legger inn samme behandling som `per_note` (én etikett uavhengig av kvantum).

## Berørte filer
- ny migrasjon (oppdaterer DB-funksjon)
- `src/varer/lib/productSchema.ts`
- `src/varer/lib/constants.ts`
- `src/produksjon/features/etiketter/types.ts`
- `src/produksjon/features/etiketter/components/LabelProductsTable.tsx`
- evt. utskrifts-hook hvis den itererer per stk
