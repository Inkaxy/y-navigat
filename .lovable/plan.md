## Mål
Produktknappene på POS-kiosken viser produktets primærbilde (fra `pos_product_images`) som bakgrunn på knappen, automatisk og uten at admin må lime inn URL. Bildene må fortsette å virke etter 1 time (dagens implementasjon lagrer en signed URL i `pos_keypad_buttons.image_url` som utløper).

## Hva vi har i dag
- `pos_keypad_buttons.image_url` (tekst) brukes både i editor-preview og kiosk-render.
- Editor (`TastaturEditor.tsx`) henter primærbildet fra `pos_product_images` ved opprettelse, signerer en URL (1t TTL) og lagrer signed URL direkte i `image_url`. Etter ~1 time blir bildet borte i kiosken.
- Kiosk (`KeypadGrid.tsx`) viser `b.image_url` som `<img>` med `max-h-12` — lite synlig.
- Storage-bucket `pos-product-images` har SELECT-policy som krever `has_position_in_entity(...)`. Kiosk-brukere har ingen `user_positions`-rader, så de kan ikke signere/lese objekter direkte fra kiosk-sesjonen.

## Endringer

### 1. Skjema: skill mellom "manuell URL" og "produktbilde"
Migrering på `public.pos_keypad_buttons`:
- Ny kolonne `image_storage_path text null` (peker inn i bucket `pos-product-images`).
- Behold `image_url` for eksterne URL-er / overstyringer.
- GRANTs/RLS uendret (samme tabell, ingen nye policies).

### 2. Storage-policy: la kiosk-sesjoner lese pos-product-images
Ny SELECT-policy på `storage.objects` for `pos-product-images`:
- Tillat lesing til `authenticated` når brukeren er en aktiv kiosk-bruker på en terminal i samme `legal_entity_id` som filens path-prefix (samme `extract_legal_entity_id_from_path(name)`-konvensjon).
- Definert via en ny SECURITY DEFINER `has_kiosk_access_to_entity(uuid)` som matcher `pos_kiosk_users` ↔ `pos_terminals.legal_entity_id`.
- Eksisterende admin-policy (`has_position_in_entity`) beholdes, ny policy er additiv.

### 3. Editor (`src/pos_styring/pages/TastaturEditor.tsx`)
- Lagre `image_storage_path` (ikke signed URL) når brukeren velger "bruk produktets primærbilde".
- Vis preview ved å signere `image_storage_path` on demand (samme `getKeypadSignedUrl`).
- UI: i knapp-dialogen, erstatte "Bilde-URL"-feltet med to valg:
  - **Produktbilde** (default for produktknapper) — leser primærbildet fra `pos_product_images`. Knapp "Bytt bilde" → liste over alle bilder for produktet, velg én.
  - **Egendefinert URL** — fritt tekstfelt (`image_url`), brukes fortsatt for funksjons-/kategori-knapper.
- Auto-fyll ved opprettelse: sett `image_storage_path` til primærbildets path (i stedet for signed URL i `image_url`).

### 4. Kiosk-runtime (`src/kiosk/hooks/useKeypadLayout.ts` + `KeypadGrid.tsx`)
- Utvid `KeypadButton`-typen med `image_storage_path`.
- I `useKeypadLayout`: etter at knappene er hentet, samle unike `image_storage_path` og kall `kioskSupabase.storage.from('pos-product-images').createSignedUrls(paths, 3600)` i batch. Returner et `Map<path, signedUrl>` i query-resultatet.
- I `KeypadGrid`: render-prioritet `signedUrl(image_storage_path) ?? image_url`. Vis bildet som **bakgrunn på hele knappen** (cover) med en mørk gradient nederst og label over — i tråd med brand-design (ingen hardkodede farger, bruk `--brand-ink`/`--brand-cream` overlay-tokens). Behold gjeldende layout når ingen bilde finnes.
- Re-signering: react-query med `staleTime: 50 min` matcher TTL på 60 min.

### 5. Migrering av eksisterende data
Engangs-SQL i samme migrasjon:
- For hver `pos_keypad_buttons`-rad med `button_type='product'` og `image_storage_path IS NULL`: sett `image_storage_path` = `(SELECT storage_path FROM pos_product_images WHERE product_id = b.product_id AND is_primary LIMIT 1)`.
- Nullstill `image_url` der den inneholder en utløpt signed URL (heuristikk: inneholder `/storage/v1/object/sign/pos-product-images/` og `token=`).

## Out of scope
- Beskjæring/cropping av produktbilder i editor.
- Opplasting av nye produktbilder fra tastatur-editoren (gjøres i Produkter-modulen).
- Caching i Service Worker for offline-kiosk.
