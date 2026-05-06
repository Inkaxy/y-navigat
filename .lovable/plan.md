# Datablad-håndtering for råvarer

Stort steg som binder sammen datablad-opplasting, AI-ekstraksjon, changelog og oppskrifts-flagging. Bygges i én pulje, men UI rulles ut tab-for-tab så vi kan teste underveis.

## Omfang (definition of done)

- Last opp ett datablad pr råvare → AI foreslår oppdatering av næring, allergener, sammensetning, brødskala
- Bulk-opplasting (≤100 PDF/bilder) med matching mot eksisterende råvarer (navn/SKU/leverandør) eller "opprett ny"
- Versjonert lagring av datablad + changelog med side-by-side gammel vs ny
- Berørte oppskrifter flagges `declaration_needs_review`
- Ny side `/ravarer/datablad-endringer` med bekreftelsesflyt + sidebar-badge
- AI-foreslåtte allergener ved manuell ny råvare (uten datablad)
- Versjonshistorikk-modal på råvare-detalj
- Alle AI-kall logges i `ai_usage_log` med `purpose`

## Datamodell (migrasjon)

```text
raw_material_datasheets
  id, raw_material_id, version, file_url, file_hash,
  uploaded_by, uploaded_at, supplier_name, sku,
  ai_extracted jsonb, ai_model, ai_confidence,
  is_current bool, replaced_by uuid

raw_material_changelog
  id, raw_material_id, datasheet_id,
  change_type (allergen_added|nutrition_changed|composition_changed|grain_changed|package_changed|created),
  field, old_value jsonb, new_value jsonb, severity (high|medium|low),
  affected_recipes_count int, acknowledged bool,
  acknowledged_by, acknowledged_at, created_at

datasheet_upload_batches
  id, uploaded_by, total_files, processed, status, created_at

products: ny kolonne declaration_needs_review bool default false
ai_usage_log: utvid purpose-enum med datasheet_extract, datasheet_match, allergen_suggest, composite_suggest
```

Storage-bucket `raw-material-datasheets` (private, RLS: medlemmer av legal entity kan lese; skrive-rolle på Råvarer-app kan opp/oppdatere).

## Edge functions

| Funksjon | Formål |
|---|---|
| `extract-datasheet` | Tar PDF/bilde, kaller Lovable AI (gemini-3-flash-preview, vision), returnerer strukturert jsonb: nutrition pr 100g, allergener, ingrediensliste, sammensetning, brødskala-hint, leverandør, SKU, pakningsstørrelse. Logger til `ai_usage_log`. |
| `match-datasheet-to-raw-material` | Bulk: for hvert ekstrahert datablad, finn beste match (navn fuzzy + SKU + supplier). Returnerer match-kandidat + confidence + "create_new" fallback. |
| `apply-datasheet-update` | Tar bekreftet datablad → diff mot gjeldende råvare → skriv changelog-rader, oppdater `raw_materials`/`raw_material_nutrition`/`raw_material_allergens`/`raw_material_components`/`grain_classification`, marker berørte produkter `declaration_needs_review=true`. |
| `suggest-raw-material-allergens` | Navn → sannsynlige allergener m/ confidence (lett gemini-flash-lite-kall). |

Alle krever skrive-tilgang til Råvarer-appen (sjekk via `has_app_access`).

## UI

**Råvare-detalj → "Næring & deklarasjon"-tab**
- Drag-and-drop "Last opp datablad" → kaller `extract-datasheet` → viser side-by-side diff med 🤖-merkede forslag → "Godta alle"/"Velg felter" → `apply-datasheet-update`
- "Vis versjonshistorikk"-lenke åpner modal med tidslinje fra `raw_material_changelog` filtrert på råvaren

**Ny side `/ravarer/datablad-bulk`**
- Drop-zone (≤100 filer), progress pr fil, batch i `datasheet_upload_batches`
- Resultat-tabell: filnavn, foreslått match (m/confidence), aksjoner: Bekreft / Velg annen råvare / Opprett ny / Hopp over
- "Bekreft alle høy-konfidens" knapp

**Ny side `/ravarer/datablad-endringer`**
- Filter: status (uavklart/bekreftet), siste 30 dager, severity
- Liste-rader med ikon (🔴 high/🟡 medium/⚪ low), beskrivelse, antall berørte oppskrifter, [Vis] [Bekreft]
- Detalj-drawer: side-by-side gammelt vs nytt datablad, liste over berørte produkter med "Re-generer deklarasjon"-knapp pr rad
- Sidebar i Råvarer-app: nytt tab "Datablad-endringer" med count-badge (uavklart høy+medium)

**"Ny råvare"-modal**
- Etter navn-input: kaller `suggest-raw-material-allergens` debounced → forhåndshukker allergen-checkboxes med 🤖-badge + confidence-tooltip

**Sammensatte råvarer + brødskala**
- `extract-datasheet` returnerer `composite_components[]` og `grain_classification_hint` → forslags-flagg `needs_review=true` på `raw_material_components` til bruker bekrefter
- Brødskala-dropdown forhåndsvelges fra hint

## Tilgangskontroll

- Opplasting/bekreftelse: `has_app_access(uid, 'varer', 'write')`
- Rå AI-data + confidence: kun `admin`-rolle (egen RLS på `ai_usage_log` for SELECT av `raw_response`)

## Rollout-rekkefølge i denne puljen

1. Migrasjon + storage-bucket + RLS
2. `extract-datasheet` + `apply-datasheet-update` + diff-logikk
3. Single-upload på råvare-detalj + versjonshistorikk-modal
4. Changelog-side + sidebar-badge + flagging av produkter
5. `suggest-raw-material-allergens` + integrasjon i ny-råvare-modal
6. Bulk-upload-side + matcher
7. Sammensatt + brødskala-hint i ekstraksjon

Si "fortsett" så starter jeg med migrasjon.
