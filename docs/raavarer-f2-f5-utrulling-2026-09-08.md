# Råvarer F2/F5 — kode klar, utrulling gjenstår (8. sep 2026)

Utgangspunkt: `d09d6ec964ea768caedf6db0802ff3d578afc657` (arbeidet er bygget videre på siste
commit på NBOSv2). Ingen migrasjoner er kjørt, ingen edge-funksjoner er deployet, appen er
ikke publisert.

## Må rulles ut (i denne rekkefølgen)

1. `supabase/migrations-pending/20260908_f2_price_history_linewise.sql`
2. `supabase/migrations-pending/20260908_f5_count_and_receipt.sql`
3. Edge-funksjon `reconcile-invoice` (`supabase/functions/reconcile-invoice/index.ts` + `validate.ts`)

Filene ligger bevisst i `supabase/migrations-pending/`, ikke i `supabase/migrations/`, slik at
ingenting kjøres automatisk. Flytt dem inn i migrasjonsmappen når SQL-en er gjennomgått.
Etterpå må `src/integrations/supabase/types.ts` regenereres; da kan `src/ravarer/lib/pendingRpc.ts`
byttes ut med direkte `supabase.rpc(...)`-kall.

## Nye RPC-kontrakter

| Funksjon | Signatur | Rettigheter | Retur |
| --- | --- | --- | --- |
| `rm_reconcile_invoice` | `(p_invoice_id uuid) → jsonb` | `authenticated`, `service_role` | `{ok, already_reconciled, history_written, is_credit_note}` |
| `rm_stock_count_apply_v2` | `(p_op_id uuid, p_lines jsonb, p_note text) → jsonb` | `authenticated`, `service_role` | `{ok, adjusted, unchanged, rows[], op_id, already_applied?}` |
| `rm_receive_invoice_line` | `(p_line_id uuid) → jsonb` | `authenticated`, `service_role` | `{ok, already_posted, quantity_base}` |
| `fn_rm_price_history_upsert_line` | `(p_line_id uuid) → boolean` | kun `service_role` (intern) | true når en prisrad ble ført |
| `rm_apply_derived_cost_price` | `(p_raw_material_id uuid) → numeric` | kun `service_role` (intern) | gjeldende kostpris |

`p_lines` for tellingen: `[{raw_material_id, counted_base, expected_base, line_note}]`.
`expected_base` er beholdningen klienten viste; avvik stopper hele tellingen (SQLSTATE 40001).

## Hva som er gjort

### F2 — linjesporbar prishistorikk og atomisk avstemming
* `raw_material_price_history` får `invoice_line_id` (FK), `currency`, `is_credit`, `is_legacy`,
  `superseded_at`. Unik indeks på `invoice_line_id`, så samme råvare kan stå på flere linjer.
* Begge triggerne (`fn_invoice_line_match_price_history`, `fn_invoice_status_price_history`) er
  skrevet om til å kalle én felles linjefunksjon: `auto_medium` er med, `unit_price` brukes aldri
  som prisgrunnlag, linjer til gjennomgang og fremmed valuta hoppes over, kreditnota føres som
  `is_credit`.
* Gammel historikk beholdes, merkes `is_legacy` og settes `superseded_at` når en linjeført rad
  dekker samme faktura og råvare — ingen dobbelttelling, ingen sletting.
* `rm_reconcile_invoice` låser faktura + linjer (fast rekkefølge), krever `auth.uid()` og
  `has_ravarer_invoice_access(entity,'write')`, avviser flagget faktura, manglende leverandør,
  ikke-NOK, uavklarte linjer og råvarer i annet selskap, og er idempotent (bekreftet faktura gir
  `already_reconciled`). Status og historikk skrives i samme transaksjon.
* Kostpris avledes av `rm_apply_derived_cost_price`: nyeste ikke-kredit-rad fra primærleverandør,
  og manuell overstyring (`price_source = 'manual'`) røres aldri.
* Edge-funksjonen gjør ingen service_role-skriving lenger — den kaller RPC-en som innlogget bruker.
* Midlertidig blokkering av to ulike priser på samme råvare er fjernet, siden kontrakten nå
  håndterer det.

### F5 — telling og varemottak
* Nytt telleark `rm_stock_count_sheets` med grants, RLS (`has_position_in_entity` + skrivetilgang
  på `ravarer`/`lager`) og `updated_at`-trigger.
* `rm_stock_count_apply_v2`: fast låserekkefølge, konfliktkontroll mot `expected_base`,
  idempotens på operasjons-ID (både via telleark og unik bevegelse), linjenotat med i bevegelsen.
  Gamle `rm_stock_count_apply` er urørt.
* `rm_receive_invoice_line`: låser linje og faktura, kontrollerer tilgang og selskap, fører aldri
  en bevegelse på toppen av den fakturalinje-triggeren allerede laget, og snur aldri en negativ
  kreditmengde til positiv.
* Frontend: tellingen har stabil operasjons-ID i utkastet (overlever refresh og gjenopptak),
  sender forventet beholdning, viser konflikt som egen melding, og beholder utkastet ved feil.
  Varemottaket kaller RPC-en med fallback til dagens klientvei til den er rullet ut.

## Verifisering
`tsgo --noEmit` (0), `npx vitest run` 48 filer / 488 tester, `npm run build` (0),
`deno test --no-check` for `reconcile-invoice` 7/7, eslint rent på de berørte filene.

## Kjente begrensninger / gjenstående
* SQL-en er ikke kjørt mot databasen. Testene i `src/test/ravarerF2F5Migrations.test.ts` vokter
  reglene i teksten, men erstatter ikke en kjøring. Etter utrulling bør scenariene kjøres manuelt:
  falsk selskaps-ID, to linjer på samme råvare, kreditnota, eldre faktura, EUR, retry, samtidighet.
* F3 (per-felt provenance + full Matvaretabellen-nutrients/rawsource), F4 (vedvarende avtaleflyt
  med UI) og F6 (Tripletex toveis-kontroll) er IKKE gjort i denne runden.
* Frontend bruker `src/ravarer/lib/pendingRpc.ts` med ett kontrollert typeunntak til typene er
  regenerert.
* `rm_stock_count_apply_v2` skriver telleark-raden ved bokføring; løpende lagring av utkast til
  `rm_stock_count_sheets` fra klienten (i tillegg til localStorage) er ikke koblet på ennå.
