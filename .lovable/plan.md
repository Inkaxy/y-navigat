## Hvorfor er prisen 0,00 kr på Teie?

Teie har prisliste **«3 NB Butikker»**, og varene har faktisk priser der — men alle med `valid_from = 2026-05-13` (i dag). Matrisen viser uke 11.5–17.5, og RPC-en `get_customer_matrix_data` slår opp **én pris per vare for hele uka** ved å bruke `p_date_from` (mandag 11.5) som dato. Siden prisene først er gyldige fra 13.5, finner `get_effective_price` ingenting for 11.5 → `unit_price = null` → "0,00 kr" i sum-kolonnen for hele uka.

Dette gjelder ikke bare Teie: enhver kunde der priser nettopp er satt vil få 0 kr i matrisen denne uka, helt frem til mandag i neste uke.

## Foreslått fix

Endre `get_customer_matrix_data` slik at pris-oppslaget bruker `GREATEST(p_date_from, CURRENT_DATE)` i stedet for `p_date_from`. 

- For **fremtidige uker**: bruker mandag i den uka (uendret oppførsel).
- For **inneværende eller tidligere uker**: bruker dagens dato, som plukker opp priser som ble gyldige denne uka.

Dette matcher hvordan ordreregistrering allerede oppfører seg (priser settes ved ordreopprettelse mot dagens kontekst), og løser problemet uten å rekonstruere prishistorikk per celle.

### Teknisk

I `get_customer_matrix_data`:
```sql
'unit_price', (SELECT ep.price
               FROM public.get_effective_price(
                 p.id, p_customer_id, v_default_price_list_id,
                 GREATEST(p_date_from, CURRENT_DATE)
               ) ep),
'price_source', COALESCE((SELECT ep.source FROM public.get_effective_price(
                 p.id, p_customer_id, v_default_price_list_id,
                 GREATEST(p_date_from, CURRENT_DATE)
               ) ep), 'none')
```

Migrasjon: `CREATE OR REPLACE FUNCTION public.get_customer_matrix_data(...)` med samme body, kun pris-datoen byttet ut.

Ingen frontend-endringer nødvendig.
