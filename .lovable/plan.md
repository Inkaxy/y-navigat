
# Pakkesystem-API — leveranse fra NB Hub

Bygg et REST-API som pakkeleverandøren kan spørre mot for å hente ordre/produkter/kunder i det nøyaktige JSON-formatet i kravspec'en. Én langlevd Bearer-nøkkel per legal_entity.

## 1. Database

Ny tabell `pakkesystem_api_keys`:

- `id uuid pk`
- `legal_entity_id uuid` (FK → legal_entities)
- `name text` (etikett, f.eks. "Bakemann pakkesystem")
- `key_prefix text` (første 8 tegn, vises i UI)
- `key_hash text` (SHA-256 av full nøkkel — plaintext vises ÉN gang ved opprettelse)
- `created_at`, `created_by uuid`, `last_used_at`, `revoked_at`
- RLS: kun platform_owner/admin på entity kan lese/skrive. `service_role` ALL.

Loggtabell `pakkesystem_api_log` (append-only):
- `id`, `api_key_id`, `legal_entity_id`, `endpoint`, `query_params jsonb`, `status_code`, `row_count`, `ip`, `ua`, `created_at`
- Brukes til rate-limit + audit. Enkel: tell requests siste 60 sek per key ≤ 60.

Migrasjonen inkluderer GRANTs (`authenticated`: select/insert/update/delete på keys-tabellen; `service_role`: ALL på begge; ingen `anon`).

## 2. Edge-funksjon `pakkesystem-api`

Én funksjon som ruter på path:

- `GET /pakkesystem-api/orders?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /pakkesystem-api/products`
- `GET /pakkesystem-api/customers`
- `GET /pakkesystem-api/snapshot?date=YYYY-MM-DD` — full snapshot per spec (produkter+kunder+ordre samlet, `schema_version: "1.0"`)

`verify_jwt = false` (custom Bearer). Flyt per request:

1. Les `Authorization: Bearer <key>` → SHA-256 → oppslag i `pakkesystem_api_keys` der `revoked_at is null`. 401 hvis ikke funnet.
2. Rate-limit: count log-rader siste 60s for denne key_id. 429 hvis ≥ 60.
3. Zod-validering av query-params. 400 med `{error, code}` ved feil.
4. Kjør Supabase-query med service-role, scoped til `legal_entity_id` fra nøkkelen.
5. Map til spec-JSON (feltnavn nøyaktig som i kravspec — ikke våre interne kolonnenavn).
6. Skriv audit-rad, oppdater `last_used_at`.
7. Returner `application/json; charset=utf-8`, HTTP-koder per spec (200/400/401/429/500).

### Feltmapping (utdrag)

**products** ← `products` (kun `is_for_sale`, ikke `discontinued`, legal_entity scoped):
`id`=products.id, `product_number`=display_number, `name`=display_name, `category`=main_category-navn, `pieces_per_tray`=pieces_per_tray/pack_size, `ean`=ean, `unit_price`=null (prisliste-avhengig — utelates i produktkatalogen; kan legges på ordrelinjer hvis ønskelig), `active`=(status='active').

**customers** ← `customers` (status='active'):
`id`, `customer_number`, `name`=display_name, `address`={street, postal_code, city}, `phone`, `email`, `delivery_route`=(fra tour/rule), `delivery_sequence`=(fra rule), `notes`=delivery_instructions.

**orders** ← `orders` + `order_lines` (status i {confirmed, in_production, packed}, ikke cancelled):
`id`, `customer_id`, `delivery_date`, `delivery_window`={from, to} fra delivery_time + rule, `trip`=tour-nummer, `status` mappet til {draft|confirmed|cancelled}, `lines[]`, `created_at`, `updated_at`.

## 3. UI: `src/ordre/pages/PakkesystemApi.tsx`

Ny side under `/ordre/innstillinger/pakkesystem-api`:

- Liste over eksisterende nøkler (name, prefix, opprettet, sist brukt, revoke-knapp).
- «Opprett nøkkel»-dialog → viser plaintext-nøkkelen ÉN gang med copy-knapp og advarsel.
- Info-panel med endepunkt-URL-er, eksempel-curl, link til nedlastbar `openapi.yaml` og `schema.json`.
- Fane «Aktivitet» — siste 100 kall fra `pakkesystem_api_log`.

Rute registreres i `App.tsx`, meny-lenke i `SubAppNav.tsx` under Ordre → Innstillinger.

## 4. Dokumentasjons-artefakter (statiske filer i `public/pakkesystem/`)

- `schema.json` — JSON Schema 2020-12 for snapshot-formatet
- `openapi.yaml` — OpenAPI 3.1 for de 4 endepunktene
- `example-snapshot.json` — realistisk eksempel (10 kunder, 20 produkter, 50+ linjer)
- Kort README med Bearer-flyt og feilkoder

## Ikke inkludert nå
- Webhook ved endring (kan legges til senere ved å subscribe på `orders`-realtime i en scheduler-funksjon)
- Alternativ B (JSON-fil til OneDrive/SFTP)

## Filer som endres/opprettes
- Migrasjon: 2 tabeller + RLS + GRANTs
- `supabase/functions/pakkesystem-api/index.ts`
- `src/ordre/pages/PakkesystemApi.tsx`, `src/ordre/hooks/usePakkesystemKeys.ts`
- `src/App.tsx`, `src/components/layout/SubAppNav.tsx`
- `public/pakkesystem/{schema.json, openapi.yaml, example-snapshot.json, README.md}`
