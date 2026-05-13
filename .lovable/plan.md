## Problem

Pris-matrisen for Teie (og enhver kunde uten leverte ordrer) viser ingen rader fordi `get_customer_matrix_data` kun tar med produkter som finnes i `order_lines` for kunden. Teie har 0 ordrer, men 284 linjer i `recurring_order_items` — disse blir ikke synlige, og dermed vises heller ingen priser.

Pris-oppslaget i seg selv fungerer (verifisert mot `3 NB Butikker`).

## Løsning

Utvid produktfilteret i `get_customer_matrix_data` til også å inkludere produkter fra kundens aktive fastordre.

### SQL-endring (migrasjon)

I produkter-CTE-en, bytt ut `EXISTS`-blokken med en `OR`:

```sql
AND (
  EXISTS (
    SELECT 1 FROM order_lines ol
    JOIN orders o ON o.id = ol.order_id
    WHERE ol.product_id = p.id
      AND o.customer_id = p_customer_id
      AND o.status <> 'cancelled'
  )
  OR EXISTS (
    SELECT 1 FROM recurring_order_items roi
    JOIN recurring_order_schedules ros ON ros.id = roi.schedule_id
    WHERE roi.product_id = p.id
      AND ros.customer_id = p_customer_id
  )
)
```

Resten av funksjonen (pris-oppslag via `GREATEST(p_date_from, CURRENT_DATE)`, turer, eksisterende celler) er uendret.

## Effekt

- Teie får umiddelbart sine 284 fastordre-produkter i matrisen, med priser fra `3 NB Butikker`.
- Kunder med både ordrer og fastordre får union av begge (ingen duplikater pga `EXISTS`).
- Ingen frontend-endringer nødvendig.

## Ingen kodeendringer

Kun én database-migrasjon (`CREATE OR REPLACE FUNCTION public.get_customer_matrix_data ...`).
