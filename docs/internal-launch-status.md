# NBhub — intern driftsstatus

Sist oppdatert: 13.09.2026. Gjelder intern bruk av Varer, Oppskrifter, Ordre og
Produksjon. **Kasse/POS er utenfor denne statusen og videreutvikles ikke.**

Dette dokumentet er **ikke** en 100 %-godkjenning. Appen er ikke publisert som
del av dette arbeidet.

## Utført og verifisert i kode

- Ordrelagring: hode og linjer skrives i én transaksjon (`order_save_with_lines`).
  Linje-ID-er bevares, ukjent linje-ID avvises, tomt/uventet serversvar regnes
  som feil.
- Prisoppslag ved datobytte spores per forespørsel; lagring er sperret til
  prisen for valgt dato er avklart, med «Prøv igjen» ved feilet oppslag.
- Etiketter: utskrift logges først etter eksplisitt bekreftelse fra bruker,
  med samme forsøks-/jobb-ID ved nytt forsøk (ingen dobbelttelling).
- Produksjonsplan: utskrift, pakkliste og overføring til pakkesystem er sperret
  når grunnlaget ikke er ferdig oppdatert. Grunnlaget fryses ved utskriftsforsøk
  og lagres først når bruker bekrefter at listen faktisk ble skrevet ut.
- Kakeeditor: geometri låst til tidligere semantikk etter Fabric-oppgradering
  (dekket av enhetstester, se begrensninger).
- Navigasjon: «tilbake»-sti fra URL valideres som intern sti, **også etter
  normalisering** — protokollrelative mål som `/ordre/..//evil.example` og
  `/ordre/%2e%2e//evil.example` avvises, mens `/ordre/../varer` fungerer.
- Riktekst i e-postsvar: felles editoroppsett; lenker saniteres til
  http/https/mailto/tel både ved innlasting og innliming, og innhold overlever
  lagring/gjeninnlasting uten løkke.
- Excel: eksport og Tedebe-import dekket av regresjonstester (norske tegn,
  desimaler, dato, tomme felt, manglende kolonner).

## Verifisering kjørt på siste SHA

Kjørt sekvensielt, slik CI gjør:

- **Testsuite:** 935 tester i 100 filer — grønt.
- **Typekontroll:** grønt.
- **Produksjonsbygg:** grønt.
- **RLS-røyktester (`npm run test:rls`):** 9 anonyme kontroller mot ekte API —
  grønt. Dette er kontroller for **uautentisert** tilgang; ingen test med ekte
  rollebrukere er kjørt.
- **Målrettet lint** på berørte filer: rent.
- **`npm ci` uten `--legacy-peer-deps`** (Node 22.22, npm 10.9.4 — samme
  oppsett som CI): grønt.

### Om låsefila og `npm ci`

Låsefila var etter forrige runde ute av synk med `package.json`, slik at et
rent `npm ci` feilet med `EUSAGE … Missing: …`. Årsaken var **ikke** en reell
peer-konflikt: npm 10.9.4 krasjer med `Cannot read properties of null (reading
'edgesOut')` når låsefila skal bygges på nytt for dette treet. Låsefila ble
derfor regenerert med npm 11 og deretter verifisert med **npm 10.9.4**, som
installerer den rent. CI trenger ingen spesiell npm-versjon og ingen
`--legacy-peer-deps`.

## Restvarsler (avhengigheter)

Begge målinger gir nå **2 moderate, 0 høy, 0 kritisk**:

- Produksjon: `npm audit --omit=dev` → 2 moderate.
- Hele treet inkl. utviklings-/testverktøy: `npm audit` → 2 moderate.

Målrettet oppgradering til minste rettede versjon i hver familie (ingen
Vite 8, ingen Vitest 5, ingen Rolldown, ingen bytte av verktøykjede):

- `vite` 5.4.21 → **6.4.3** (rettet i GHSA-fx2h-pf6j-xcff: 6.4.3 / 7.3.5 / 8.0.16).
- `vitest` 3.2.4 → **4.1.11** (rettet i GHSA-82fw-gwwq-j7x9: 4.1.11 og 5.x).
- `jsdom` 20 → 26 tidligere, som fjernet den gamle `canvas`/`tar`-kjeden bak det
  kritiske varselet.

Tiptap-familien, Fabric og SheetJS er uendret. Hele testsuiten er grønn etter
oppgraderingene.

### Åpne varsler og hvorfor

Begge gjenstående varsler gjelder `react-router` 6:

- **GHSA-337j-9hxr-rhxg (SSR `deserializeErrors`)** — ikke eksponert. NBhub er
  en ren klientapp (Vite SPA, `BrowserRouter`); ingen SSR-kjøring av
  react-router på server.
- **GHSA-wrjc-x8rr-h8h6 (angriperstyrt navigasjonssti / ekstern omdirigering)** —
  avbøtet i koden: alle dynamiske navigasjoner bruker faste interne ruter eller
  ID-er fra databasen, og de tre stedene som tar mål fra URL-en er sikret —
  `tilbake` (ordredetalj) via intern-sti-validering før **og etter**
  normalisering, samt `return` på innlogging og `return_url` i
  kakebygger-innbyggingen via vertsallowliste.

Rettelsen krever react-router 7, et hovedversjonsbytte som er bevisst utsatt
til egen runde. Ingen angrep er påvist; dette er revisjonsvarsler.

### Utviklingsserveren lytter på alle grensesnitt

`vite.config.ts` setter `server.host: "::"`. Utviklingsserveren er altså **ikke**
bare lokal — den er nåbar fra nettverket der den kjøres. Produksjonsbygget er
statisk og berøres ikke, men utviklingsserveren skal ikke kjøres på et åpent
nett.

## Database: originalhistorikk vs. konsolidering

To sikkerhetsrettinger ble anvendt **direkte** mot prosjektet 12.09.2026 og
finnes derfor ikke som egne filer i `supabase/migrations/`:

- `20260912204709` — `close_delivered_orders(date)` avgrenset til selskap
  brukeren har stilling i; skrivetilgangsvakten bruker `IS NOT TRUE` så NULL
  avvises. Signatur, ACL og cron/service-oppførsel uendret.
- `20260912210449` — `save_production_plan_snapshot(...)` bruker advisory lock
  per forsøks-id i stedet for `SELECT … FOR UPDATE`, som under RLS uten
  UPDATE-policy skjulte raden og brøt idempotens ved gjentatt forsøk.

Ordrette speil av det som faktisk ble kjørt ligger i `supabase/applied-sql/` og
beholdes som **revisjonsbevis** — de skal ikke endres.

Speilene alene gjenskaper imidlertid ikke rettingene ved replay av
`supabase/migrations/` i et nytt miljø. Derfor er det lagt inn **én betinget
konsolideringsmigrasjon** (`20260913001322`) som bærer begge gjeldende
funksjonsdefinisjoner. Hver `CREATE OR REPLACE` er betinget: migrasjonen
sammenligner `pg_get_functiondef` med forventet definisjon og kjører `EXECUTE`
kun ved forskjell. Mot dagens database er begge sammenligninger like, så
migrasjonen var en **no-op**; ved nytt miljø/replay gjenskapes siste sikre
definisjoner. Ingen forretningsdata, ingen nye tabeller, ingen utvidede
rettigheter, og ingen historiske rader i migrasjonsregisteret er endret.

Dekningen herfra er **statisk kontroll** av speilet SQL og av at konsolideringen
er byte-identisk med speilene
(`src/test/appliedSecuritySql.test.ts`, `src/test/migrationReconciliation.test.ts`),
i tillegg til Henrik Næss' egne isolerte PGlite-kjøringer (6/6 for
`close_delivered_orders`, 7/7 for `save_production_plan_snapshot`). Ingen
kjøring med ekte rollebrukere er gjort herfra.

## Ikke gjort / gjenstår før full intern lansering

- Innloggede rolletester (per stilling/tilgangsnivå) er ikke kjørt.
- Fysisk prøve: etikettutskrift, pakksedler og produksjonslister på faktisk
  skriverutstyr er ikke testet.
- Fagdata: deklarasjoner, allergener og næringsverdier er ikke fagkontrollert.
- Backup/restore av databasen er ikke øvd.
- Kakeeditoren er ikke klikket gjennom visuelt (ligger bak innlogging); kun
  geometri-/lagringstester dekker den.
- Menneskelige porter gjenstår: fag- og utskriftskontroll må godkjennes av
  Henrik Næss før intern lansering. Ingen publisering er gjort.

## Ansvar

Henrik Næss er fag- og utskriftsansvarlig for punktene over.
