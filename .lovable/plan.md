## Mål

Tre små justeringer før Steg 4: sikre tilgang til Fakturaer-appen og knytte Råvarer- og Fakturaer-detaljsider sammen via klikkbare lenker.

## 1. Tilgang til Fakturaer-appen

**Status sjekket:**
- `apps`-tabellen inneholder allerede `fakturaer` (status `active`).
- `position_app_access` har **ingen** rader for fakturaer-app-id'en `8685c890-…`.
- Min primær-stilling er `daglig_leder` (id `a1c040a2-…`), som allerede har `admin` på Råvarer/Varer.

**Migrasjon:** Gi `admin`-tilgang til Fakturaer for de samme stillingene som har admin på Råvarer (`daglig_leder`, `lageransvarlig`, `controller`/`fb328e43-…`), og `write` til `ordrekontor`. Bruk `INSERT … ON CONFLICT DO NOTHING` mot `position_app_access`.

## 2. Klikkbart fakturanummer i prishistorikk-tabellen

Fil: `src/ravarer/components/tabs/SuppliersTab.tsx` (linje 145–170).

- Utvid `usePriceHistory`-spørringen (i `useRmSuppliers.ts`, funksjonen feilaktig kalt `n`) til å hente `invoice_id` og evt. `invoices(invoice_number)` via join, så vi kan vise fakturanummeret når `source = 'invoice'`.
- I tabellen: erstatt "Notat"-kolonnen-visningen for invoice-rader med en `<Link to={"/fakturaer/" + h.invoice_id}>{invoice_number}</Link>` (eller egen kolonne "Faktura"). Bruk `react-router-dom` `Link` med `text-app underline-offset-2 hover:underline`-klasser. Cross-app nav er ren intern routing siden alle apper deler samme shell — samme pattern som `INTERNAL_ROUTES` i `AppTabs.tsx`.
- Ryd opp: gi `n` et meningsfylt navn (`usePriceHistory`) i samme slengen og oppdater eneste consumer.

## 3. Klikkbart råvarenavn på faktura-detaljsiden

Fil: `src/fakturaer/pages/InvoiceDetail.tsx`.

- Utvid `invoice_lines`-select til å hente `raw_material_id, raw_materials(id, name, sku)`.
- Bytt ut "Beskrivelse"-cellen til å rendre, hvis matchet:
  - `<Link to={"/ravarer/vareliste/" + l.raw_materials.id}>{l.raw_materials.name}</Link>` med subtle muted underline + originalbeskrivelse som liten grå tekst under.
  - Ellers fall tilbake til ren `description` som i dag.
- Sjekk faktisk routing-path i `App.tsx` for råvare-detalj — bekreft at det er `/ravarer/vareliste/:id` (basert på `RawMaterialDetail.tsx` som navigerer tilbake dit). Bruk den faktiske path.

## 4. "Se prishistorikk"-snarvei på matchede linjer

Samme fil. Legg til en ekstra kolonne lengst til høyre (eller en liten ikonknapp i SKU-kolonnen) — kun synlig når `raw_material_id` er satt:

```
<Button variant="ghost" size="icon" asChild>
  <Link to={"/ravarer/vareliste/" + rmId + "?tab=suppliers"} title="Se prishistorikk">
    <LineChart className="h-4 w-4" />
  </Link>
</Button>
```

For at lenken faktisk skal lande på prishistorikk-grafen: utvid `RawMaterialDetail.tsx` til å lese `?tab=` query-param og sette som `defaultValue`/`value` på `<Tabs>`. Liten endring, ingen state-mutasjon.

## Tekniske detaljer

- Ingen design-tokens brytes; bruk `text-app`, `text-ink-secondary`, `hover:underline`.
- Ingen ny routing — alt fungerer via eksisterende `BrowserRouter` siden Fakturaer og Råvarer deler shell.
- Migrasjonen er idempotent (`ON CONFLICT (position_id, app_id) DO NOTHING`).
- Ingen endringer i edge functions eller match-pipeline.

## Filer som endres

- `supabase/migrations/<ny>.sql` — gi posisjonstilgang til Fakturaer
- `src/ravarer/hooks/useRmSuppliers.ts` — rename `n` → `usePriceHistory`, hent `invoice_id` + `invoices.invoice_number`
- `src/ravarer/components/tabs/SuppliersTab.tsx` — bruk nytt navn + render fakturalenke
- `src/fakturaer/pages/InvoiceDetail.tsx` — hent `raw_materials`, gjør navn klikkbart, legg til prishistorikk-knapp
- `src/ravarer/pages/RawMaterialDetail.tsx` — les `?tab=` query-param

Etter dette kjører vi Steg 4 (faktura-godkjenning, prisavviks-håndtering).
