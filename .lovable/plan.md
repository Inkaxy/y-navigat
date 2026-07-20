## Bakgrunn

I NBOS er databasen og admin-UI-et klart:

- `customers.bakes_own_products` (boolean) — styrer om kunden ser menyen.
- `products.is_bakeable_raw` + `products.baked_product_id` — kobler råvare → ferdigstekt salgsvare.
- `customer_bake_logs` — én rad per (kunde, råvare, dato) med `qty`.
- Fire RPC-er (SECURITY DEFINER, RLS-safe) er ferdig deployet:
  - `portal_can_bake_own() → boolean`
  - `portal_list_bakeable_products() → id, display_number, code, display_name, unit_of_sale, baked_product_id, baked_display_name`
  - `portal_upsert_bake_log(p_raw_product_id uuid, p_qty numeric) → uuid` (idempotent på dato, `p_qty = 0` sletter)
  - `portal_list_bake_logs(p_date date default current_date) → id, raw_product_id, raw_display_name, baked_product_id, baked_display_name, qty, bake_date`

Kundeportalen trenger å eksponere denne funksjonaliteten som en ny meny + side, kun for kunder der flagget er på.

## Det som skal bygges i Kundeportal

### 1. Ny side: `src/pages/StektSelv.tsx`

Rute: `/stekt-selv` — legges inn i `App.tsx` innenfor den samme `ProtectedRoute + AppLayout`-blokken som `/bestill`, `/mine-ordre` osv.

Innhold på siden:

- Datovelger øverst (default: dagens dato). Brukes både for lesing (`portal_list_bake_logs(p_date)`) og skriving (RPC-en lagrer alltid på dagens dato — se punkt om datovalg lenger ned).
- Liste over stekbare varer fra `portal_list_bakeable_products`. Én rad per råvare med:
  - Varenavn (`display_name`) + varenummer.
  - Ferdigstekt-badge: «→ {baked_display_name}» hvis satt, ellers grå «Ikke koblet — kan ikke registreres».
  - Talltast/stepper for antall (`qty`), enhet fra `unit_of_sale`.
  - «Lagre»-knapp per rad (eller auto-lagre på blur / debounce 500 ms).
- Sammendrag nederst: «Registrert i dag: X varelinjer, totalt Y enheter».
- Tomtilstand hvis listen er tom: «Ingen råvarer er merket som stekbare av din leverandør ennå.»

### 2. Meny-synlighet

I `src/components/Header.tsx`:

- Kall `portal_can_bake_own()` via en `useQuery` (hook: `useCanBakeOwn` i `src/hooks/useCanBakeOwn.ts`) — cache i 5 min.
- Hvis `true`: sett inn menyelement `{ to: "/stekt-selv", label: "Stekt selv" }` mellom «Bestill» og «Mine ordre» i `NAV`-arrayet.
- Skal gjøres både i desktop-nav og mobil-sheet (samme `NAV`-array håndterer begge).

### 3. Route-guard

Legg til en enkel guard i `StektSelv.tsx`:

- Ved mount, kall `portal_can_bake_own`. Hvis `false`, redirect til `/start` med `toast.info("Denne funksjonen er ikke aktivert for din bruker")`.
- Dette hindrer at kunder som taster URL-en direkte får en tom side eller en RPC-feil.

### 4. Datovalg og RPC-utvidelse (viktig avklaring)

Dagens `portal_upsert_bake_log(p_raw_product_id, p_qty)` skriver **kun til dagens dato**. Kravet fra brukeren er:

> «det som blir registrert som stekt til valgt dato skal på sikt bli tilgjengelig for klikk og hent»
> «kun til den datoen det er stekt til»

Så «stekt til dato» er en reell forretningsverdi (produktet skal være tilgjengelig for salg/retur akkurat den datoen). Portalen må derfor kunne velge dato — vanligvis dagens dato, men også fram i tid (kunden registrerer i dag at de skal steke til i morgen).

Vi må derfor utvide RPC-en i NBOS-prosjektet før portalen kan lagre annet enn dagens dato:

```sql
create or replace function public.portal_upsert_bake_log(
  p_raw_product_id uuid,
  p_qty numeric,
  p_bake_date date default current_date
) returns uuid ...
```

Denne endringen gjøres i NBOS, ikke i Kundeportal — men portalen må vente på den før datovelgeren gjør noe utover å endre lesevisningen. Første iterasjon kan låse datovelgeren til «I dag» og aktivere fri dato når RPC-en er utvidet.

### 5. Filer som skal opprettes/endres i Kundeportal

Nye filer:

- `src/pages/StektSelv.tsx` — siden.
- `src/hooks/useBakeableProducts.ts` — `useQuery` mot `portal_list_bakeable_products`.
- `src/hooks/useBakeLogs.ts` — `useQuery` mot `portal_list_bake_logs(date)`.
- `src/hooks/useUpsertBakeLog.ts` — `useMutation` mot `portal_upsert_bake_log`, invalidérer `useBakeLogs`.
- `src/hooks/useCanBakeOwn.ts` — `useQuery` mot `portal_can_bake_own`.

Endringer:

- `src/App.tsx`: importér `StektSelv`, legg til `<Route path="/stekt-selv" element={<StektSelv />} />` inne i den beskyttede blokken.
- `src/components/Header.tsx`: kall `useCanBakeOwn`, injisér menyelementet betinget i `NAV`.

### 6. Design

Følg samme mønster som `Matrise.tsx` og `MineOrdre.tsx`:

- `max-w-4xl mx-auto px-4 py-6`
- Bruk eksisterende shadcn-komponenter: `Card`, `Input`, `Button`, `Badge`.
- Talltast-stepper: enkel `Input type="number"` med `+`/`−`-knapper (samme som i matrisen).
- Toast via `sonner` på lagring — «Lagret {qty} {enhet} {navn}».

## Teknisk sekvens for Kundeportal-agenten

1. Utvid `portal_upsert_bake_log` i NBOS med `p_bake_date`. **Gjøres i NBOS-prosjektet, ikke i Kundeportal.**
2. Opprett hooks (steg 5).
3. Bygg `StektSelv.tsx` med datovelger, liste og lagring.
4. Kobl inn menyelementet i `Header.tsx` bak `useCanBakeOwn`.
5. Legg til route i `App.tsx`.
6. Test som kunde med `bakes_own_products = true` og en kunde uten — verifisér at menyen kun synes for førstnevnte.

## Ute av scope for denne iterasjonen

- Kobling mot klikk-og-hent (nettsiden). Det bygges når nettside-integrasjonen er på plass — RPC-en `portal_list_bake_logs` og `customer_bake_logs`-tabellen er allerede fundamentet.
- Retur av selv-stekte varer. Håndteres i eksisterende returordre-flyt senere ved å sjekke `customer_bake_logs` for kunden/datoen før returen tillates.
