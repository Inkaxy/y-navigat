## Mål
Linjene i produksjonsplan, korreksjonsliste og utskrift skal kun veksle mellom **hvit** (oddetalls-rader) og **lysegrå** (partalls-rader). Ingen pastell-toner fra kategoripaletten.

## Endringer

### 1. `ProductionPlanTable.tsx`
- Fjern import og bruk av `categoryColor`.
- Fjern `data-cat-color`-attributt og `style`-objektet som setter `backgroundColor` / `--print-bg`.
- Forenkle `className` til:
  - `isZebra && "bg-muted/40"` (lysegrå annenhver rad)
  - behold `hasDetails && "cursor-pointer hover:bg-muted/60"`
  - behold `isExpanded && "bg-accent/30"`

### 2. `CorrectionPlanTable.tsx`
- Samme opprydding: fjern `categoryColor`-import, `data-cat-color`, inline-style og brightness-klasser.
- Bare `isZebra ? "bg-muted/40" : undefined`.

### 3. `src/index.css` — print-regler
- Fjern (eller forenkle) `.print-area`-regler som leser `--print-bg`.
- Erstatt med klassisk zebra: oddetalls-print-rader får `background: #f3f4f6` (lysegrå), partalls-rader hvit. Behold `print-color-adjust: exact` så grå faktisk skrives ut.

### 4. `categoryColor.ts`
- Filen brukes ikke lenger andre steder — kan slettes, eller beholdes som ubrukt. Forslag: slett for å holde koden ryddig.

## Resultat
Skjerm og utskrift viser kun hvit + lysegrå annenhver-rad, helt uten farge per varegruppe — i tråd med ønsket utseende.
