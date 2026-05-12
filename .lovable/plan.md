## Mål

1. Utskrift av produksjonsplanen skal ligne det vedlagte PDF-eksempelet og passe på ett A4-ark.
2. Brukeren skal kunne skjule kolonner som er irrelevante for en gitt liste (Hovedgr., Deigtype, Enhet, I ordre, Fra lager, Liter, På lager).

## Endringer

### 1. Print-layout (A4-kompakt, kun listen)

I `src/index.css` `@media print`:
- Sett kompakt typografi: `font-size: 10pt`, `line-height: 1.15`, sans-serif.
- Tabell: `border-collapse`, tynne svarte linjer (`border: 0.5pt solid #000`), `td/th { padding: 2pt 4pt }`, `font-size: 9pt`.
- `thead` repeteres på hver side (`display: table-header-group`).
- Skjul globalt: topbar, submeny, status-/kriteria-card, footer-hint, mal-pille, alle knapper (`.print-hide` + skjul `header`, `nav`, `[role="dialog"]`).
- `.print-area` får egen header med "PRODUKSJONSLISTE FOR: {ukedag dd.mm.åå} sum alle turer", liten dato/skrevet-ut-stempel oppe til høyre, og fotnote "Fra X daterte ordre, Y fastordre".
- `@page { size: A4 portrait; margin: 10mm; }`.

### 2. Hovedgruppe som seksjons-header (ikke kolonne) ved utskrift

I `ProductionPlanTable.tsx` (eller via en print-only variant):
- Når `showByMainGroup=true` og man printer: render hver hovedgruppe som en H2-rad ("B1 Brød og Loff") og dropp "Hovedgr."-kolonnen.
- På skjerm beholdes dagens layout (rowspan-kolonne) uendret.

### 3. Nye kolonne-valg

Utvid `UiPrefs` i `ProduksjonsplanPage.tsx`:
```
hideMainGroupCol: boolean
hideDoughTypeCol: boolean
hideUnitCol: boolean
hideOrderedCol: boolean
hideFromStockCol: boolean
hideLitersCol: boolean
hideOnStockCol: boolean
```
Default: alle `false` (samme som i dag), bortsett fra at print uansett legger Hovedgr. som seksjons-header.

I innstillinger-dropdownen legges en ny seksjon "Kolonner" med checkbox per kolonne. Eksisterende `hideDoughTypes` gjenbrukes som `hideDoughTypeCol` (rename + migrasjonsfri – gammel verdi leses som fallback).

`ProductionPlanTable` får tilsvarende props og skjuler header + celle (juster `colSpan` på tomme/loading-rader).

### 4. Header-tekst og tellinger ved utskrift

I `ProduksjonsplanPage.tsx` `print:block`-blokken erstattes med:
- `PRODUKSJONSLISTE FOR: onsdag 13.05.26 sum alle turer` (formattert nb-locale).
- Liten "Skrevet ut: {dd.MM.åå HH:mm}" oppe til høyre.
- Footer: `Fra {datert} daterte ordre, {fast} fastordre`.

## QA

Etter endring: åpne print-preview i Chrome (Ctrl+P), bekreft 1 side A4, tabell-kolonner ikke kuttes, header repeteres ved sideskift hvis innholdet vokser, og at kolonne-toggles speiler valget både på skjerm og print.

## Filer som endres

- `src/index.css` (print-CSS)
- `src/produksjon/pages/ProduksjonsplanPage.tsx` (prefs + UI-toggles + print-header)
- `src/produksjon/features/produksjonsplan/components/ProductionPlanTable.tsx` (kolonne-toggles + seksjon-header ved print)
