# Plan: Tre forbedringer på Råvarer + Fakturaer

Stor leveranse delt i 4 deler. Jeg ber om godkjenning før jeg starter.

## Del 1 — Bulk-import av ukjente råvarer fra fakturalinjer (med AI)

### Backend
- Ny edge function `suggest-raw-material-fields`
  - Input: `{ legal_entity_id, lines: [{ line_id, description, sku, quantity, unit, unit_price }] }`
  - Henter AI-konfig fra `ai_provider_config` for `purpose='raw_material_suggestions'`. Fallback til `invoice_extraction`-konfig hvis kun én purpose finnes (admin kan opprette egen senere).
  - Bruker `_shared/ai-providers.ts` (`callAi`) med systemprompt fra spec.
  - Strukturert output via tool-calling: `{ suggestions: [{ line_id, sku, category, base_unit, confidence }] }`.
  - Logger til `ai_usage_log` med `purpose='raw_material_suggestions'`, model + token-stats.
- Ny edge function `bulk-import-raw-materials-from-invoice`
  - Input: `{ invoice_id, items: [{ line_id, name, sku, category, base_unit, package_size, package_unit, agreed_price_per_base_unit, set_primary }] }`
  - Verifiserer skrive-tilgang + invoice_access via eksisterende RPC.
  - For hver item, i én transaksjon:
    - Insert `raw_materials` (legal_entity_id fra invoice, current_cost_price, price_source='invoice', price_updated_at=now()).
    - Insert `raw_material_suppliers` (is_primary, agreed_price, agreed_price_per_base_unit, last_invoice_price, last_invoice_date).
    - Insert `raw_material_supplier_aliases` (sku + name som confirmed).
    - Insert `raw_material_price_history` (source='invoice', invoice_id).
    - Update `invoice_lines` (raw_material_id, match_confidence='manual', requires_review=false).
  - Returnerer `{ created: [{ raw_material_id, name }] }`.

### Migrasjon (kun hvis nødvendig)
- Sørge for at `ai_purpose` enum/check tillater `raw_material_suggestions` (sjekkes først).
- Seed `raw_material_categories` med "Importert – ikke kategorisert" per legal_entity (se Del 4).

### Frontend
- I `InvoiceDetail.tsx`: legg til checkbox-kolonne på umatchede linjer + sticky action-bar når valgt.
- Ny komponent `BulkImportRawMaterialsDrawer`:
  - Steg 1: kaller `suggest-raw-material-fields`, viser spinner.
  - Steg 2: tabell med inline-redigering (Navn, SKU, Kategori, Base unit, Pakningsstørrelse, Pakningsenhet, Pris/base_unit, Set primær). 🤖-badge på AI-felt.
  - Topp-handlere: "Bruk samme kategori for alle", "Bruk samme base unit for alle".
  - Footer: "Importer alle" / "Importer kun valgte" / "Avbryt".
- Samme tilgang fra `ReviewQueue.tsx` (behandlingskøen) på umatchede linjer.

## Del 2 — "+ Ny avtale"-knapp

- Ny komponent `NewAgreementDialog` med felt fra spec (autocomplete på råvare og leverandør, auto-beregning av pris/base_unit, opplasting av PDF til `supplier-agreements` bucket hvis denne finnes — ellers oppretter migrasjon den).
- Lagrer/upserter `raw_material_suppliers`. Hvis primær: nullstiller `is_primary` på øvrige rader for samme råvare.
- Knapp lagt til:
  - `Avtaler.tsx` (header).
  - `Leverandorer.tsx` (per leverandør-detaljside hvis eksisterer; ellers utelates fra denne PR).
  - `RawMaterialDetail.tsx` under "Leverandører & priser"-tab (`SuppliersTab`).

## Del 3 — "+ Ny leverandør"-knapp

- Ny komponent `NewSupplierDialog` med validering (org.nr 9 sifre, unik per legal_entity).
- Lagrer i `suppliers` med aktiv legal_entity.
- Knapp på `Leverandorer.tsx`. Etter lagring naviger til `/ravarer/leverandorer/:id` hvis detaljside finnes — ellers refresh listen og toast.

## Del 4 — "Importert – ikke kategorisert" + ufullstendige-rapport

### Migrasjon
- Sørge for at kategorien finnes per legal_entity (idempotent insert i `raw_material_categories` eller tilsvarende).

### Frontend
- I `Vareliste.tsx`: hvis det finnes råvarer i denne kategorien → banner "⚠️ N råvarer mangler kategori. [Vis dem]" som setter kategori-filter.
- Ny rute `/ravarer/vareliste/ufullstendige` → `IncompleteRawMaterials.tsx`:
  - 4 KPI-kort (totalt, mangler kategori, mangler næring, mangler allergen).
  - Tabell med kolonner og ✅/❌ for hvert manglende felt.
  - Default-filter: vis kun råvarer som mangler minst én ting.
  - Lenke fra Vareliste-banner og fra sidebar (sub-meny under Vareliste).

### Tilgang
- Alle handlinger krever `canWrite` på Råvarer.
- Bulk-import krever i tillegg `hasInvoiceAccess`.

## Tekniske detaljer

- Edge functions deployes med `verify_jwt=false` (default i prosjektet) og validerer JWT i kode via `auth.getUser()`.
- AI-kall bruker `_shared/ai-providers.ts`. Strukturert output via `tool_choice` der støttet, ellers `response_format: json_object`.
- Idempotens på bulk-import: hvis SKU allerede finnes for legal_entity → skip + returner advarsel pr linje.
- All UI bruker semantic tokens fra `index.css`/`tailwind.config.ts`. Ingen hardkodede farger.

## Rekkefølge

1. Migrasjon (kategori + evt. bucket).
2. Edge functions `suggest-raw-material-fields` + `bulk-import-raw-materials-from-invoice`.
3. `NewSupplierDialog` (enklest, ingen avhengighet).
4. `NewAgreementDialog`.
5. Bulk-import drawer + integrasjon i InvoiceDetail og ReviewQueue.
6. Vareliste-banner + ufullstendige-rapport + ny rute.

Si fra om du vil ha noen del prioritert eller utelatt, eller om jeg kan kjøre alt i ett.