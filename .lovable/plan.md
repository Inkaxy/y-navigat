# Fleksibel kasse-layout — Steg 5

Mål: gjøre kassen så fleksibel at de tre referansebildene (Baker Halvorsen, Hvasser Isbar, Nøttero Bakeri) kan bygges 1:1 fra `pos_keypad_layouts.theme`, uten kode-endringer per kunde. Editor får tilsvarende UI så styrings-brukeren kan styre alt selv.

## Hva endrer seg synlig

1. **Brand-blokk i toppen** — logo (asset eller tekst-monogram) + brand-navn + tagline/årstall. Tre header-stiler:
   - `minimal` (dagens — terminal-kode + label)
   - `branded_left` (logo + navn til venstre, klokke/operatør til høyre — Nøtterø)
   - `branded_centered` (brand-blokk venstre, brand-monogram høyre — Halvorsen / Hvasser)
2. **Hero dining-pills** øverst i produkt-området med ikon + sub-label («Sitt her — Spis hos oss» osv.). `diningPlacement` velges i tema: `cart_chip` | `top_hero` | `header_pills`.
3. **Rich kurv** — `cartStyle = "rich"` viser produkt-thumbnail (40×40), navn, +/- stepper, sletteknapp og linje-sum. `compact` beholder dagens stil.
4. **Funksjons-bar** — `footerActions` blir et tema-array av `{ code, label, icon, variant }`. Tre stiler:
   - `pill_grid` (dagens look, hele bredden)
   - `icon_card` (store ikon-kort, jf. Halvorsen)
   - `compact_row` (kompakt rad ved siden av kurv)
5. **Templates oppdateres** — alle tre maler får brand-felter, hero-pills, rich kurv (Nøtterø) og icon_card-footer (Halvorsen) slik at «Bruk mal» gir umiddelbar visuell parity.

## Teknisk

### A) `src/kiosk/render/kioskTheme.ts`
Legg til på `KioskTheme`:
```ts
brandName?: string | null;
brandTagline?: string | null;          // "ETAB. 1879", "Sandefjord 1951"
brandLogoUrl?: string | null;
brandMonogramUrl?: string | null;      // valgfri sekundær mark (mascot/seal)
headerStyle: "minimal" | "branded_left" | "branded_centered";
diningPlacement: "cart_chip" | "top_hero" | "header_pills";
diningPillStyle: "soft" | "outlined" | "solid";
cartStyle: "compact" | "rich";
cartShowImages: boolean;
cartShowStepper: boolean;
footerStyle: "pill_grid" | "icon_card" | "compact_row";
footerActions: Array<{ code: string; label: string; icon: string; variant?: "default" | "danger" }>;
```
`parseTheme` fyller defaults så eksisterende jsonb fortsatt parser. Defaults = dagens oppførsel (minimal header, cart_chip, compact kurv, pill_grid footer med 5 standard actions).

### B) `src/kiosk/render/KioskRender.tsx`
- Ny `BrandHeader` med tre layout-grener — bruker `brandLogoUrl` hvis satt, ellers tegner monogram fra `brandName[0]`.
- Ny `HeroDiningPills` rendret over `KeypadArea` når `diningPlacement === "top_hero"`. `header_pills` rendret inni headeren.
- `CartPane` får `style="rich"`-gren med thumbnail + stepper. Nye props: `onCartLineQtyChange(id, delta)`, `onCartLineRemove(id)`. `RenderCartLine` får `image_url?: string | null`.
- Ny `FooterActionBar` som driver de tre stilene basert på `footerActions`-array. `Kasse.tsx` mapper `code → handler`.

### C) `src/kiosk/pages/Kasse.tsx`
- Bygg `RenderCartLine.image_url` fra `productPrimaryPaths` / `productFallbackUrls` (allerede tilgjengelig).
- Send `onCartLineQtyChange` / `onCartLineRemove` til `KioskRender`.
- Bygg `footerActions`-handler-map (rabatt, merket_lapp, parker, slett, kvittering, etikett) og send `footerActions` fra tema til render.
- Erstatt manuell `footerSlot` med `KioskRender`-driven footer.

### D) `src/pos_styring/keypad/templates.ts`
- Hver mal får brand-felter, `headerStyle`, `diningPlacement`, `cartStyle`, `footerStyle` og `footerActions` som matcher referansebildet.
- Nøtterø: `branded_left` + `top_hero` + `rich` kurv + `compact_row` footer.
- Halvorsen: `branded_centered` + `top_hero` + `compact` + `icon_card` footer.
- Hvasser: `branded_centered` + `top_hero` (pastell pills) + `compact` + `pill_grid` footer.

### E) `src/pos_styring/pages/TastaturEditor.tsx`
Utvid «Tema»-fanen (eller åpner ny «Brand & layout»-seksjon) med felter:
- Brand-navn, tagline, logo-URL, monogram-URL (tekst-input + valgfri Asset-velger senere).
- Select: header-stil, dining-plassering, dining-pill-stil, cart-stil (med toggles for bilde/stepper), footer-stil.
- Reorder-liste for `footerActions` (dra-og-slipp eller opp/ned), pluss legg til / fjern fra preset-liste (rabatt, merket_lapp, parker, slett, kvittering, etikett, kunde, henteordre, kakebygger).
Lagring skriver hele `theme`-jsonb (allerede mønstret slik).

### F) Ingen DB-migrasjon
`theme` er allerede jsonb. `parseTheme` håndterer bakoverkompatibilitet.

## Verifisering
1. Åpne `/kiosk/o/22222222-...` (Nøtterø) — sjekk at brand-blokk, hero-pills, rich kurv og compact footer rendrer riktig.
2. Bytt mal til Halvorsen og Hvasser i TastaturEditor preview — bekreft 1:1 mot referansebildene.
3. Editor: endre brand-navn, footer-rekkefølge, dining-plassering → se live preview oppdatere.
4. Eksisterende layouts uten nye felter må fortsatt rendre identisk som i dag (defaults = gammel oppførsel).

## Ikke-mål for denne runden
- Asset-opplaster for logo (kommer egen runde — bruker URL-felt nå).
- Per-knapp swipe-til-slett-animasjoner og notat-felt på kurvlinjer (brukeren valgte «parity nå»).
- Pris-bytter ved dining-mode (brukeren valgte ikke «smart pills»).
