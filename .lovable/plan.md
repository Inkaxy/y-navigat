## Mål
Legg til en «Bekreft alle»-knapp på `/ravarer/datablad-endringer` så brukeren kan bekrefte alle uavklarte endringer i listen i én operasjon.

## Endringer

**`src/ravarer/pages/DatabladEndringer.tsx`**
- I filter-Card (linje 27–36): legg til en `Button variant="brand"` til høyre, kun synlig når `canWrite` og det finnes minst én ubekreftet rad i `rows`.
- Tekst: «Bekreft alle (N)» der N = antall ubekreftede rader i nåværende visning.
- Klikk åpner en `AlertDialog`-bekreftelse (gjenbruk shadcn `alert-dialog`) med tittel «Bekreft alle endringer?» og forklaring «Dette markerer N endringer som gjennomgått. Handlingen kan ikke angres.»
- Ved bekreftelse: kjør `Promise.all(unacked.map(r => ack.mutateAsync(r.id)))`, vis disabled-state mens det pågår, toast «N endringer bekreftet» ved ferdig, eller toast.error ved feil.
- Bruk eksisterende `useAcknowledgeChange` (krever at den eksponerer `mutateAsync` — react-query gjør det per default, ingen hook-endring nødvendig).

## Detaljer
- Plassering: `flex-1` mellom telleren og knappen så knappen havner helt til høyre i kortet.
- Når filter = "all" inkluderer telleren også allerede bekreftede; knappen teller kun `rows.filter(r => !r.acknowledged)`.
- Ingen DB- eller hook-endringer. Ingen nye avhengigheter.

## Ute av scope
- Bulk-endpoint i Supabase (vi løser med parallelle kall mot eksisterende mutation).
- Filtrering av hvilke endringer som skal bekreftes (kun «alle synlige uavklarte»).