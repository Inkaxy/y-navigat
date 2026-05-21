# Forbedre Ordrelinjer i Ny ordre

## Mål

1. **Mengde må være hele tall** (1, 2, 3 …) for varer som ikke er delbare. For delbare varer (f.eks. kg/liter, eller `is_divisible = true`) tillates desimaler.
2. **Layout-løft** av Ordrelinjer-seksjonen i `src/ordre/pages/NewOrder.tsx` slik at pris, rabatt og mengde blir tydeligere og mer behagelige å bruke (jf. de vedlagte skjermbildene).

## Endringer

### A. Mengde — hele tall som standard
- Utvid `ProductOption` (i `src/ordre/hooks/useNBProducts.ts`) til også å hente `is_divisible`.
- Mengde-feltet i ordrelinjen:
  - `step={isDivisible ? "0.001" : "1"}`, `min="1"`
  - `inputMode={isDivisible ? "decimal" : "numeric"}`
  - `onChange`: hvis ikke-delbar → strip alt unntatt siffer, tom verdi tillates mens man skriver.
  - `onBlur`: rund opp/ned til nærmeste hele tall (min 1) hvis ikke-delbar.
- Default-verdi forblir `"1"`.
- Validering før lagring: blokker desimal-mengde på ikke-delbar vare med tydelig toast.

### B. UI-løft av linje-raden
Behold dagens kolonner men polér visningen:

- **Spinner-pilene skjules** på alle `type="number"`-felt (samme triks som på pakkseddel): `appearance-none` + `[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`.
- **Bredere kolonner** så hele tallet vises:
  - Mengde: 96 px
  - Enhet: 64 px (vist som chip/badge, ikke bare grå tekst)
  - Pris/enhet: 128 px, høyrejustert, suffiks "kr"
  - Rabatt %: 88 px, suffiks "%"
  - Sum: 112 px, semibold
- **Tydeligere produktcelle**: produktnavn på topp, varenr som muted, "Bytt"-knapp som liten ghost.
- **Notat & badges på egen rad** (som i dag) men med litt mer luft og venstre-innrykk slik at det visuelt henger sammen med linja.
- **Hover-state** på hele rad (`hover:bg-muted/30`) og `rounded-md` rundt hver linje for å skille dem.
- **Tom-tilstand**: behold dashed boks, men gjør CTA-en til en stor "Legg til første linje"-knapp inni boksen.
- **Totaler-blokk** høyrejusteres med litt mer luft og en svak topp-bord.

### C. Sammenheng med pakkseddel
Samme mengde-regel (hele tall hvis ikke delbar) skal også gjelde i `DeliveryNoteDetail.tsx` sitt mengde-felt — vi gjenbruker `is_divisible` fra `product_snapshot` der det finnes, ellers tillater vi desimaler (bakoverkompatibelt).

## Filer som endres

- `src/ordre/hooks/useNBProducts.ts` — legge til `is_divisible` på `ProductOption` og i select.
- `src/ordre/pages/NewOrder.tsx` — hele Ordrelinjer-seksjonen (linjer ~834–950) og `LineDraft`/hjelpere.
- `src/ordre/pages/DeliveryNoteDetail.tsx` — samme mengde-regel på linje-input.

Ingen DB-migrasjoner. Ingen endring i lagre-flyten.
