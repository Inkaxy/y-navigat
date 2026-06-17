## Mål
Bygg en arbeidsflyt for kakebilder: opplasting/demo → kø-liste med thumbnails → klikk → avansert editor → lagre → marker "ferdig redigert" → skriv ut enkelt eller flere samtidig (browser-print eller PDF).

## Datamodell (Lovable Cloud / Supabase)

Storage-bucket: `cake-images` (privat).

Tabell `public.cake_images`:
- `id uuid pk`
- `legal_entity_id uuid` (eier, fra brukerens aktive selskap)
- `delivery_date date` (knytter bildet til en dato i køen)
- `title text` (default filnavn)
- `customer_name text null`, `order_ref text null`, `notes text null`
- `source text` ('upload' | 'demo' | 'email' | 'ticket') default 'upload'
- `original_path text` (storage-key til opplastet bilde)
- `edited_path text null` (storage-key til redigert PNG fra editor)
- `editor_state jsonb null` (lerret-tilstand: lag, tekst, transform, brightness/contrast, crop, rotation, flip)
- `status text` ('venter' | 'ferdig_redigert' | 'skrevet_ut') default 'venter'
- `printed_at timestamptz null`, `print_count int default 0`
- `created_by uuid`, `created_at`, `updated_at`

RLS: alle authenticated brukere i samme `legal_entity_id` kan lese/skrive (følger eksisterende mønster i prosjektet). Service_role full tilgang. GRANTs som spec krever.

Storage-policies: authenticated kan lese/laste opp/slette objekter i `cake-images` der path starter med deres `legal_entity_id/...`.

Realtime aktiveres på `cake_images` slik at køen oppdateres når noen redigerer.

## Sider / komponenter

### 1. Dashboard (`/ordre/kakebilder`) — eksisterer
Oppdater til å hente live tellinger:
- `for_utskrift` = status in ('venter','ferdig_redigert') for valgt dato
- `skrevet_ut` = status='skrevet_ut' for valgt dato
Legg til knapp "Last opp bilde" og "+ Demo-bilder" (seeds 3 plassholder-bilder).

### 2. Liste (`/ordre/kakebilder/liste?date&status`)
Erstatt nåværende tom-tilstand med:
- Toolbar: Tilbake, dato, status-tabs (For utskrift / Skrevet ut), "Last opp", søk
- Bulk-bar (vises når noe er valgt): antall valgt, "Skriv ut valgte (browser)", "Last ned PDF", "Marker som skrevet ut", "Marker som ferdig redigert", "Slett"
- Grid av kort: thumbnail (edited_path hvis finnes, ellers original), checkbox, tittel, kunde, status-badge ("Venter" gul / "Ferdig redigert" grønn / "Skrevet ut" grå), liten knapp "Åpne editor". Klikk på kortet = åpne editor.
- Empty-state med "Last opp ditt første kakebilde".

### 3. Editor (`/ordre/kakebilder/editor/:id`)
Kopykake-inspirert layout, 3 kolonner:

```text
+--------+----------------------------+-----------+
| Venstre| Lerret (Fabric.js)         | Høyre     |
| panel  |                            | panel     |
|        |                            |           |
| Maler  |  [bilde + lag + tekst]     | Detaljer  |
| Bilder |                            | Lag       |
| Tekst  |                            | Justering |
| Cliprt |                            |           |
+--------+----------------------------+-----------+
| Bunn: Lagre · Lagre & marker ferdig · Skriv ut · Last ned PDF · Tilbake |
```

Topp-verktøylinje: Undo/Redo · Grid · Ruler · Større · Mindre · Roter · Speilvend · Slett valgt · Zoom-slider.

Venstre faner (Accordion):
- **Maler**: 1/4 ark landskap (10×7,5"), 1/4 ark portrett (7,5×10"), 8" rund, business cards 10-up. Bytt lerret-størrelse uten å miste lag.
- **Bilder**: Last opp nytt bilde-lag (storage), eller dra nåværende original inn.
- **Tekst**: dropdown forhåndsdefinerte stiler (Tittel/Undertittel/Etikett), tekst-input, "Legg til tekst". Når tekst er valgt: font, størrelse, farge, fet, kursiv, justering.
- **Clipart**: enkelt sett SVG-ikoner (brød, kake, pose, hjerte).

Høyre panel:
- Maldetaljer (ark/logo-størrelse)
- Lag-liste (drag-rekkefølge, vis/skjul, slett)
- Farge & lysstyrke (brightness/contrast/grayscale slider — Fabric image-filtre)
- Crop / rotate / flip (knapper)

Persistens:
- "Lagre" → serialiser `canvas.toJSON()` til `editor_state` + render PNG og last opp som `edited_path` (overskriver forrige).
- "Lagre & marker ferdig" → samme + sett `status='ferdig_redigert'`.
- Ved åpning: hvis `editor_state` finnes, lastes den; ellers initialiseres lerretet med original-bildet.

Utskrift:
- "Skriv ut" → åpner browserens print-dialog med kun lerretet (1 side, korrekt mm-størrelse via @page).
- "Last ned PDF" → genererer A4-PDF med lerretet sentrert (jsPDF + dataURL).

### 4. Bulk-utskrift fra listen
- "Skriv ut valgte" → ny rute `/ordre/kakebilder/print?ids=...` som rendrer hvert valgt bilde som egen side med `page-break-after`, kaller `window.print()` ved load.
- "Last ned PDF" → jsPDF, én side pr bilde, last ned `kakebilder-YYYY-MM-DD.pdf`.
- Begge oppdaterer `status='skrevet_ut'`, `printed_at=now()`, `print_count+1` etterpå.

## Tekniske detaljer

- Lerret: `fabric` (`bun add fabric@6` + `@types/fabric`). Velkjent API for lag, tekst, bilde-filtre, undo/redo via `canvas.toJSON()`-snapshots.
- PDF: `jspdf` (allerede installert? sjekkes — ellers `bun add jspdf`).
- Thumbnails: signed URL fra `cake-images` (privat bucket), 60s TTL, cached i query.
- Realtime: subscribe i listen så nye opplastinger / status-endringer vises live.
- Demo-seed: 3 statiske JPG-er pakkes som lovable-assets og kopieres inn i bucket ved "Legg til demo-bilder".

## Filer som lages/endres

Nye:
- `supabase/migrations/<ts>_cake_images.sql` — tabell, RLS, GRANTs, storage-policies, realtime
- `src/ordre/lib/cakeImages.ts` — typer, queries, mutations, signed URLs
- `src/ordre/hooks/useCakeImages.ts` + `useCakeImage.ts`
- `src/ordre/pages/CakeImageEditor.tsx`
- `src/ordre/pages/CakeImagesPrint.tsx` (bulk print-rute)
- `src/ordre/components/cake-images/CakeImageCard.tsx`
- `src/ordre/components/cake-images/UploadButton.tsx`
- `src/ordre/components/cake-images/editor/{Toolbar,LeftPanel,RightPanel,CanvasStage,LayersList}.tsx`
- `src/ordre/components/cake-images/editor/templates.ts`

Endres:
- `src/ordre/pages/CakeImagesDashboard.tsx` (live tellinger + opplasting)
- `src/ordre/pages/CakeImagesList.tsx` (grid + bulk + opplasting)
- `src/ordre/lib/routes.ts` (legg til `kakebilderEditor`, `kakebilderPrint`)
- `src/App.tsx` (to nye ruter)

## Leveranseplan (denne meldingen)
Implementer alt i én runde: migrering + bucket, datalag, dashboard live, liste m/ bulk, editor (Fabric.js) med lagring, browser-print og PDF (enkel + bulk), demo-seed-knapp.
