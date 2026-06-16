
# Kasse-gjennomgang og forbedringer

## Dagens oppsett (kort)

Kassen i `src/kiosk/pages/Kasse.tsx` rendres via `KioskRender` med:

- Topbar (terminal + operatør + "Avslutt skift" / "Logg av")
- Konfigurert tastatur-grid (produkt-, kategori-, funksjons-knapper)
- Kurv-panel med linjer, +/- og slett
- Dining-toggle (takeaway / eat-in / pickup)
- Footer-actions (rabatt, parker, kasseskuff, kvittering, kunde, henteordre, kakebygger, etikett)
- Betalingsmodal, kvittering, kakebygger, henteordre

Alt er styrt av tema-tokens (`--kiosk-*`) — ingen hardkodede farger. Hardware-mål: touch ≥15".

---

## Del A — Forbedringer i dagens (operatør-)kasse

Mål: redusere klikk, gjøre touch-targets tydeligere, korte ned betalingstid.

1. **Hurtig produkt-søk (overlay)**
    - Ny knapp i header: "Søk" (eller dedikert footer-action) som åpner et stort søkefelt med fokus
    - Søker mot `pos_keypad_buttons.display_label` + `products.display_number`/`display_name` for terminalens prisliste
    - Resultater som store touch-rader (≥56 px) — Enter eller tap = legg i kurv
    - Brukes når operatør ikke vil bla i kategorier

2. **Antall-justering uten dialog**
    - Long-press eller +N på kurvlinje åpner en numerisk overlay (0-9 + komma) for å sette eksakt antall/vekt
    - Reduserer +/+/+/+ klikk for løs vekt

3. **Kurv-tydelighet**
    - Sticky totalsum nederst i kurv (alltid synlig — også når kurv scrolles)
    - Større "Betal"-CTA med beløp inni knappen ("Betal kr 248,00")
    - Tydeligere dining-mode pill (aktiv state mer kontrastert)

4. **Footer-rydding**
    - Gruppe-ikoner: salg (rabatt, kunde, parker) | utskrift (kvittering, etikett, skuff) | spesial (henteordre, kakebygger)
    - Skjul disabled-actions istedenfor grå (mindre støy) — eller fjern hvis ikke konfigurert i tema
    - Tooltip + label under (ikke bare ikon) — operatører husker raskere

5. **Betalingsmodal**
    - Forhåndsvalgt vanligste metode (kort) når modal åpnes
    - "Eksakt"-knapp + raske beløp (200, 500, 1000, neste runde 50) for kontant
    - Vis vekslepenger med stor tall-typografi
    - Enter på tastatur = bekreft når beløp dekker totalen

6. **Skift-flow**
    - "Avslutt skift" flyttes ut av topbar (lett å trykke ved uhell) til en "Skift"-meny med skift-status, åpningsfloat og kort-knapper
    - Vis skift-tid + antall salg i header som passiv info

7. **Visuell hierarki**
    - Definere stort/medium/lite knapp-preset i tastatur-editor (allerede mulig via grid_w/h, men foreslå mal: "favoritter 2×2, vanlige 1×1")
    - Auto-skaler etikett-tekst etter knapp-størrelse (ikke kuttet på 1×1)

## Del B — Egen selvbetjent kunde-modus

Mål: kunde betjener selv → uten operatør-login, forenklet flyt, store mål.

### Ny route + entry-flag

- Ny rute `/kiosk/:terminalId/selvbetjent` (eller flagg på terminal: `pos_terminals.self_service_enabled`)
- Egen `SelfServiceKasse.tsx` som gjenbruker `CartProvider`, `useKeypadLayout`, `KioskRender`
- Skipper `OperatorLogin` og bruker en system-/terminal-operatør (eller null) for sesjons-RPC

### UI-forskjeller fra operatør-kassen

1. **Velkomst-skjerm**
    - Fullskjerm "Trykk for å starte" med brand-logo + språkvalg (NO/EN evt.)
    - Inaktivitets-reset: 60 s tilbake til velkomst hvis ingen interaksjon (med "Er du der?"-bekreftelse på 45 s)

2. **Forenklet header**
    - Kun brand + "Avbryt ordre" (rød, høyre)
    - Ingen terminalkode, ingen operatør, ingen "Logg av" / "Avslutt skift"

3. **Forenklet footer (kun kunde-actions)**
    - Kun: "Dining mode" toggle (takeaway / spise her), "Kvittering på e-post" toggle
    - Fjerner: rabatt, parker ordre, kasseskuff, kunde-søk, etikett-print, henteordre, kakebygger

4. **Tydelig kurv**
    - Større linjer (80–96 px høyde), produktbilde tvunget synlig
    - Store +/- knapper (≥56 px), "Fjern"-knapp med bekreftelse (ett uhell-tap = bekreft)
    - Sticky "Til betaling" CTA med totalsum

5. **Betaling**
    - Kun kort (BankAxept/Visa) — ingen kontant, ingen faktura, ingen split
    - Stor "Sett inn / tap kort"-instruksjon med animasjon
    - Auto-print kvittering (eller spør: "Trenger du kvittering?" → skriv ut / e-post / nei)

6. **Tilgjengelighet**
    - Stor font (min 18 px body, 24 px knapper)
    - Høy kontrast-tema preset
    - Touch-target min 56×56 px enforced i CSS

7. **Sikkerhet / misbruk**
    - Funksjons-knapper som "rabatt", "åpne skuff", "parker" er ikke tilgjengelig
    - "Avbryt"-knapp krever to-trinns bekreftelse hvis kurv > 0

### Tastatur-deling

- Selvbetjent bruker SAMME `pos_keypad_layouts` som operatør-terminalen, men:
    - Filtrerer ut knapper med `button_type='function'` der `function_code` ∈ {`discount`, `park_order`, `open_drawer`, `customer`, `label_print`} på render-tid
    - Eller (bedre): nytt felt `pos_keypad_buttons.self_service_visible boolean default true` så styring kan velge per knapp

### Konfigurasjon i POS Styring

- Ny tab i Terminaler: "Selvbetjent"
    - On/off toggle
    - Inaktivitets-timeout (sekunder)
    - Tillatte betalingsmåter (default: kort)
    - Auto-print kvittering: ja/nei/spør
- Ny tab i Tastatur-editor: "Skjul i selvbetjent" pr knapp

---

## Teknisk oppsummering

- **Front:** ny `src/kiosk/pages/SelfServiceKasse.tsx`, ny route i `src/kiosk/routes.tsx`, ny `IdleResetProvider`-hook, utvidelse av `KioskRender`-props (`mode: "operator" | "self_service"`) for å skjule/forstørre elementer
- **DB:** valgfri migrasjon for `pos_terminals.self_service_enabled` + `pos_terminals.self_service_config jsonb` + `pos_keypad_buttons.self_service_visible boolean`
- **RPC:** `pos_record_sale` må kunne kjøre uten operator_id (eller med en system-operatør tilknyttet terminalen) — sjekkes
- **Styring-UI:** Terminaler-detalj + TastaturEditor får nye felt

---

## Foreslått leveranse-rekkefølge

1. Del A pkt. 3 + 5 (kurv-tydelighet + betalingsmodal-forbedringer) — størst effekt, lite arbeid
2. Del A pkt. 1 (hurtig produkt-søk) — store gevinster for operatør
3. Del B grunnstruktur: ny route + `SelfServiceKasse` med filtrert UI og inaktivitets-reset
4. Del B konfigurasjon i POS Styring
5. Del A resten + polish

Si fra hvilke deler du vil prioritere først, så starter jeg der.
