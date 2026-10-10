# Råvarer 2.0 — fase 1: gjennomføring i fire leveranser

Fase 1 er stor: rundt 60 filer får nye ruter, og nesten hele `src/` endres. For at hver del skal kunne kontrolleres og angres hver for seg, leveres den i fire trinn. Hvert trinn avsluttes med grønn typekontroll, bygg og tester, og med en kort rapport. Ingen migrasjoner, ingen endringer i Edge-funksjoner, `units.ts` røres ikke, og ingenting publiseres.

## Trinn 1 — Fundament uten synlige endringer (A1, A2, A4, RPC-lag)
- Tokens i `index.css` (lys og mørk): `--alert-*` og `--rm-*`, avledet fra `--state-*`/`--brand-*`.
- `src/ravarer/lib/labels.ts` som eneste kilde for etiketter. Dagens kart blir tynne re-eksporter. Test: alle kjente koder har etikett, og ukjente koder får «Annen årsak».
- `src/ravarer/lib/paths.ts` med stibygger for alle Råvarer-sider (nye stier).
- Fem RPC-er legges i `types.ts`, med parse-funksjoner i `src/ravarer/lib/workRpc.ts` og hooks (`useWorkSummary`, `useWorkItems`, `useActivityFeed`, `usePriceMovers`, `useAcceptSupplierItemPrice`). I tillegg `invalidateRavarerCounts`, som kobles inn i alle relevante `useMutation` i `src/fakturaer` og `src/ravarer`.

## Trinn 2 — Primitiver (A3) og forhåndsvisning
- `src/ravarer/ui/`: `ModulePage`, `SectionTabs`, `DataTable`, `SplitView`/`PeekPanel`, `useHotkeys` + `ShortcutHelp`, `ResultBox`.
- `queueShortcuts` og de innebygde tastaturhåndtererne i Vareliste og RawMaterialDetail flyttes over på `useHotkeys`, med de samme tastene som før.
- `Kpi.tsx` byttes ut med `OrderDeskKpi`, med de samme tallene.
- Forhåndsvisning `ravarer-shell-preview.html` (1440 og 390 px). Tester for URL-tilstand, hotkey-vakt, sortering og fanebytte i `SectionTabs`.

## Trinn 3 — Ny informasjonsstruktur (B1–B4)
- Nye ruter i `App.tsx`. Eksisterende sider monteres med `embedded`-prop. Innboksens fane-parameter blir `innboks`.
- `resolveLegacyRavarerUrl` + `LegacyRavarerRedirect`, med én test per rad i tabellen.
- Alle hardkodede `"/ravarer/..."` i `src/` byttes til `paths.*`.
- Ny `RavarerNav` med fem innganger og tannhjul, mobilark, enkel Oversikt-side og Innstillinger-side med vakt for approve/admin.
- `pageLabels` for alle nye stier, og full bredde for `/ravarer/priskontroll`.

## Trinn 4 — ⌘K og dokumentasjon (B5, C1)
- Søketyper `raw_material` og `supplier` i entitetssøket, med hurtighandlinger. Vareliste åpner ny-råvare-dialogen ved `?ny=1`.
- `docs/ravarer-2-designprinsipper.md`.
- Gjennomgang av alle gamle stier i forhåndsvisningen og sluttrapport.

## Kjente begrensninger
- Commit-SHA kan jeg ikke lese i dette miljøet. Den må hentes fra GitHub.
- Innloggede sider kan ikke kjøres i forhåndsvisningen. Visuell sjekk gjøres med faste data.
- `npm run lint` er bare rent på berørte filer. Resten av prosjektet har kjente feil fra før.
