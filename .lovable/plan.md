# Ordre — visuell redesign (kun utseende)

Mål: Gi ordre-appen et varmt, håndverksbasert "Nøtterø Bakeri"-uttrykk inspirert av emballasje, etiketter og papirposer. **Ingen funksjonell endring** — alle knapper, felt, filtre, menyer, statuser, kolonner, handlinger og data­visning forblir identisk. Kun layout, kort, spacing, typografi, rammer, ikoner og overflater endres.

## Designspråk (anvendelse av eksisterende brand-tokens)

Bruker tokens som allerede finnes i `index.css` / `tailwind.config.ts` — ingen nye farger:

- **Canvas**: `--surface-canvas` (papir-cream) med eksisterende subtil prikket papir-tekstur (allerede aktiv på `body`).
- **Kort/paneler** = "papirlapper": `--surface-raised`, `rounded-[14px]`, tynn `--brand-bronze/20` border + indre `--brand-cream/40` ring (allerede definert i `Card`).
- **Eyebrows / labels** = etikett-aktige: utility-klassen `.label-rule` (bronze, uppercase, 0.24em letter-spacing, tynne sidelinjer) og `.eyebrow` for mindre seksjonstitler.
- **Overskrifter**: `font-display` (Fraunces) for sidetittel + dialog-titler; `Inter` 600 for tabell-headers og knapper (uendret).
- **Stempel-frame**: `.stamp-frame` på status-badges og dato-tabs der det gir mening (subtil dobbel-ring som ligner et stempel-aftrykk).
- **Diamond-mønster**: `.pattern-diamond-soft` som veldig svak bakgrunn på utvalgte tomme tilstander / sticky-headers.
- **Skygger**: `shadow-card` / `shadow-elevated` (varme, organiske) i stedet for harde grå skygger.
- **Eksisterende app-farger og status-farger beholdes 1:1** (gul = fastordre, lilla = retur, blå = pakkseddel, rød = destructive, grønn = success). Disse brukes som fyll/aksent som i dag.

## Berørte filer (kun presentasjon)

```text
src/ordre/components/shell/PageHeader.tsx       — etikett-stil header
src/ordre/components/shell/AppBanner.tsx        — wrapper, ingen API-endring
src/ordre/components/shell/DateContextChips.tsx — chips som "tape-tabs"
src/ordre/components/orders/StatusBadge.tsx     — stempel-look
src/ordre/components/ui/status-pill.tsx         — papir-pill med tynn ring
src/ordre/pages/Dashboard.tsx                   — kort som "etikettpaneler"
src/ordre/pages/OrdersList.tsx                  — listrader som papir-strimler
src/ordre/pages/OrderDetail.tsx                 — seksjoner som "pakkseddel-paneler"
src/ordre/pages/Leveringskalender.tsx           — matrise: header som etikett-strip,
                                                   kolonne-ikoner i tape-rad,
                                                   sticky "Handling"-pille
src/ordre/pages/NewOrder.tsx                    — handlekurv-panel + linjer
src/ordre/pages/DeliveryNoteDashboard.tsx       — runde-kort som "stempel-kort"
src/ordre/pages/DeliveryNoteDetail.tsx          — pakkseddel som faktisk seddel
src/ordre/pages/RecurringOrders.tsx             — kort-grid med etikett-feel
src/ordre/pages/Tours.tsx, DeliveryRules.tsx,
  CustomerOrders.tsx, DeliveryNotesList.tsx,
  DeliveryNoteCorrections.tsx,
  DeliveryNoteSettings.tsx                      — samme språk konsistent
src/ordre/components/orders/CustomerOrderModal.tsx,
  MerknadDialog.tsx, ChangeTourDialog.tsx, m.fl. — dialog-shell-stil
src/ordre/components/orders/matrix/*.tsx        — kolonne-ikoner, dialoger
```

Ingen DB-endringer. Ingen hooks-endringer. Ingen RPC-endringer. Ingen routing-endringer.

## Konkret per side

**Leveringskalender (matrise) — hovedjobb**
- Topbar (Kunde + Ordre fra dato + dager + turer + retur + Ny ordre + Handling) pakkes inn i et "papir-panel" med tynn bronze-border + indre cream-ring og soft skygge — samme felter, samme rekkefølge.
- "Lagre / Avbryt" sentrert som i dag, men knappene får eksisterende `brand`/`outline`-varianter med en hårfin bronze-aksent under aktiv hover.
- Kolonne-headers blir til "etikett-strips": dato + ukedag i `font-display`, bronze-divider over, dagens kolonne får en bronze underline i stedet for gul fyll (gul fyll beholdes som "har ordre"-indikator nederst i header).
- Ikon-raden (Copy / Comment / Delete / Pakkseddel) får mer luft, hover-tint i bronze, og tooltips med ink-bg.
- Tabellrader: alternerende `--surface-raised` / `--surface-canvas` med 1px `--border-subtle` — føles som papir-linjer, ikke admin-grid.
- "Vis sammendrag" / "Vis hele varenavn" / "Skjul erstattede" (gear-meny) får dropdown med ink-bg + cream tekst som per memory.
- Vær-ikoner beholdes uendret men temperaturen settes i `font-display`.
- Sticky "Handling"-knapp og "Ny ordre" beholder fargene (grønn brand-CTA fra dagens stil bevares — disse er funksjonelle signaler), men får rounded-[10px], shadow-card og bronze focus-ring.
- Dato-chips ("i dag / fra i morgen / denne uken / neste uke") får `.label-rule`-typografi.

**NewOrder / OrderDetail**
- Handlekurv-tittel "Ordre for {kunde} ({nr})" får `font-display` + lite bronze cart-emblem.
- "Lørdag 09.05.2026 - tur 1 (ekstra)" formes som en stempel-rad: tynn dobbeltlinje (stamp-frame) + dato i `font-display`.
- "Ny ordrelinje"-input får cream-bg, bronze focus-ring.
- Pris-summering får etikett-look: `.eyebrow` over "Pris ordre", verdier i `font-display tabular-nums`.
- "Slett / Lag pakkseddel / Kopiere ordren" beholder fargene (rød/gul/outline) — samme `Button`-varianter som i dag.

**Dashboard / DeliveryNoteDashboard**
- "FASTORDRE / DATERTE / RETUR / PAKKSEDLER"-kortene beholder farger 1:1 men får `stamp-frame`-ring, `font-display` tall og `.eyebrow` for label.
- Info-bånd ("Hovedkjøring er kjørt for turer: 1, 2, 3", "Leveransepauser ...") blir cream-tape med bronze-ramme i stedet for blå/grønn rektangel — fargene beholdes som tynn venstre-bord (color-strip).

**Pakkseddel-detalj**
- Ligner en faktisk seddel: cream-papirlap med bronze stempel-ring rundt tittel, monospace-aktig tall-kolonne, tynne stiplede linjer mellom rader.

**Lister (OrdersList, RecurringOrders, CustomerOrders, DeliveryNotesList, Tours, DeliveryRules)**
- Toolbar over listen samles i et papir-panel.
- Rader får mer vertikal luft, kundenavn i `font-display`, sekundærdata i `text-muted-foreground tabular-nums`.
- Status-badges via felles `StatusBadge`/`StatusPill` får stamp-look (tynn ring + uppercase 10px letter-spaced label) — fargene styres fortsatt av dagens token-mapping.

**Dialoger (Ordreinfo, Merknad, Pris-regulering, Endre tur, Slett, m.fl.)**
- Dialog-header: `font-display` tittel, `.label-rule` evt. underrubrikk.
- Tabellaktige innhold (Pris-regulering / Reguler fastordre): rader med papir-linjer, input-felt med cream-bg + bronze focus.
- Bekreft-knapp = `brand` (bronze), avbryt = `outline`.

## Teknisk

- Kun klasser, små JSX-wrappers og typografi-bytter. Ingen logikk-endringer, ingen prop-API-endringer, ingen nye avhengigheter.
- All farge går via tokens (`bg-card`, `bg-background`, `text-foreground`, `border-border`, `text-primary`, `bg-warning`, osv.) — ingen hardkodede HEX/HSL.
- Knapp-varianter beholdes (`default` = app-primary, `brand`, `destructive`, `outline`, `secondary`, `ghost`).
- Status-tokens i `orderStatus.ts` og `deliveryNoteStatus.ts` røres ikke — bare `StatusPill`-rendringen pyntes.
- Ingen endringer i `index.css` eller `tailwind.config.ts` utover evt. én ny utility (`paper-row` for alternerende stripe) hvis nødvendig.

## Out of scope

- Mobil-redesign (kommer som egen fase).
- Logikk, RPC, hooks, ruter, data, beregninger, tilstand — uendret.
- Ingen endring av app-farger eller status-farger.
- Ingen AI / nye features.

## Verifikasjon

- Visuell sjekk i preview på 1434×1097 av: Leveringskalender, NewOrder, OrderDetail, Dashboard, DeliveryNoteDashboard, OrdersList, RecurringOrders, en pakkseddel, en ordreinfo-dialog, og pris-regulerings-dialog.
- Bekreftelse at alle eksisterende knapper/felt/menyer fortsatt finnes på samme sted med samme labels.
- Spot-check at dark-mode fortsatt fungerer (UserMenu-toggle).
