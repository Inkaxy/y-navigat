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

## IA-kart

```text
/ravarer                         Oversikt (Hva venter · Skjedde automatisk · Prisbevegelser · Datakvalitet)
/ravarer/varer                   Varer: Alle varer · Pakninger · Deklarasjonsnavn · Næring · Datablad-endringer
  /varer/:id                     Råvarekort
  /varer/matvaretabellen, /varer/datablad-opplasting
/ravarer/priskontroll            ?fane= gjore (Å gjøre) · fakturaer (visning=innboks|alle) · godkjenning · saker
  /priskontroll/faktura/:id      Fakturadetalj (+ /registrer-linjer)
  /priskontroll/import           Importer faktura (?tab=ehf|pdf|manuelt)
  /priskontroll/beslutninger(/:key), /priskontroll/saker/:id, /priskontroll/verktoy/reberegn
/ravarer/leverandorer            ?fane= leverandorer · avtaler · forhandlinger
  /leverandorer/:id              Leverandørkort
  /leverandorer/forhandlinger/(ny|:id|:id/rediger|live/ny|live/:id)
/ravarer/lager                   ?fane= beholdning · varemottak · telling
/ravarer/innstillinger           ?seksjon= priskontroll · tripletex · kategorier · ai (bare approve/admin)
```

Statiske segmenter uten id (`/leverandorer/forhandlinger`, `/leverandorer/forhandlinger/live`,
`/leverandorer/avtaler`, `/priskontroll/saker`, `/priskontroll/faktura`) omdirigeres til riktig fane,
så de aldri tolkes som `:id`.

## Omdirigeringstabell (gamle stier)

| Gammel sti | Ny sti |
|---|---|
| /ravarer/vareliste(/:id) | /ravarer/varer(/:id) |
| /ravarer/pakninger | /ravarer/varer/pakninger?filter=ubekreftet |
| /ravarer/pakningsstorrelser | /ravarer/varer/pakninger |
| /ravarer/deklarasjonsnavn | /ravarer/varer/deklarasjonsnavn |
| /ravarer/koble-matvaretabellen | /ravarer/varer/naering |
| /ravarer/datablad-endringer | /ravarer/varer/datablad-endringer |
| /ravarer/matvaretabellen | /ravarer/varer/matvaretabellen |
| /ravarer/datablad-bulk | /ravarer/varer/datablad-opplasting |
| /ravarer/fakturaer, /fakturaer | /ravarer/priskontroll?fane=fakturaer&visning=alle |
| /ravarer/fakturaer/til-behandling | …?fane=fakturaer&visning=innboks |
| /ravarer/fakturaer/i-dag, /varekoblinger, /vareminne | /ravarer/priskontroll?fane=gjore |
| /ravarer/fakturaer/i-dag/:key | /ravarer/priskontroll/beslutninger/:key |
| /ravarer/fakturaer/beslutninger, /ravarer | /ravarer/priskontroll/beslutninger(?omfang=ravarer) |
| /ravarer/fakturaer/oversikt | /ravarer/priskontroll?fane=godkjenning |
| /ravarer/fakturaer/saker(/:id) | /ravarer/priskontroll?fane=saker · /priskontroll/saker/:id |
| /ravarer/fakturaer/import, /ny, /import-ehf, /import-pdf | /ravarer/priskontroll/import(?tab=…) |
| /ravarer/fakturaer/reberegn-kostpriser | /ravarer/priskontroll/verktoy/reberegn |
| /ravarer/fakturaer/:id(/registrer-linjer) | /ravarer/priskontroll/faktura/:id(/registrer-linjer) |
| /ravarer/avtaler | /ravarer/leverandorer?fane=avtaler |
| /ravarer/forhandlinger(/…) | /ravarer/leverandorer?fane=forhandlinger · /leverandorer/forhandlinger/… |
| /ravarer/varemottak, /varetelling | /ravarer/lager?fane=varemottak|telling |
| /ravarer/innstillinger/match-toleranser, /tripletex, /kategorier, /ai-tjenester | /ravarer/innstillinger?seksjon=priskontroll|tripletex|kategorier|ai |

Kilden er `src/ravarer/lib/legacyRoutes.ts`; tabellen over speiler den og testes i `legacyRavarerRoutes.test.ts`.
