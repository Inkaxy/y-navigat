# Råvarer 2.0 — designprinsipper

1. **Én handling, én komponent, én skrivevei.** Kobling går kun via `link-supplier-item`; prisaksept via `rm_supplier_item_accept_price`. Ingen parallelle varianter.
2. **Fem faste innganger:** Oversikt · Varer · Priskontroll · Leverandører · Lager (+ Innstillinger som ikon). Stier bygges kun med `src/ravarer/lib/paths.ts`.
3. **Gamle lenker virker.** `src/ravarer/lib/legacyRoutes.ts` oversetter gamle stier og query-parametre; testet i `legacyRavarerRoutes.test.ts`.
4. **Liste + peek-panel med URL-state.** Fane, filter og valgt rad ligger i adressen (`fane`, `valgt`, …) slik at lenker kan deles og tilbake-knappen virker.
5. **Neste handling er synlig.** Hurtigtaster J/K (flytt), Enter (åpne), `?` (hjelp). Vakten `shouldIgnoreShortcut` (felt, dialoger, modifikatorer) er felles for alle Råvarer-flater.
6. **Ett statusspråk.** Alle etiketter hentes fra `src/ravarer/lib/labels.ts`; ukjente koder vises som «Ukjent status», aldri rå kode. Test sikrer at alle kjente koder har etikett.
7. **Én kilde til tellere.** Meny og faner leser `rm_work_summary`. Alle mutasjoner som endrer arbeidsmengde kaller `invalidateRavarerCounts`.
8. **Rolig og tett.** Semantiske tokens (`--rm-*`, `--alert-*`), ingen hardkodede farger, ingen emoji. Arbeidsflater i Priskontroll er fullbredde.
9. **Mobil 390 px.** Menyen blir en nedtrekksliste, faner scroller vannrett, ikonknapper har `aria-label`.
10. **Sider bygges med primitivene** i `src/ravarer/ui/`: `ModulePage`, `SectionTabs`, `DataTable`, `SplitView`/`PeekPanel`, `ResultBox`, `ShortcutHelp`. Innebygde gamle sider skjuler egne overskrifter via `EmbeddedProvider`.
