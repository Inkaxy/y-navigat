# Plan: PDF-deklarasjon + bilder + egen AI-konfig

## Oversikt

Tre sammenhengende deler:
1. **Bildeopplasting pr vare** (utvider `products.image_url`)
2. **PDF-tolking av deklarasjon/næring** med AI → forhåndsvisning → godkjenning → lagres som manuell overstyring på produktet (`product_recipe_links.manual_*`)
3. **Egen AI-konfig** under Varer-innstillinger (provider + modell + secret), med Lovable AI som default

## Del 1 — Bilde pr vare

**Storage**
- Ny public bucket `product-images` (RLS: alle kan lese, kun innloggede kan skrive til `<product_id>/...`)

**UI**
- Nytt kort "Bilde" i `VaredetaljerTab.tsx`:
  - Drag-and-drop / fil-velger (jpg/png/webp, max 5 MB)
  - Forhåndsvisning av nåværende `image_url`
  - "Erstatt"-knapp / "Fjern bilde"
- Ved opplasting: upload til `product-images/<product_id>/<timestamp>.<ext>` → `getPublicUrl` → `update products set image_url = ...`

## Del 2 — PDF-deklarasjon med AI

**Storage**
- Ny bucket `declaration-uploads` (privat, brukes kun midlertidig under tolkning)

**Edge function: `parse-declaration-pdf`**
- Input: `{ product_id, file_path }` (storage-path til opplastet PDF)
- Henter PDF fra Storage med service-role
- Leser AI-konfig fra `platform_settings` (category=`varer_ai`, key=`provider_config`)
- Velger endpoint:
  - `lovable` → `https://ai.gateway.lovable.dev/v1/chat/completions` med `LOVABLE_API_KEY`
  - `openai` → `https://api.openai.com/v1/chat/completions` med `CUSTOM_AI_API_KEY`
  - `anthropic` → Anthropic-API
  - `custom` → bruker `base_url` fra config
- Sender PDF som base64 + tool-call schema for strukturert output:
  ```
  { ingredient_declaration: string,
    nutrition_per_100g: { energy_kj, energy_kcal, fat_g, saturated_fat_g, carbs_g, sugars_g, fiber_g, protein_g, salt_g },
    allergens_contains: string[],
    allergens_may_contain: string[],
    confidence: { ingredient: number, nutrition: number, allergens: number },
    notes: string }
  ```
- Default modell: `google/gemini-2.5-pro` (best multimodal for tabeller)
- Returnerer parsed JSON + confidence-scores

**UI — ny seksjon i `DeclarationTab.tsx`**
- Knapp "Last opp PDF for AI-tolking" (over modus-velger)
- Klikk → Dialog:
  1. Drag-and-drop PDF
  2. "Tolker …" spinner mens edge function kjører
  3. Forhåndsvisning av AI-resultat (3 kolonner: Ingrediens / Næring / Allergener) med confidence-badges
  4. Side-ved-side: "Nåværende verdi" vs "AI-forslag"
  5. Brukeren kan redigere felter inline før godkjenning
  6. Knapper: "Avbryt" / "Godkjenn og lagre"
- Ved godkjenning:
  - Set `declaration_mode = 'manual'` på `product_recipe_links`
  - Skriv `manual_ingredient_declaration`, `manual_nutrition`, `manual_allergen_summary`
  - Logg til `audit_log` (action: `ai_declaration_imported`, source-PDF-path som metadata)
  - Slett midlertidig PDF fra `declaration-uploads`
  - Toast + invalidate queries

## Del 3 — Egen AI-konfig under innstillinger

**DB**
- Bruker eksisterende `platform_settings`-tabell
- Ny rad: `category='varer_ai'`, `key='provider_config'`, `value = { provider, model, base_url? }`

**Secrets**
- `CUSTOM_AI_API_KEY` (legges til via secrets-tool når bruker velger noe annet enn `lovable`)

**UI — ny side `/varer/innstillinger/ai`** (eller kort på eksisterende side)
- Kort "AI for PDF-tolking":
  - Select: provider (`Lovable AI (default)`, `OpenAI`, `Anthropic`, `Annet (kompatibel API)`)
  - Input: modell (free text, med eksempler basert på provider)
  - Input: base_url (kun synlig for `Annet`)
  - Hvis ikke `Lovable`: knapp "Sett API-nøkkel" → trigger `add_secret` for `CUSTOM_AI_API_KEY`
  - "Lagre"-knapp
  - Status: viser om secret er konfigurert eller mangler
- Default ved ny installasjon: `{ provider: 'lovable', model: 'google/gemini-2.5-pro' }`

## Tekniske detaljer

**Migrations**
1. Opprett buckets `product-images` (public) og `declaration-uploads` (private) + RLS-policies
2. Ingen schema-endringer på `products` eller `product_recipe_links` — alt finnes allerede

**Edge functions**
- `parse-declaration-pdf` (ny, `verify_jwt = true`)

**Filer som endres/opprettes**
- ny: `supabase/functions/parse-declaration-pdf/index.ts`
- ny: `src/varer/components/products/PdfDeclarationImportDialog.tsx`
- ny: `src/varer/components/products/ProductImageUpload.tsx`
- ny: `src/varer/pages/settings/SettingsAI.tsx` + route
- endret: `src/varer/components/products/DeclarationTab.tsx` (legg til import-knapp)
- endret: `src/varer/components/products/detail/tabs/VaredetaljerTab.tsx` (legg til bilde-kort)
- endret: `src/varer/pages/settings/SettingsLayout.tsx` (ny menypunkt "AI")
- endret: `src/App.tsx` eller varer-routes (ny route)

## Avgrensninger (ikke i scope nå)

- Galleri / flere bilder pr vare (kan utvides senere ved behov)
- Bulk-import av flere PDF-er
- Auto-OCR av skannede bilder (PDFs forutsettes maskingenererte; AI håndterer enkel OCR via multimodal)
- Versjonering/historikk av tidligere AI-importer (kun audit_log-innslag)
