# Fase B & C — Kundegrupper og Historikk

Innstillinger-index utsettes (ditt valg). Hentesteder ligger urørt på `/kunder/innstillinger/hentesteder`.

---

## Fase B — Kundegrupper (`/kunder/kundegrupper`)

Full CRUD for grupper, M2M til kunder, og default prisliste som arves når kunden ikke har egen `default_price_list_id`.

### Database
Ny migration (RLS lik `customers`/`sales_groups`-mønsteret, app-tilgang via `has_app_access('kunder')`):

```text
customer_groups
  id uuid pk
  legal_entity_id uuid not null
  code text not null            -- kort intern kode, unik per legal_entity
  display_name text not null
  description text
  color_hex text                -- for badge-tint, valgfritt
  default_price_list_id uuid → price_lists(id)
  sort_order int default 0
  status text default 'active'  -- 'active' | 'archived'
  created_at, updated_at, created_by

customer_group_members
  customer_id uuid → customers(id) on delete cascade
  group_id uuid → customer_groups(id) on delete cascade
  added_at timestamptz, added_by uuid
  primary key (customer_id, group_id)
```

Helper-view `customer_effective_price_list` (eller SQL-funksjon) som returnerer kundens prisliste etter prioritet:
1. `customers.default_price_list_id`
2. første gruppe med `default_price_list_id` (laveste `sort_order`)
3. NULL

Audit-trigger på begge tabeller som skriver til eksisterende `audit_log` (`source_app='kunder'`, `entity_type='customer_group'` / `'customer_group_member'`).

### UI
- **`src/kunder/pages/CustomerGroups.tsx`** — Liste-side:
  - Tabell: navn, kode, antall medlemmer, prisliste, status, handlinger.
  - Toolbar: søk, "Ny gruppe"-knapp, status-filter.
  - Klikk på rad → drawer/dialog med detalj.
- **`CustomerGroupEditor.tsx`** (Dialog) — opprett/rediger: navn, kode, beskrivelse, farge-picker, prisliste-select (henter fra `price_lists` der `status='active'`), sort_order.
- **`CustomerGroupMembers.tsx`** (panel i editor) — søkbar liste av kunder, multi-select for å legge til/fjerne. Viser hvor mange som faktisk vil arve prislisten (har ikke egen `default_price_list_id`).
- **`CustomerDetail.tsx`** — ny seksjon "Grupper" med badges (farge fra gruppen) og knapp for å legge til/fjerne grupper. Viser arvet prisliste hvis ingen er satt direkte.
- **`CustomerList.tsx`** — ny kolonne "Grupper" (badges, max 2 + "+N"), filter i toolbar.

### Hooks
- `useCustomerGroups()` — liste m/ medlems-count.
- `useCustomerGroup(id)` — detalj inkl. medlemmer.
- `useCustomerGroupMutations()` — create/update/archive/delete.
- `useCustomerGroupMembership(customerId)` — gruppene en kunde tilhører.
- `useCustomerEffectivePriceList(customerId)` — wrapper for view/funksjon.

### Routing
Erstatt `<KunderPlaceholder>` på `/kunder/kundegrupper` med `<CustomerGroups />` i `src/App.tsx`.

---

## Fase C — Historikk (`/kunder/historikk`)

Aggregert tidslinje på tvers av endringer (audit_log) og ordrer. Kunde-faktura-tabell finnes ikke (eksisterende `invoices` er leverandør­fakturaer) — så "faktura" representeres som ordrer med `status='invoiced'`. Dette flagges i UI-tekst.

### UI
- **`src/kunder/pages/CustomerHistory.tsx`**:
  - Toolbar: dato-range (default siste 30 dager), kunde-søk (combobox mot `customers`), bruker-filter (fra `audit_log.user_id`), type-filter (chips: "Endringer", "Ordrer", "Fakturerte ordrer", "Alle").
  - Tidslinje gruppert per dag, hver rad: tid, ikon (basert på type), tittel ("Henrik oppdaterte Slottsfjell Hotell" / "Ny ordre #12345 fra Kafé X"), diff-preview (klikk → expand for full `changes` jsonb-diff), lenke til entitet.
  - Tom-state hvis ingen treff.
- **`CustomerDetail.tsx`** — eksisterende "Historikk"-tab (eller ny hvis mangler) får samme tidslinje-komponent, men forhånds­filtrert på den kunden.

### Hooks/lib
- `useCustomerActivityFeed({ from, to, customerId?, userId?, types[] })` — kjører to parallelle queries:
  - `audit_log` der `entity_type in ('customer','customer_profile','customer_group','customer_group_member','pickup_location')` (og evt. `entity_id = customerId`).
  - `orders` join `customers` for ordre-events (created/invoiced).
  - Slår sammen, sorterer desc på timestamp, paginert (50 av gangen).
- `src/kunder/lib/activityFormatters.ts` — mapper rå rader til `{ icon, title, subtitle, diff?, href }`.

### Komponenter
- `ActivityTimeline.tsx` — gjenbrukbar (brukes både i global side og i kundedetalj-tab).
- `ActivityRow.tsx`, `ActivityDiff.tsx` (collapsible JSON-diff renderer).

### Routing
Erstatt `<KunderPlaceholder>` på `/kunder/historikk` med `<CustomerHistory />`.

---

## Designsystem
Alt bruker eksisterende semantic tokens, `AppBanner`, shadcn-komponenter og `brand-ink/cream/bronze` der relevant. Gruppe-farge lagres som hex men rendres som tint-badge (lav opacity bakgrunn + full farge tekst), aldri som store fyll. Ingen nye globale farger.

---

## Migrasjonsrekkefølge
1. SQL-migrasjon (tabeller + RLS + audit-triggere + view).
2. Hooks + types (Supabase-types regenereres automatisk).
3. UI-sider og komponenter.
4. Route-bytter i `App.tsx`.
5. Visuell QA i preview på `/kunder/kundegrupper` og `/kunder/historikk`.

Ingen breaking changes på eksisterende kundeliste/profil — kun additive felter og nye seksjoner.
