## Mål

Aktivere en per-kunde submeny "Varer stekt selv" i Kundeportalen der kunden registrerer hvor mye de har stekt **i dag**. Loggen brukes senere til klikk-og-hent tilgjengelighet på nettsiden og til å godkjenne returer.

## 1. Datamodell (Supabase-migrasjon)

**`customers`** — ny kolonne
- `bakes_own_products boolean not null default false`

**`products`** — to nye kolonner (kobler råvare/deig → ferdig salgsprodukt)
- `is_bakeable_raw boolean not null default false` — kan stekes selv av kunder
- `baked_product_id uuid null references products(id)` — ferdig produkt som selges/returneres når den råe er stekt

**`customer_bake_logs`** — ny tabell (én rad per kunde+produkt+dato)
- `customer_id`, `raw_product_id`, `baked_product_id` (snapshot), `bake_date date`, `qty numeric`, `registered_by_user_id`, `source text default 'portal'`
- UNIQUE `(customer_id, raw_product_id, bake_date)` — samme dag oppdaterer eksisterende rad
- GRANT + RLS: `authenticated` får ingenting direkte; all tilgang via portal-RPC. `service_role` full.

## 2. Portal-RPC-er (SECURITY DEFINER, scoped til `current_portal_customer_id()`)

- `portal_can_bake_own()` → boolean (leser `customers.bakes_own_products`)
- `portal_list_bakeable_products()` → produkter med `is_bakeable_raw = true` som finnes i kundens prisliste (samme filter som `portal_list_products`)
- `portal_upsert_bake_log(p_raw_product_id uuid, p_qty numeric)` → låst til `bake_date = current_date`; qty=0 sletter raden
- `portal_list_bake_logs(p_date date default current_date)` → dagens registreringer

## 3. NBOS — kundekort

`src/kunder/components/customers/…` (kundedetalj-panel): legg til seksjon "Kundeportal" med toggle **"Steker varer selv"** som skriver `customers.bakes_own_products`. Under toggle: kort forklaring + link til varekort-innstilling.

## 4. NBOS — varekort

`src/varer/…` produktdetalj: nytt panel "Selv-steking":
- Checkbox `is_bakeable_raw`
- Når aktiv: søkefelt for å velge `baked_product_id` (kobling til ferdig salgsprodukt for retur/salg)

## 5. Kundeportal (separat prosjekt — instruksjoner)

Ny rute `/varer-stekt-selv`:
- Vis i venstremeny kun når `portal_can_bake_own()` returnerer true
- Liste over bakeable produkter fra `portal_list_bakeable_products()`
- Per rad: antall-input som upserter mot `portal_upsert_bake_log` for dagens dato
- Viser dagens registrerte totaler; ingen historikk-redigering (kun i dag)

## 6. Forberedelse for senere faser (kun kommentert i migrasjonen, ikke implementert)

- **Klikk-og-hent**: nettsiden vil lese `customer_bake_logs` for gitt dato/utsalg og eksponere `baked_product_id` som tilgjengelig
- **Retur-godkjenning**: eksisterende retur-RPC vil senere sjekke at `baked_product_id` finnes i `customer_bake_logs` for kunden på den datoen retur gjelder

Retur-håndhevelse og klikk-og-hent er **ikke** en del av denne leveransen — kun datamodell og portal-registrering.

## Teknisk oppsummering

- 1 migrasjon: kolonner på `customers`+`products`, tabell `customer_bake_logs` (GRANT + RLS), 4 RPC-er.
- NBOS: toggle på kundekort, panel på varekort.
- Kundeportal-prosjekt: ny side + menylenke (leveres som instruksjon siden det er separat repo, samme mønster som tidligere portal-endringer).