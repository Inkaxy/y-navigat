## Hva som er galt

### 1. "Ukjent produkt" i fastordre-dialogen
`RecurringScheduleDialog` slår opp produktnavn via `useNBProducts()` (uten søk). Den hooken:
- filtrerer `is_for_sale = true` og `status != 'discontinued'`
- har `.limit(100)`

Hvis et produkt på malen er utgått, ikke selgbart, eller faller utenfor de 100 første alfabetisk, finnes det ikke i `productMap` → vises som **"Ukjent produkt"**. Søk i produktvelgeren treffer det heller ikke nødvendigvis siden samme filter brukes.

### 2. Fastordren vises ikke i Leveringskalender-matrisen
`useRecurringGhost` (`src/ordre/hooks/useRecurringGhost.ts`) hopper eksplisitt over alle linjer uten `tour_id`:
```
if (!item.tour_id) continue;
```
I skjermbildet ditt har begge produktradene **Tur = "—..."** (ingen tur valgt). Resultat: ingenting i ghost-mapen → ingen ghost-badge i matrisen.

I tillegg krever matrisen at `tourActiveOnDate(tour, date)` er sann — så selv med tur må turen være aktiv på den ukedagen.

## Forslag til fix

### A. Hent produkt-metadata for malen via ID-er
I `RecurringScheduleDialog.tsx`:
- Bruk `useProductsByIds` (finnes allerede i `src/ordre/hooks/useProductsByIds.ts`) på alle `product_id`-er i `detail.items`, og slå dem inn i `productMap` i tillegg til `useNBProducts`.
- Da vises riktig navn/nummer/kode uavhengig av is_for_sale, discontinued eller 100-grensen.

(Vurder også å øke/fjerne `.limit(100)` i `useNBProducts` når det brukes som "alle produkter" — men minimumsfiksen over er nok for "Ukjent produkt"-symptomet.)

### B. Vis fastordre uten tur i matrisen
To alternativer — anbefaler **A2**:

**A1.** Krev at brukeren velger tur i dialogen (valider ved lagring). Enkelt, men flytter byrden til brukeren og forklarer ikke dagens data.

**A2.** Endre `useRecurringGhost` slik at items uten `tour_id` mappes til **alle aktive turer** den ukedagen kunden ellers leveres på — eller, enklere: endre nøkkelen til å droppe tur (`${date}|${productId}`) når item.tour_id er null, og la matrise-rendering vise badgen i første aktive tur-celle for den dagen. Det krever en liten omskriving av lookup i `Leveringskalender.tsx` (linje ~1814).

Den minst inngripende varianten: behold tur-spesifikk nøkkel, men i `useRecurringGhost` ekspander tur-løse items til **alle aktive turer** for ukedagen via `delivery_tours`. Da dukker ghost opp på alle aktuelle turer som "foreslått grunnlag", og brukeren kan eventuelt velge spesifikk tur i malen senere.

## Filer som berøres
- `src/ordre/components/orders/RecurringScheduleDialog.tsx` — slå opp manglende produkter via `useProductsByIds`.
- `src/ordre/hooks/useRecurringGhost.ts` — håndter items uten `tour_id` (ekspander til aktive turer for ukedagen).

Ingen DB-endringer.

## Spørsmål før jeg implementerer
1. For tur-løse mal-linjer: ekspandere ghost til **alle aktive turer** den dagen, eller heller kreve at bruker velger tur i dialogen?
2. Skal jeg også øke/fjerne `.limit(100)` i `useNBProducts`, eller bare patche metadata-oppslaget?
