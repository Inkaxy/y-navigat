## Endring

Vis produktbeskrivelsen (Markdown) fra varekortet → Varedetaljer øverst i "Vis produktinfo"-dialogen i ordre-matrisen.

## Implementasjon

`src/ordre/components/orders/matrix/ProductInfoDialog.tsx`:

1. Ta med `description` i `productQuery.select(...)`.
2. Legg til `react-markdown` som dependency (lettvekt, ingen GFM-plugins nødvendig).
3. Rett under bildet, før loading/ingredienser, render en seksjon:
   - Tittel: "Beskrivelse"
   - `<ReactMarkdown>` på `product.description` med `prose prose-sm` styling
   - Skjules helt hvis `description` er null/tom.

Ingen DB-endringer. Ingen andre filer påvirkes.

## Effekt

Når man åpner produktinfo fra matrisen, vises beskrivelsen øverst (over ingredienser/næring) — samme tekst som ligger i Varedetaljer-tabben på varekortet.
