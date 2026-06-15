## Problem

Etiketten leses fra utskriftsprofilen (`label_print_profiles.fields`), som vet hvor hvert felt (`varenr`, `varenavn`, `fyll`, `tekst`, `pynt`, `bestilt_av`, `kundenavn`, `tur`, `hentested`, `kommentar` …) skal plasseres. Verdiene hentes i `labelPdf.tsx` fra to kilder:

1. `LabelProductRow` (varenavn, varenr, etikett_nr, antall)
2. `order_lines.merknad` (JSONB med `bestilt_av`, `fyll`, `tekst`, `pynt`, `fritekst_1`, `telefon`, `tid`, `sukkerbilde` …) + sidekanaler (kundenavn, hentested, tur, leveringsadresse, dato).

I dag fyller `pos_create_cake_order` kun `product_snapshot` på ordrelinjen — `order_lines.merknad` står tom. Resultat: alle de "interessante" feltene på etiketten (fyll, tekst, pynt, bestilt_av, kommentar) blir tomme, selv om kakebyggeren har samlet inn dataene i `label_payload`.

Varenr/varenavn er allerede riktig etter forrige fix.

## Løsning — full mapping, server-side

Bygg `merknad`-JSONB i `pos_create_cake_order` fra `v_label_payload` + komponentene, og skriv den til ordrelinjen samtidig som linjen opprettes. Profilen i `label_print_profiles` får da fylte verdier å plassere.

### Mapping (kakebygger → merknad/etikettfelt)

| Etikettfelt (FieldType) | Kilde i kakebygger |
|---|---|
| `varenr` / `varenavn` | `v_main_product` (allerede ok) |
| `kundenavn` | `label_payload.customer_name` → også brukt direkte i `PrintLabelDialog` |
| `bestilt_av` | `label_payload.customer_name` (eller `recipient` hvis satt) → `merknad.bestilt_av` |
| `telefon` | kunde-lookup (`pos_customers.phone`) → `merknad.telefon` |
| `hentested` | `label_payload.pickup_location` → ordrelinjens hentested-kobling |
| `tur` | `label_payload.pickup_tour` → ordrelinjens tur-kobling |
| `leveringsdato` | `label_payload.pickup_date` |
| `hentetidspunkt` | `label_payload.pickup_time` → `merknad.tid` |
| `tekst` (kakeskrift) | `label_payload.cake_text` → `merknad.tekst` |
| `fyll` | komponenter med `cake_role in ('fyll','filling')` joinet → `merknad.fyll` |
| `pynt` | komponenter med `cake_role in ('pynt','dekor','topping')` joinet → `merknad.pynt` |
| `sukkerbilde` | true hvis komponent med `cake_role='sukkerbilde'` valgt |
| `kommentar` | `label_payload.note` → `merknad.fritekst_1` |
| `antall` | line.quantity (allerede ok) |
| `etikett_nr` | runtime label sequence (allerede ok) |

### Endringer

1. **Migration: utvid `build_cake_order_line`**
   - Bygg `v_merknad jsonb` i tillegg til `v_label_payload`, basert på label-feltene + komponentenes `cake_role` (aggregert med `string_agg` per rolle).
   - Inkluder `v_merknad` i return-objektet (`'merknad', v_merknad`).
   - `cake_steps.label_field_key` aksepterer nye nøkler: `fyll`, `pynt`, `sukkerbilde`, `telefon` (slik at man eventuelt kan overstyre via egne steg). Komponent-basert mapping er fallback.

2. **Migration: oppdater `pos_create_cake_order`**
   - Les `v_merknad := v_cake_result->'merknad'`.
   - Sett `merknad = v_merknad` på `INSERT INTO order_lines` for hovedlinjen (kun hovedproduktet — tilbehørslinjer får ingen merknad).
   - Skriv også `pickup_location_id`, `delivery_tour_id`, `delivery_date` på `orders`/`order_lines` der disse er resolved fra payload (allerede gjort i dag for orders, men dobbeltsjekk at felt på ordrelinjen er konsistente).

3. **`LabelProductsTable`/`PrintLabelDialog`** (frontend)
   - Ingen kode-endring nødvendig — `useOrderLineMerknads` plukker opp `order_lines.merknad` automatisk og sender inn til `labelPdf.tsx` via eksisterende `merknad`-prop.

4. **Verifisering**
   - Opprett en testordre fra kakebyggeren med fyll/pynt/tekst valgt. Sjekk i Supabase at `order_lines.merknad` er fylt.
   - Åpne etiketten fra Produksjon → Etiketter og bekreft at alle felt i profilen viser data.

### Det dette IKKE endrer

- Layout/posisjoner på etiketten — fortsatt 100 % styrt av `label_print_profiles.fields` (per profil, slik du valgte).
- Frontend label-rendering (`labelPdf.tsx`) — den har allerede alle nødvendige `case`-grener i `valueFor`.
- Andre apper enn kakebyggeren.

### Filer

- `supabase/migrations/<ny>.sql` (oppdaterer `build_cake_order_line` + `pos_create_cake_order`)

Ingen frontend-kodeendringer i denne runden.
