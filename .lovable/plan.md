## Mål
Gjøre varelisten (`/varer/vareliste`) konfigurerbar — brukeren kan huke av hvilke kolonner som vises, og valget huskes per bruker.

## UI

I filterraden øverst i tabellen, ved siden av "X treff", legg til en **"Kolonner"-knapp** (ikon `Columns3` + label) som åpner en `Popover` med en sjekkliste over alle tilgjengelige kolonner. Hver rad: checkbox + kolonnenavn. Knapp nederst: "Tilbakestill".

Faste kolonner (kan ikke skjules): Nr, Navn, Status.
Valgbare kolonner (default-synlig markert med ✓):

- ✓ Variant av
- ✓ Kategori
- Underkategori
- ✓ Salgsenhet
- ✓ Pris (default-prisliste)
- MVA
- Etikett-modus
- Kakebygger-rolle
- Bilde (liten thumbnail)
- Varekode (`code`)

## Persistens

Lagres per innlogget bruker i Supabase via en ny tabell `user_ui_preferences`:

```text
user_ui_preferences
  user_id uuid PK (auth.uid())
  scope text PK         -- f.eks. "varer.product_list.columns"
  value jsonb           -- { visible: ["category","price",...] }
  updated_at timestamptz
```

RLS: bruker kan kun lese/skrive egne rader (`user_id = auth.uid()`).

Generisk hook `useUiPreference<T>(scope, defaultValue)` som returnerer `[value, setValue]`. Skriver med debounce (300 ms). Fallback til `localStorage` mens query laster, slik at kolonner ikke "hopper" ved sideinnlasting.

## Filer som endres / opprettes

- `supabase/migrations/<ts>_user_ui_preferences.sql` — ny tabell + RLS
- `src/hooks/useUiPreference.ts` — ny generisk hook
- `src/varer/components/products/ColumnPicker.tsx` — ny popover-komponent
- `src/varer/pages/ProductList.tsx` — bruk hook + render kolonner betinget; flytt kolonne-definisjoner til en liten config-array for å unngå duplikasjon mellom `<thead>` og `<tbody>`

## Tekniske detaljer

- Kolonne-config: `{ key, label, fixed?, defaultVisible, render(row), headerClassName?, cellClassName? }[]` — én kilde til sannhet for header og celler.
- `colSpan` for tomme/loading-rader regnes ut fra antall synlige kolonner.
- Hook-signatur: `useUiPreference<T>(scope: string, fallback: T): { value: T, setValue: (v: T) => void, isLoading: boolean }`.
- Cache: TanStack Query med `queryKey: ["ui-pref", scope, userId]`, `staleTime: Infinity`; `setValue` gjør optimistic update + upsert.
- Migrasjonen er additiv (ingen eksisterende data berøres).
