# NBhub — intern driftsstatus

Sist oppdatert: 12.09.2026. Gjelder intern bruk av Varer, Oppskrifter, Ordre og
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
  når grunnlaget ikke er ferdig oppdatert.
- Kakeeditor: geometri låst til tidligere semantikk etter Fabric-oppgradering
  (dekket av enhetstester, se begrensninger).
- Navigasjon: «tilbake»-sti fra URL valideres som intern sti (åpen omdirigering
  avvist).
- Riktekst i e-postsvar: lenker saniteres til http/https/mailto/tel.
- Excel: eksport og Tedebe-import dekket av regresjonstester (norske tegn,
  desimaler, dato, tomme felt, manglende kolonner).

Verifisering kjørt på siste SHA: typekontroll, full testsuite, produksjonsbygg
og målrettet lint — alle grønne (kun kjente, eldre lint-advarsler).

## Restvarsler (avhengigheter)

`npm audit --omit=dev`: 2 moderate varsler, ingen høy/kritisk.

- **GHSA-337j-9hxr-rhxg (SSR `deserializeErrors`)** — ikke eksponert. NBhub er
  en ren klientapp (Vite SPA, `BrowserRouter`); ingen SSR-kjøring av
  react-router på server.
- **GHSA-wrjc-x8rr-h8h6 (angriperstyrt navigasjonssti / ekstern omdirigering)** —
  eksponeringen er kartlagt: alle dynamiske navigasjoner bruker faste interne
  ruter eller ID-er fra databasen. De tre stedene som tar mål fra URL-en er
  sikret: `tilbake` (ordredetalj) via intern-sti-validering, samt `return` på
  innlogging og `return_url` i kakebygger-innbyggingen via vertsallowliste.
  Oppgradering til react-router 7.18 er ikke gjort — det er et hovedversjons-
  bytte som krever egen runde. Varselet står derfor åpent, men uten kjent
  utnyttbar vei i appen.

## Ikke gjort / gjenstår før full intern lansering

- Innloggede rolletester (per stilling/tilgangsnivå) er ikke kjørt.
- Fysisk prøve: etikettutskrift, pakksedler og produksjonslister på faktisk
  skriverutstyr er ikke testet.
- Fagdata: deklarasjoner, allergener og næringsverdier er ikke fagkontrollert.
- Backup/restore av databasen er ikke øvd.
- Kakeeditoren er ikke klikket gjennom visuelt (ligger bak innlogging); kun
  geometri-/lagringstester dekker den.

## Ansvar

Henrik Næss er fag- og utskriftsansvarlig for punktene over.
