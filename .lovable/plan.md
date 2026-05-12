## Mål
Vis ISO-ukenummer i alle kalendere i appen.

## Endring
Én sentral endring i `src/components/ui/calendar.tsx` (shadcn-wrapper rundt `react-day-picker`), som brukes av alle datovelgere (DateNavigator, WeekMonthQuickPicker, PeriodPicker, DateContextChips → kalender, m.fl.).

1. Sett `showWeekNumber` som default `true` på `<DayPicker>` (kan overstyres per bruk hvis nødvendig).
2. Sett `weekStartsOn: 1` (mandag) som default — ISO-uke starter mandag, og det matcher allerede norsk locale (`nb`) brukt rundt om.
3. Legg til styling i `classNames` slik at uke-kolonnen passer designsystemet:
   - `head_head`: smal kolonne, `text-muted-foreground text-[0.7rem] font-normal uppercase tracking-wide`
   - `weeknumber`: `text-muted-foreground text-[0.7rem] tabular-nums w-9 text-center`
4. Lokalisér uke-header til "U" (eller "Uke") via `labels.labelWeekNumberHeader` så det ikke står engelsk "Wk".

## Hva blir IKKE endret
- Ingen logikk i de enkelte sidene/dialogene.
- Ingen design-tokens i `index.css` / `tailwind.config.ts`.
- Ingen endringer på print/produksjonsplan/snapshot-flyt.

## Teknisk
- `react-day-picker` v8 props brukt: `showWeekNumber`, `weekStartsOn`, `labels`.
- Klassenavn (`head_head`, `weeknumber`) flettes inn via eksisterende `classNames`-objekt slik at brukstedene fortsatt kan overstyre via `cn`.
