# Revisjon av NBHub — kun-lesende gjennomgang

Alle tall under er målt i dag mot `main` (856 TS/TSX-filer, 190 113 linjer, 76 edge functions, 245 migrasjoner). Jeg skiller **[bekreftet]** (målt/kjørt) fra **[antakelse]** (rimelig slutning, ikke verifisert).

---

## 1) Produkt- og informasjonsarkitektur

**[bekreftet]** `src/App.tsx` er 526 linjer med **189 `<Route>`** og **120 forekomster av `AppAccessGuard`** som er skrevet ut manuelt per rute, ofte kombinert med `<Shell>` + app-provider i samme JSX-linje (se f.eks. linje 334–353 for Varer). Én glemt guard = en åpen rute, og ingenting fanger det opp.

**[bekreftet]** 13 app-moduler under `src/` med svært ujevn vekt: `ordre` 46 141 linjer, `varer` 35 041, `ravarer` 16 924, `produksjon` 15 370, `pos_styring` 14 549 — mot `lib` 643 og `hooks` 542. Delt logikk er altså nesten fraværende i forhold til modulmassen; hver app har sin egen versjon av entitetsvalg, tilgang og formattering.

**[bekreftet]** Minst fire konkurrerende mekanismer for «hvilket selskap ser jeg nå»: `src/providers/SelectionProvider.tsx`, `src/kunder/state/SelectedEntityContext.tsx`, `src/pos_styring/contexts/LegalEntityContext.tsx` og `src/ravarer/context/RavarerContext.tsx` (som leser `useSelection` og eksponerer sin egen `legalEntityId`). 137 filer refererer `legalEntityId`.

**[bekreftet]** 17 separate context-providere. `src/fakturaer`, `src/fakturering`, `src/varer`, `src/ravarer` har hver sin app-context med overlappende ansvar (session + entitet + tilgangsnivå).

**[antakelse]** Navigasjonen speiler intern organisering (Ordre/Varer/Råvarer/Produksjon/Fakturering) mer enn arbeidsoppgaver. Det er trolig grunnen til at samme begrep (deklarasjon, grovhet, lager) finnes i tre apper med hver sin inngang.

---

## 2) UX/UI og mobil

**[bekreftet]** Designsystemet brytes systematisk i Kiosk: 166 hardkodede fargeklasser totalt utenfor `components/ui`, hvorav `text-[#F4ECDC]` alene 16 ganger i `src/kiosk/components/CloseSessionModal.tsx`, 9 i `ReceiptView.tsx`, 7 i `PaymentModal.tsx`, samt `bg-[#0F0E0E]` hardkodet i `src/kiosk/components/KioskShell.tsx` (linje 27–28, satt direkte på `document.documentElement.style`). Kiosk kan dermed ikke temes, og fargene kan drifte fra `--brand-*`-tokens uten at noe brekker synlig.

**[bekreftet]** Hardkodede farger lekker også inn i vanlige app-flater: `src/ordre/pages/Leveringskalender.tsx`, `src/ordre/pages/TicketDetail.tsx`, `src/fakturering/components/GroupCard.tsx`, `src/components/layout/CompanySelector.tsx` m.fl.

**[bekreftet]** 78 filer rendrer `<table>`, men bare 46 filer bruker `overflow-x-auto`. Tabeller uten horisontal scroll på mobil er en reell risiko i minst noen av de 32 differansefilene.

**[bekreftet]** `src/components/layout/AppShell.tsx` har mobil bunnavigasjon **kun** for `/ordre` (`isOrdre`-sjekken, linje 12 og 30). De øvrige 12 modulene har ingen tilsvarende mobilnavigasjon.

**[bekreftet]** 2 429 linjer i `src/ordre/pages/Leveringskalender.tsx` — matrisen, som er den mest brukte skjermen — i én fil. Det gjør UX-endringer der uforholdsmessig risikable.

---

## 3) Tilgjengelighet

**[bekreftet]** 165 `aria-label` fordelt på 856 filer. Til sammenligning: 189 ruter og 78 tabellfiler. Dekningen er tynn.

**[bekreftet]** 16 tilfeller av klikkbare ikke-interaktive elementer (`<div|span|td|tr onClick>`), bl.a. 3 i `src/ordre/pages/DeliveryNotesList.tsx`, 2 i `src/varer/pages/Profitability.tsx`, 2 i `src/fakturering/pages/KjoringDetalj.tsx`. Disse er ikke tastaturnåbare og har ingen rolle.

**[bekreftet]** Positivt: `index.html` har `lang="nb"`, ekte `<title>` og `<meta name="description">`. Ingen `<img>` mangler `alt` (0 treff).

**[bekreftet]** `AppShell` har ingen «hopp til innhold»-lenke og ingen `<h1>`-garanti per side; `PageHeader` finnes, men brukes ikke overalt.

**[antakelse]** Kontrast i Kiosk (`#F4ECDC` på `#1B1410`) er sannsynligvis OK, men de hardkodede verdiene er aldri kontrastsjekket mot tokens.

---

## 4) React/TypeScript-arkitektur og vedlikeholdbarhet

**[bekreftet]** `npx eslint .` gir **1 142 feil og 117 advarsler**. Fordeling:
- `@typescript-eslint/no-explicit-any`: **1 113**
- `react-hooks/exhaustive-deps`: **59**
- `react-refresh/only-export-components`: 48
- `no-useless-escape`: 12, parse-/øvrige: ~10

Med andre ord: `npm run lint` er i praksis ubrukelig som port — den er alltid rød.

**[bekreftet]** Motstridende TypeScript-konfig: rot-`tsconfig.json` setter `"strictNullChecks": false` og `"noImplicitAny": false`, mens `tsconfig.app.json` setter `"strict": true` og `"noImplicitAny": true`. Bygget bruker app-konfigen, men editor/verktøy som plukker rotfila får en løsere kontrakt. **[antakelse]** Dette er sannsynligvis årsaken til at `any` har fått spre seg.

**[bekreftet]** Vite kjører ingen typesjekk i bygget (`vite.config.ts` har ingen checker-plugin), og `package.json` har ikke noe `typecheck`-script. Typefeil kan altså nå produksjon.

**[bekreftet]** 20+ filer over 800 linjer, topp: `Leveringskalender.tsx` 2 429, `CakeBuilderDetail.tsx` 1 689, `DeliveryRuleFormDialog.tsx` 1 661, `CustomerOrderModal.tsx` 1 645, `TastaturEditor.tsx` 1 574, `NewOrder.tsx` 1 421.

**[bekreftet]** Datalag er ikke konsekvent: 59 filer under `pages/`/`components/` kaller `supabase.from(...)` direkte, mot 36 filer under `hooks/`. 518 `useQuery`-kall og 1 130 `queryKey`-literaler — nøkler bygges ad hoc, ikke via delte key-factories (unntak finnes, f.eks. `labelProductsQueryKey` i `src/produksjon/features/etiketter/hooks/useLabelProducts.ts`).

**[bekreftet]** To Supabase-klienter med hver sin `storageKey`: `src/integrations/supabase/client.ts` (`nbos-auth-token`, cookie-storage) og `src/kiosk/integrations/supabase/client.ts`. Bevisst for Kiosk, men det dobler auth-overflaten.

---

## 5) Ytelse og bundle-størrelse

**[bekreftet]** Produksjonsbygg (1 m 8 s): `dist/assets` = **9,5 MB** ufordelt over 337 JS-chunks. Største:

```text
1.4M  react-pdf.browser-*.js
1.4M  index-*.js            <- entry-chunk
415K  Leveringskalender-*.js
404K  xlsx-*.js
399K  useCakeCalibration-*.js
375K  RichTextEditor-*.js
357K  LineChart-*.js
321K  CakeImageEditor-*.js
195K  html2canvas.esm-*.js
```

**[bekreftet]** Rollup advarer eksplisitt om manglende `manualChunks`; `vite.config.ts` setter kun `chunkSizeWarningLimit: 1200` — altså er advarselen skrudd opp, ikke løst.

**[bekreftet]** Entry-chunken på 1,4 MB er problemet: `src/App.tsx` lazy-laster 160 sider, men importerer `AppShell`, `Topbar`, alle 17 providere, `Index`, `Login`, `Hjem` og samtlige app-contexts statisk. Alt dette lastes før innlogging.

**[bekreftet]** Tunge biblioteker i `package.json` som trolig ikke trengs samtidig: `@react-pdf/renderer` + `jspdf` + `html2canvas` (tre PDF/render-veier), `xlsx`, `fabric` v6, `recharts`, `tiptap`.

**[bekreftet]** Positivt: `QueryClient` er fornuftig satt (`staleTime: 5 min`, `refetchOnWindowFocus: false`, `retry: 1`) i `src/App.tsx`.

**[bekreftet]** 117 `select("*")`-kall. Mot brede tabeller (`products` har 100 kolonner, `orders` 63, `customer_profiles` 53) er dette både ytelse og unødig dataeksponering.

**[bekreftet]** `terserOptions.drop_console: false` — 83 `console.*`-kall følger med til produksjon.

---

## 6) Autentisering, tilgangskontroll og RLS-risiko

**[bekreftet — sikkerhetsskann]** Tre funn på **error**-nivå, alle «sensitive kolonner lesbare for feil rolle»:
- `negotiation_recipients.access_token` / `password_hash` lesbare for enhver innlogget bruker med Råvarer-lesetilgang → intern bruker kan opptre som leverandør i portalen.
- `pos_operators.pin_hash` lesbar for kiosk-brukere og butikkbrukere.
- `user_invitations.code_hash` lesbar for plattformeiere.

Fellesnevneren er den samme: RLS gir rad-tilgang, men ingen kolonne-restriksjon. Fikses med view/kolonne-grants, ikke med nye policyer.

**[bekreftet — aktivt funn]** `pickup_locations_select_pos_active` gir `anon` SELECT på adresser og beskrivelser.

**[bekreftet — supabase linter]** 232 issues: **7 tabeller med RLS på og null policyer** (INFO, men i praksis enten død tabell eller utilsiktet lukket), 201 SECURITY DEFINER-funksjoner kjørbare for innloggede, 14 kjørbare anonymt, 5 extensions i `public`, 3 funksjoner uten `search_path`, 2 materialiserte views i API-et. Flere av disse er tidligere merket «ignorert» av dere.

**[bekreftet]** Klientsidens tilgangskontroll er kosmetikk med to nivåer: `ProtectedRoute` (er du logget inn + har en `users`-rad) og `AppAccessGuard` (finnes app-koden i `useAccessibleApps`). Begge er rene UI-gjerder. `src/ravarer/context/RavarerContext.tsx` henter riktignok ekte nivå via RPC `app_access_level`, men det mønsteret er ikke gjennomført i de andre appene — de fleste steder er `canWrite` ikke sjekket i det hele tatt før mutasjon.

**[antakelse]** Den reelle sikkerheten hviler derfor nesten utelukkende på RLS. Det er i og for seg riktig arkitektur, men det betyr at hver av de 232 linter-funnene teller mer enn de ville gjort i en app med server-lag.

---

## 7) Tester, observability og feiltilstander

**[bekreftet]** **Ingen ErrorBoundary finnes i hele `src/`** (0 treff på `ErrorBoundary`, `componentDidCatch`, `errorElement`). En enkelt render-exception i f.eks. `Leveringskalender` gir hvit skjerm for hele appen, uten logging.

**[bekreftet]** 8 testfiler for 856 kildefiler: `src/test/{cart,lineCost,osloDate,payment,pricing,recalcRegal,rls}.test.ts` og `src/rapporter/pages/__tests__/kunder.click.test.tsx`, pluss én edge-function-test. Kritiske forretningsregler uten test: leveringsregelmotoren, ordre-livssyklus/statusoverganger, fakturakjøringen, deklarasjons-/allergenmotoren, POS-journalens hash-kjede.

**[bekreftet]** Ingen frontend-feilrapportering (ingen Sentry e.l. i `package.json`). Eneste observability er 83 `console.*` som havner i brukerens konsoll.

**[bekreftet]** Ingen CI-konfig funnet; `npm run lint` er rød og `npm test` dekker ~1 % av flatene, så det finnes ingen automatisk port mot regresjon.

**[bekreftet]** Positivt: alle filer som bruker Supabase-realtime rydder opp — 0 filer med `channel(` uten `removeChannel`.

**[antakelse]** Lastetilstander finnes stedvis (`Skeleton` i `ProtectedRoute`/`AppAccessGuard`), men feiltilstander håndteres i hovedsak som `toast.error` uten mulighet til å prøve igjen.

---

## 8) De ti viktigste forbedringene, rangert etter effekt/innsats

| # | Tiltak | Effekt | Innsats |
|---|---|---|---|
| 1 | **ErrorBoundary** rundt `AppShell` + per rute-segment, med fallback og logging | Fjerner hvit-skjerm-klassen av feil helt | Lav |
| 2 | **Lukk de tre error-funnene** (`negotiation_recipients`, `pos_operators.pin_hash`, `user_invitations.code_hash`) via views uten hemmelige kolonner + `REVOKE` på grunntabell | Fjerner reell privilegie-eskalering | Lav–middels |
| 3 | **Rutetabell i stedet for 189 håndskrevne `<Route>`** — deklarativ `{path, appCode, element}`-liste som genererer `Shell`+`AppAccessGuard`+provider | Umulig å glemme en guard; App.tsx fra 526 → ~120 linjer | Middels |
| 4 | **`manualChunks` + rens av PDF-stacken** (velg én av `@react-pdf`/`jspdf`+`html2canvas`), lat-last `xlsx`, `fabric`, `recharts` | Entry-chunk 1,4 MB → forventet under 400 KB | Middels |
| 5 | **Gjør lint og typecheck grønn og blokkerende**: fjern motstridende flagg i rot-`tsconfig.json`, legg til `npm run typecheck`, sett `no-explicit-any` til `warn` med et tak som synker | Gjør de 1 142 feilene til et styrbart tall i stedet for støy | Middels |
| 6 | **Én kilde for valgt selskap** — behold `SelectionProvider`, la `kunder`/`pos_styring`/`ravarer` lese derfra i stedet for egne contexts | Fjerner klassen «feil selskap i én fane» | Middels |
| 7 | **Tester på forretningsreglene**: leveringsregler, statusoverganger, fakturagrunnlag, deklarasjonsmotor, POS-hashkjede | De fem stedene der en feil koster penger eller mattrygghet | Middels–høy |
| 8 | **Feilrapportering** (Sentry e.l.) + `drop_console: true` i produksjon | Dere ser feil før brukeren ringer | Lav |
| 9 | **A11y-basis**: erstatt de 16 `div onClick` med `<button>`, «hopp til innhold», `overflow-x-auto` på de 32 tabellfilene som mangler det, `aria-label` på ikon-knapper | Tastatur- og mobilbrukbarhet | Lav–middels |
| 10 | **Del opp `Leveringskalender.tsx` (2 429 linjer)** i matrise-grid, celleeditor, filterlinje og datalag | Senker risiko på appens mest kritiske skjerm | Høy |

Rekkefølgen er bevisst: 1, 2 og 8 er dagsverk med stor effekt; 3–6 er strukturelle og bør tas før modulmassen vokser videre; 7 og 10 er de dyre, men uunngåelige.

---

## Hva jeg ikke rakk å verifisere

- Faktisk mobilbruk: jeg målte klasser statisk, ikke rendret sideoppførsel på små skjermer.
- Om de 7 «RLS enabled, no policy»-tabellene er døde eller aktivt i bruk.
- Om de 201 SECURITY DEFINER-funksjonene kjørbare for innloggede er bevisst (mange ser ut som RPC-er appen faktisk kaller).
- Kontrastmåling av Kiosk-fargene.
