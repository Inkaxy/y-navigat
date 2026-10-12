# Varetellingssystem – spesifikasjon og fremdrift

Baseline: `e29ad95e8e372578ffa8f205c2560633f0e8ef9b`. Revisjon 2 bygget på `755eeaca7f3caca7017438c1d64018a18d78ecd4` etter roots gjennomgang. Godkjent spesifikasjon er gjengitt i sin helhet nederst.

## Fremdrift (sannferdig sjekkliste)

Forklaring: **[x]** bygget og testet i kode/lokal database · **[~]** delvis · **[ ]** ikke bygget. Ingenting er i drift før SQL-en er godkjent og kjørt. Grunnlaget er **ikke akseptert** av root ennå.

### Databasegrunnlag – foreslått, IKKE kjørt mot live (revisjon 2)
- [x] `supabase/pending/20261012_varetelling_foundation.PENDING.sql` (additivt, kun `vt_*`/`_vt_*`; erstatter aldri-kjørt revisjon 1)
- [x] Atferdstest `supabase/pending/20261012_varetelling_foundation.test.sql` via `node scripts/test-varetelling-sql.mjs` (PGlite i minnet, 111 kontroller, seriell). Kanonisk prisvelger og tilgangsfunksjoner er stubbet.
- [x] Pris: `_vt_price_evidence` brukes av både dekning og start. «Ved start» = nyeste `_rm_cost_candidates(id, dagens Oslo-dato)` OG råvaren bundet til nøyaktig den kandidaten (verifisert, samme history_id, samme pris). `verifisert` alene gir ikke pris. Uten fakturalesetilgang: ingen pris. Ukjent baseenhet: ingen enhet (aldri «stk») og ingen pris. Kilde, virkningsdato, registreringstidspunkt, as-of og årsakskode lagres.
- [x] Historisk verdsettelse må velges eksplisitt med dato før i dag; nyeste kandidat med virkningsdato ≤ datoen; «registrert etter verdsettelsesdato» merkes. Fremtidig dato avvises. (Kandidatvelgerens gyldighetsregler vurderes slik de står i dag — dokumentert begrensning.)
- [x] Alle aktive varer kan telles uavhengig av `stock_tracking`; lagerføring endres aldri.
- [x] Mengde beregnes av serveren fra frosne enheter: forfalskede faktorer/etiketter ignoreres; NaN/Infinity, negative, > 1e9, duplikat/ukjent enhet, feil form, > 11 deler og avvikende `p_counted_base` avvises. CHECK: endelig pris > 0 og endelig mengde ≥ 0.
- [x] Låsrekkefølge telling → liste → linje i alle muterende RPC-er; start låser telling → maler → steder før validering/kopi; malredigering mal → steder. Avslutning krever minst én linje, alle lister med varer og godkjent, alle linjer avklart og talte varer med pris. Tom mal/telling kan ikke startes/avsluttes.
- [x] Felles op-reservasjon (`vt_ops`) for alle skrivinger: normalisert innhold + bruker + firma + type; samme op med annet innhold = 23505; null revisjon/op/status avvises.
- [x] Ingen direkte klientskriving: alle tabeller `REVOKE ALL … FROM PUBLIC, anon, authenticated` og bare `SELECT` tilbake; steder/maler via RPC; sammensatte FK-er sikrer firmaintegritet; identitet/firma/created_by uforanderlig; arkiverte steder og fremmede enheter avvises.
- [x] Startgrunnlag og avsluttede tellinger låst av triggere for alle roller.
- [ ] Ekte samtidighetstest med to økter (PGlite er seriell; låsrekkefølgen er resonnert, ikke bevist parallelt)
- [ ] Kjørt mot live (krever uavhengig gjennomgang og eksplisitt autorisasjon)

### Fase 1 – grunnlag og arbeidsflate
- [x] Arbeidsflate under Lager › Varetelling (`?vt=…`, `?telling=`, `?liste=`, `?utskrift=blank|rapport`)
- [x] Eksisterende dagstelling bevart uendret som «Dagstelling»
- [x] Sonde på `vt_backend_version()` (versjon 2); «ikke tatt i bruk» og «annen versjon» blokkerer all skriving
- [x] Fullstendig lesing via felles `fetchAllCounted` (eksakt antall, keyset, duplikat/overskudd, antall på nytt), også for lister/linjer i én telling
- [x] Avdelinger (forslag fra aktive produksjonsavdelinger) og fysiske steder (opprett/arkiver)
- [x] Listemaler: opprett, rediger navn/avdeling/standardsted, arkiver, kopier, legg til via søk eller kategori (flervalg), plassering per linje, manuell rekkefølge (opp/ned), kladd med Lagre/Forkast; revisjon øker ved hver endring
- [x] Duplikatvarsel (samme sted = feil, annet sted = lovlig), serverhåndhevet i mal og ved start
- [x] Varer uten liste: alle aktive varer, ukjent baseenhet og «ikke lagerført» markert
- [x] Planlagt telling med prisgrunnlag «ved start» eller eksplisitt historisk dato
- [x] Dekningskontroll før start med prisårsaker (samme bevis som start)
- [x] Telefon/iPad-registrering; forventet beholdning vises ikke
- [x] Utkast bundet til grunnrevisjon; fersk serverversjon tas bare inn når kortet er rent; endring fra andre vises med valg «Bruk lagret verdi» / «Behold min»
- [x] Ventende operasjoner per bruker+firma i nettleserlagring (overlever avmontering og omlasting) med synkron lås; ukjent utfall sendes bare på nytt med samme op-id; firma/skriverett kontrolleres rett før kall — gjelder linjer, opprett, start, liste- og tellingsstatus, maler og steder
- [x] Strenge kvitteringer bundet til forventet ID, status, revisjon og antall
- [x] Sammendrag per telling, avdeling og liste; samme vare på flere steder summeres
- [x] Listestatus med revisjon; telling til kontroll/avslutt/avbryt
- [x] Arkiv med søk
- [x] Syntetisk forhåndsvisning `/forhandsvisning/varetelling` med faktiske skjermer

### Fase 3 (delvis) – papir og rapport
- [x] A4 blanke tellelister, 14 linjer per side, aldri delt linje, side X av Y, malversjon, maskinlesbar identitet `VT1|telling|liste|rversjon|sX/Y`, kort linjekode per rad og alle linje-ID-er per side (for kommende skjemalesing)
- [x] QR per liste og side til innlogget telleside (`/ravarer/lager?fane=telling&telling=…&liste=…`); QR gir ingen tilgang i seg selv
- [x] Rapport (utskrift/«lagre som PDF»), PDF-fil (jsPDF) og CSV (semikolon, norsk desimal, formelvern) med frosne verdier; «Foreløpig» + tidspunkt før avslutning; manglende pris listes, aldri 0
- [ ] Lagret utskriftsversjon i databasen (identitet er i dag avledet av liste-ID + malversjon, som er uforanderlig etter start)
- [ ] Sammenligning mellom tellinger

### Trinn 3 – revisjon 3, foreslått, IKKE kjørt/utrullet (rev. 1–2 ikke akseptert)
- [x] SQL `20261012_varetelling_stage3.PENDING.sql` + `..._storage.PENDING.sql`; test `..._stage3.test.sql`: 196 kontroller i seriell PGlite (111 grunnlag + 85). Lagringsregler ikke testet (PGlite mangler storage). Testen etterligner Supabase sin service_role (BYPASSRLS).
- [x] Edge-kilde utenfor `supabase/functions`: `vt-count-ocr/`, `vt-count-report-email/`, `_shared/vtReport.ts`. `deno check` med ekte avhengigheter: ingen feil i de nye filene (7 kjente feil i urørte `_shared/crypto.ts`, `m365-crypto.ts`, `graph-mail.ts`).
- [x] **Tillitsgrense e-post:** `vt_report_mail_reserve` er service-only; Edge verifiserer aktør via JWT, bygger øyeblikksbilde/vedlegg/hash selv, og SQL krever at øyeblikksbildet er identisk med gjeldende `_vt_report_snapshot_data`. Gjentatt op må være identisk i alt (aktør, versjon, hash, vedlegg, mottaker, emne, melding, avsender). Gjenopptak (`claim`) krever opprinnelig aktør eller godkjenner og identisk forespørsel. Status bare for eier/godkjenner, uten vedlegg; RLS skjuler andres sendinger. Ukjent utfall sendes aldri på nytt automatisk.
- [x] Felles rapportkontrakt (eksakt desimal half-up per linje, tilstander, totaler, A4, CSV-formelvern) — uendret, nå med prisavklaring.
- [x] **Prisavklaring per telling:** godkjenner angir pris per baseenhet, kilde (faktura/leverandørpris/prisliste/manuell vurdering), referanse og begrunnelse (≥ 10 tegn) for linjer uten dokumentert startpris, bare før avslutning, med revisjonskontroll mot gjeldende avklaring. Forrige avklaring bevares som erstattet. Startgrunnlag og globale priser endres aldri. Skjerm, nedlastet PDF/CSV, e-post og avslutningsregelen bruker samme verdsettelse (stage3 erstatter `vt_transition_count` med eneste endring at avklart pris godtas).
- [x] **Utstedte utskriftsmanifester:** utskrift registrerer sideinndelingen (hver linje nøyaktig én gang, første utstedelse uforanderlig). Lesing krever utstedt manifest og validerer mot det.
- [x] **WEBP-original bevart** som egen fil (rolle «original»); PNG-avledning er siden som leses. Begge SHA-256-verifiseres av serveren.
- [x] **Lesing avgrenset og gjenopptakbar:** maks 20 sider per jobb; høyst 3 sider per Edge-kall, hver side lagres før neste; klienten fortsetter samme forsøk (`vt_ocr_continue`, kort kall-lås + lease 15 min). Flere sider enn utstedt utskrift avvises før noen kostnad. Ukjent AI-utfall ⇒ stopp, ingen automatisk ny kjøring. Lesing er aldri 100 % sikker; alle verdier bekreftes av en person, usikre felt står tomme.
- [x] **Mobil/iPad:** telleøkten har fire visninger (Telle/Oversikt/Papir/Kontroll); Telle er standard med kompakt status, fast listevalg og kort øverst; instruksjon vises én gang; to kolonner i liggende nettbrett/desktop. Kalender: romslig agenda på mobil, måned fra nettbrett.
- [x] Varer uten liste: søk, flervalg og tilføying til valgt mal/plassering via samme revisjonskontrollerte lagring (duplikat på samme plassering sperres). Kontroll viser aktive varer som ikke er med i tellingen.
- [x] Godkjenner kan tildele andre tellere/kontrollør fra firmaets brukere med skrivetilgang (`vt_assignable_users` + eksisterende `rm_user_names`).
- [x] Arkiv viser frosne totaler per telling og liste (startgrunnlag + avklaringer), aldri dagens pris.
- [x] Syntetisk demo i `/forhandsvisning/varetelling`: ferdig telling med flersides prøveark (SVG), utstedt manifest og ferdige lese-forslag med usikre felt og ukjent pakning — uten filvelger, nettverk eller ekte AI.
- [ ] Positiv test av avslutning med avklart pris i SQL (avslutning krever godkjente lister; bare avvisningsstiene er testet i SQL, positiv sti i syntetisk klient)
- [ ] Syntetisk klient (fake) tillater lesing uten utstedt manifest (serveren gjør det ikke)
- [ ] Ekte samtidighet, RLS/lagring/Edge mot ekte Supabase, ekte AI-lesing og Graph-sending er ikke kjørt
- [ ] Bevis på at et bilde tilhører papirarket utover lagret fil + trykt identitet finnes ikke; radutsnitt ikke bygget (hel side vises)
- [ ] Kjørt/utrullet (krever gjennomgang og eksplisitt autorisasjon)

### Gjenstår (neste leveranser)
- [ ] Flytt vare mellom maler direkte fra duplikatvarselet (i dag: varsel + endre plassering/fjern)
- [ ] Gjentakende planlegging og påminnelser (kalenderen er bare visning)
- [ ] Offline-kø med testet kaldstart — IKKE bygget, ikke lovet (utkast og ventende innslag i nettleseren er ikke offline-støtte)
- [ ] Bevegelseskontroll i tellevindu og «Oppdater lagerbeholdning» — IKKE bygget (ingen automatisk lagerjustering; skal vurderes separat)
- [ ] Rapportkorreksjon av avsluttet telling som ny revisjon — IKKE bygget
- [ ] Planredigering før start (dato/navn/omfang med CAS) — IKKE bygget
- [ ] Sammenligning mellom tellinger
- [ ] Kontroll i ekte nettleser 390/768/1440, A4/svart-hvitt-utskrift og innlogget produksjon (root)

## Godkjent spesifikasjon (12. oktober 2026)

# NBhub – komplett varetellingssystem

Dato: 12. oktober 2026. Status: løsningsforslag og gjennomføringsgrunnlag (fase 1 delvis bygget, se sjekklisten over).

## Mål og dagens utgangspunkt

Gjenbrukbare tellelister organiseres etter avdeling, vareutvalg og fysisk plassering. En datert telling samler egne kopier av de valgte listene, registreringer, originalskjemaer og priser som fryses når tellingen starter. Avsluttede tellinger beholder sitt historiske innhold.

Kontrollert kildegrunnlag: Lovable-prosjekt 55f2f22b-89c6-4b5e-a4ed-f237dd0006c9, versjon e29ad95e8e372578ffa8f205c2560633f0e8ef9b; Varetelling.tsx, lib/countSheets.ts og pages/hub/LagerHub.tsx. Dagens side bruker dagsutkast, varefiltre, telling i flere enheter og direkte bokføring. Den henter siste åpne serverutkast for dagens dato. Dette er et utgangspunkt som må utvides, ikke dokumentasjon på at funksjonene nedenfor finnes.

## 1. Tre adskilte begreper

| Begrep | Eksempel | Betydning |
|---|---|---|
| Listemal | Bakeri / Tørrvarelager / Reol A | Gjenbrukbart vareutvalg, telleenheter, rekkefølge og ansvarlig avdeling. Ingen opptalte mengder. |
| Telling | Varetelling 31.12.2026 | Planlagt dato, faktisk start, omfang, ansvarlige, prisgrunnlag og samlet status. |
| Telleliste i tellingen | Tørrvarelager, desembertelling | Selvstendig kopi av listemalen med egne linjer, mengder, kommentarer, QR-kode og historikk. |

Endringer i en listemal påvirker fremtidige tellinger. En startet telling endres bare gjennom eksplisitte, loggførte handlinger. Kopiering av en gammel telling kopierer struktur, aldri tidligere mengder eller priser som nytt prisgrunnlag.

## 2. Oversikt og navigasjon

Egen arbeidsflate «Varetelling» under Lager med fire oversiktlige innganger:

- **Tellinger:** aktive og kommende øverst, avsluttede i søkbart arkiv. Kort viser navn, dato, ansvarlig, fremdrift og avvik. Foreløpig verdi merkes tydelig og vises sammen med eventuell manglende prisdekning.
- **Listemaler:** grupperes etter avdeling og plassering. Vis antall varer, siste endring og hvilke tellinger malen brukes i.
- **Varer uten liste:** aktive lagerførte varer uten relevant listetilknytning. Skill mellom uten listemal og ikke inkludert i den valgte tellingen. Vis også manglende plassering, telleenhet eller pris.
- **Kalender:** planlagte engangs- og gjentakende tellinger. En planlagt telling er ikke startet; prisene fryses først ved start. Påminnelser og mottakere velges eksplisitt.

På én telling vises listene med avdeling, plassering, ansvarlig, talt/antall, usikre felt og status. Filtre: Mine lister, Ikke startet, Under telling, Må kontrolleres, Ferdig. Hovedhandlinger: Fortsett telling, Skriv ut og Last opp utfylt liste. Avslutning ligger hos ansvarlig leder.

## 3. Opprette og vedlikeholde listemaler

Velg avdeling, lagersted og eventuelt rom/reol/hylle. Legg inn råvarer, emballasje og andre lagerførte varetyper. Støtte for søk, flervalg, kategorier, kopiering av liste og manuell sortering i fysisk gangrekkefølge. Kategorien velger varer ved opprettelse; senere nye varer legges ikke stille inn i en påbegynt telling.

Hver linje har stabil vareidentitet, varenavn, varenummer, fysisk plassering, baseenhet og valgte telleenheter. Eksempel: «Hvetemel – 3 sekker à 25 kg + 7,5 kg = 82,5 kg». Telleenhet og omregning fryses sammen med tellelisten, slik at senere endring av pakningsstørrelse ikke endrer historiske mengder.

Duplikatkontroll:

- Samme vare og samme plassering i samme telling skal ikke kunne opprette to aktive tellelinjer. Serveren håndhever dette, også ved samtidige handlinger.
- Når en vare finnes i en annen listemal, vis hvilken liste og plassering den finnes på. Gi valg om å gå til eksisterende linje, flytte den eller angi en annen fysisk plassering.
- Samme vare på forskjellige steder er legitimt. «Mel – Tørrlager» og «Mel – Produksjon» telles hver for seg og summeres én gang til total mengde for varen.
- Om varegrupper overlapper uten tilstrekkelig plassering, må overlapp avklares før start. Ikke la en advarsel med «fortsett uansett» skape skjult dobbelttelling.

## 4. Opprette og starte en telling

Flyt: **Navn og dato → Avdelinger og steder → Velg listemaler → Kontroller dekning → Start telling**.

Før start vises duplikater, varer som mangler, manglende telleenheter og manglende dokumenterte priser. Uten pris kan varen fortsatt telles fysisk, men totalen kan ikke fremstilles som fullstendig lagerverdi.

Serveren oppretter i én transaksjon et uforanderlig startgrunnlag: listeversjoner, varedata, enhetsfaktorer, dokumentert pris per baseenhet, priskilde, valuta og tidspunkt. Delvis opprettelse må ikke kunne se ut som en komplett startet telling. Startforsøk kan trygt gjentas etter forbindelsesfeil uten å opprette to tellinger.

Planlagt telledato, faktisk starttidspunkt, faktisk registreringstidspunkt og eventuell verdsettelsesdato lagres hver for seg. Et navn som «Varetelling 31.12.2025» gjør ikke dagens priser historiske. Tilbakedatert telling må uttrykkelig bruke historisk prisgrunnlag, med synlig kilde og hull i datagrunnlaget. Fremtidig prisinformasjon må ikke lekke inn i en historisk verdsettelse.

Standard for ordinære tellinger er brukerens ønskede regel: nyeste gyldige, dokumenterte pris tilgjengelig ved start. Ny faktura etter start endrer ikke tellingens pris. Manuell prisavklaring må lagres med begrunnelse og sporbarhet; den skal ikke stille omskrive det opprinnelige grunnlaget.

## 5. Telefon og iPad

Telefon: store varekort med tydelig navn, plassering og enhet. Talltastatur med desimalkomma, minimum 48 px trykkflater, enkel «Neste vare», eksplisitt «0 på lager», kommentar og markering «Må kontrolleres». Filtrer til gjenstående varer. Ikke kreve horisontal rulling. Forventet beholdning skjules som standard under registrering for å unngå å påvirke opptellingen; sammenligning vises ved kontroll.

iPad: tettere liste med store inntastingsfelt i landskap og kortvisning i portrett. Tastaturnavigasjon, tydelig aktiv linje og valg av avdeling/liste uten å miste registreringer.

Lagring vises per linje: «Lagret», «Venter på nett» eller «Kunne ikke lagre». Arbeid uten dekning lagres holdbart på enheten og synkroniseres med uendrede operasjons-ID-er. Ikke lov offline-funksjon før gjenåpning av nettleser, utlogging, konflikter og gjenoppretting er testet. Usynkroniserte linjer kan ikke inngå i en avsluttet telling.

Flere personer kan arbeide på hver sin liste. Ved samtidig redigering av samme linje skal systemet vise en konflikt og begge verdier; siste lagring skal ikke stille vinne. Rettigheter: teller på tildelte lister, kontrollør og telleansvarlig. Firmaisolasjon gjelder også QR-lenker, filer og rapporter.

## 6. Papirlister og QR-koder

**Anbefaling: QR-kode per konkret telleliste i en bestemt telling**, trykt på hver side, sammen med tydelig telling, liste, avdeling, sted, versjon og «Side 1 av 3». Listen åpner riktig digital registrering etter innlogging. QR-koden gir ikke i seg selv tilgang. En ekstra QR på tellingens forside kan åpne hele oversikten.

En permanent QR på lagerstedet kan eventuelt åpne valg av aktiv telling for stedet. Den skal aldri føre direkte til en tilfeldig eller sist brukt telling.

A4-utskrift med god kontrast også i svart-hvitt, store skrivefelt, varenummer, navn, plassering, enhet og separate felt for hele pakninger/løs mengde. Ikke skriv forventet antall på standard blankt telleark. Ta med teller, dato og signatur. Unngå linjer som deles mellom sider.

Lagre utskriftsversjon og stabil linjeidentitet. Ny utskrift med endret vareutvalg får ny versjon. Originale skjemaer og godkjente resultater beholdes sammen, slik at senere opplasting ikke kobles mot en endret rekkefølge.

## 7. Tolking av utfylte skjemaer

Foto fra telefon, skann eller PDF lastes opp **inne på den aktuelle tellelisten**. Støtt både håndskrift og maskinskrevet utfylling på systemets egne skjemaer først; vilkårlige eksterne oppsett bør være en egen senere funksjon.

Flyt: **Last opp → Kontroller dokument/listetilhørighet → Vis leseforslag → Bekreft → Lagre registreringer**.

- Dokumentets identitet, telling, liste, versjon, sider og linjer kontrolleres. Feil QR eller ukjent versjon stopper importen. Manglende lesbar identitet krever manuell avklaring, ikke gjetting.
- Serveren binder jobben til den valgte listen. AI-resultatet får aldri bestemme hvilket firma, hvilken telling eller liste det skal skrives til.
- Tomme felt betyr «ikke talt», aldri null. Flere mulige tall, overstrekninger, uklar desimal, ukjent enhet eller uleselig tekst blir «Må kontrolleres». Vis utsnitt fra originalen ved siden av feltet.
- AI kan ikke dokumentere 100 % sikkerhet. Derfor foreslås ingen automatisk bokføring fra opplasting: tydelige lesninger presenteres til bekreftelse, usikre felt forblir uten godkjent mengde til noen leser originalen og retter/bekrefter dem. En påstått konfidens på 100 % er ikke tilstrekkelig.
- En opplasting erstatter ikke eksisterende digitale registreringer. Vis konflikt hvis feltet allerede er utfylt eller endret etter at lesingen startet.
- Samme fil eller side lastet opp to ganger skal gjenkjennes. Antall skal aldri legges til på nytt bare fordi importen gjentas. Delvise resultater, manglende sider og feil under lesing må fremgå tydelig.
- Godkjente rettelser kan brukes som firmaavgrensede kvalitetseksempler med kobling til originalen, men endrer aldri tidligere tellinger automatisk.

## 8. Kontroll, verdi og avslutning

Listestatus: Ikke startet → Under telling → Til kontroll → Godkjent. Telling: Planlagt → Pågår → Til kontroll → Avsluttet. Avbrutt er egen status med bevart historikk.

Ansvarlig ser manglende registreringer, usikre lesninger, manglende pris, uvanlige mengder, samtidige endringer og uavklarte lagerbevegelser. Store avvik kan kreve omtelling av en annen person. «Ikke talt», «0», «Ikke på dette stedet» og «Utelatt fra omfanget» er forskjellige tilstander.

Verdi per linje = bekreftet mengde i baseenheten × frosset pris per baseenhet. Summer beregnes med desimalpresisjon; visningsavrunding endrer ikke mengder eller priskilder. Rapporten oppgir verdsettingsgrunnlag og om beløp er eksklusive merverdiavgift. Ulike valutaer summeres ikke uten et eksplisitt, lagret omregningsgrunnlag.

Vis verdi per liste, lagersted, avdeling, vare og hele tellingen. En delvis telling vises som verdi av talt omfang, ikke total verdi for hele bedriftens lager. Varer uten pris listes med antall og mengde; de blir ikke usynlige nullverdier. Avslutning med ufullstendig verdi skal som standard stoppes inntil avklaring.

Lagerbevegelser mens tellingen pågår må håndteres bevisst. Anbefalt første versjon har et tydelig avtalt tidspunkt eller avgrenset tellevindu og varsler om bevegelser i omfanget. Ikke skriv over dagens beholdning ukritisk med et tall fra et eldre tidspunkt. Flere plasseringer av samme vare summeres før eventuell lagerjustering; én liste må aldri erstatte totalbeholdningen alene.

«Avslutt telling» låser rapport og underlag. «Oppdater lagerbeholdning» er en egen tydelig, autorisert handling med differansevisning, kontroll mot bevegelser og garanti mot dobbeltføring. Dersom handlingene senere kombineres, må brukerens bekreftelse og servertransaksjonen uttrykkelig dekke begge. Historiske tellinger skal ikke kunne overskrive nåværende beholdning.

Avsluttede tellinger slettes eller redigeres ikke stille. Feil rettes i en ny revisjon med begrunnelse, tidligere rapport og eventuell lagerkorrigering bevart.

## 9. Arkiv, utskrift og e-post

Arkivet viser dato, navn, omfang, status, antall lister, fullstendighet og frosset totalverdi. Åpning viser historiske data uten å hente dagens pris inn i regnestykket. Sammenligning mellom tellinger skiller mengdeendring fra prisendring og viser når omfanget er forskjellig.

Rapport: forsidesammendrag, totalsum, sum per avdeling og liste, detaljer per vare, manglende grunnlag, kontrollhistorikk, ansvarlige og tidspunkt. Velg PDF til utskrift/e-post og regneark for videre bearbeiding. Delrapport kan produseres underveis, men skal være merket «Foreløpig» og ha tidspunkt.

E-post åpner forhåndsvisning med mottaker, emne, melding og nøyaktig rapportversjon som vedlegg. Brukeren sender uttrykkelig. Vis sendestatus, og avklar ukjent leveringsutfall før et nytt forsøk for å unngå duplikater. Ingen ekte e-post sendes under utvikling eller tester.

## 10. Gjennomføring og akseptanse

1. **Grunnlag og ny arbeidsflate:** avdelinger/plasseringer, listemaler, duplikatkontroll, manglende varer, tellinger med dato og låste liste-/pris-/enhetsgrunnlag. Bevar gamle tellinger som historikk; ikke konstruer manglende gamle priser.
2. **Digital telling:** telefon/iPad, linjelagring, flere tellere, konflikter, gjenoppretting og testet offline-kø. Ingen avhengighet til AI for ordinær telling.
3. **Papir og rapport:** versjonerte skjemaer, QR, utskrift, arkiv, verdi per liste og samlet, eksport og e-postforhåndsvisning.
4. **Dokumentlesing:** isolerte importjobber, kontroll av liste og sider, bildeutsnitt, usikre felt og eksplisitt godkjenning. Evaluer på både tydelige og vanskelige faktiske skjemaer før produksjonsbruk.
5. **Avslutning og eventuell lagerjustering:** bevegelseskontroll, flere plasseringer, sperrer, revisjoner og atomiske operasjoner. Integrasjonen med eksisterende lagerbokføring må gjennomgås separat før den aktiveres.

Hver leveranse verifiseres mot faktiske skjermer og handlinger, ikke bare at kode finnes. Viktige akseptansescenarioer:

- Vare X ligger på to ulike steder og telles 3 og 7: totalsummen blir 10, mens samme sted ikke kan telles to ganger.
- Ny innkjøpspris etter start endrer verken pågående eller avsluttet telling. Endret pakningsfaktor gjør heller ikke det.
- Telling opprettet nå med eldre telledato bruker ikke dagens pris som om den var historisk.
- Fil for liste A lastes opp på liste B: ingen telleregistrering endres.
- Uklart «1/7», desimalfeil, tomt felt og overstrekning blir aldri automatisk bekreftet mengde.
- Dobbelt opplastet fil, dobbel klikk, timeout og sideoppdatering lager ikke dobbelt antall, dobbelt telling eller dobbelt lagerbevegelse.
- To tellere endrer samme linje: konflikt vises uten tap av begge registreringene.
- Telefon mister nett og starter nettleseren på nytt: lagrede lokale endringer kan gjenopprettes og synkroniseres trygt.
- Varer uten pris eller uten telling gir synlig ufullstendighet; de regnes ikke som null.
- Rapport åpnet måneder senere har samme mengder, priser, sum og underlag som ved avslutning.
- Lagerbevegelse etter registrering og før bokføring blir avklart før beholdning endres.
- QR fra annet firma, utdatert skjema og manglende tilgang gir ingen datatilgang eller skriving.
- Telefon, iPad stående/liggende, tastatur, A4 med mange sider og svart-hvitt-utskrift er kontrollert.

Tekniske hovedføringer: gjenbruk eksisterende firma- og tilgangsmodell; egne identiteter for telling, listeinstans, linje og import; serverkontrollerte overganger; databasebeskyttet historikk; konfliktkontroll per linje; private originalfiler; sporbare operasjoner og priser. Eksisterende dagsutkast kan ikke være den eneste modellen for den nye funksjonen.

## Herding før utrulling (12.10.2026)
- Rapport: utskrift, skjermtotaler, arkiv, CSV/PDF og e-postpanel bruker samme flettede avklaringsgrunnlag og er sperret mens avklaringer hentes eller feiler.
- Lesing: ny attempt_id per del; sene skrivinger avvises; utløpt pågående del = ukjent utfall (lagrede sider bevares, godkjenner bekrefter, «Les gjenstående sider»); ferdigstilling fra lagrede sider uten ny lesing.
- Originalvisning: serverens kildekobling per lest side (fil, PDF-side, bevart original); fast originalvisning ved siden av forslagene på brede skjermer, hopp og «Tilbake til feltet» på mobil.
- Telleark: utskrift sperret til manifest er registrert og alle QR-koder er laget; rader har låst høyde.
- Tildeling: datoregler og eier-/plattformunntak avgjøres av live `has_ravarer_access`; navn hentes i biter à 500.
- E-post: forhåndsvisning viser tilkoblet avsender; ukjent status beskrives som ukjent.
- Begrensninger: ingen ekte samtidighetstest (serielle PGlite-tester); A4 kontrollert med faste radhøyder og sidebudsjett, ikke fysisk utskrift; WEBP-original ↔ avledning er klientoppgitt kobling (ikke kryptografisk bevist); 7 Deno-typefeil gjenstår i uendrede delte filer (crypto.ts, m365-crypto.ts, graph-mail.ts).

## Lagringsbøtte og uavhengig kontroll (12.10.2026)
- Root har uavhengig kjørt oppdaterte SQL-tester og positiv avslutning med prisavklaring på stage6 `42b9835d` — bestått.
- Privat bøtte `vt-count-uploads` opprettet med Storage-API-verktøyet: public=false, 20 MiB (20971520) bekreftet. Tillatte filtyper (pdf/jpeg/png/webp) kunne ikke settes med verktøyet og står NULL; håndheves av `vt_ocr_create_job` og insert-policyen. Kan settes i dashbordet.
- Storage-policyer (`20261012_varetelling_stage3_storage.PENDING.sql`) er fortsatt ikke kjørt; ingen SQL-migrasjon eller Edge-deploy.
- E-post (etter root-kontroll): uklar claim-feil (transport/ukjent) gir `ukjent` med op_id og ingen Graph-kall (`runStoredSend` i `reportCore.ts`, testet i `varetelling-mail-claim.test.ts`); kjent avvisning (42501/23505) påstår ikke lenger at den lagrede sendingen aldri ble sendt. Forhåndsvisnings-hash binder vedlegg + valgt avsender — byttet postboks krever ny forhåndsvisning; lagret operasjon beholder sin lagrede avsender.
- Bøttens MIME-liste: Storage-verktøyet støtter ikke filtypeliste; står NULL (smal jobbvalidering + stipolicy).

## Utrullet av root (12.10.2026)
- SQL: `varetelling_foundation_reviewed` (rev. 2, `42b9835d`), `varetelling_document_reports_reviewed` (stage3 rev. 4, `42b9835d`), `varetelling_private_upload_policies_reviewed` (`bfbe3d3a`). Live: 13 vt-tabeller med RLS, ingen anon, ingen direkte klientskriving; 44 vt-funksjoner uten anon-execute; service-skrivefunksjoner ikke klientkallbare. Tellinger/maler: 0.
- Edge: `vt-count-ocr` v1 (`42b9835d`), `vt-count-report-email` v1 (`d753fa8d`), verify_jwt=true, tilbakelesing eksakt. Ingen andre Edge-funksjoner rullet ut på nytt.
- Speil: `supabase/live-mirror/varetelling_*_reviewed.sql` og `supabase/live-mirror/functions/`.
- Root-kontroll: 212 SQL-tester + positiv avslutning; nettleser 390 (48 px/16 px, bredde 375), iPad 768 felt 48 px; oversikt + utskrift 45 kr fra 2 kg × 22,5 avklaring; kildehopp riktig fil og retur; `runStoredSend` ukjent/avvisning/replay uten sending, avsender-hash ulik, én claimet falsk sending.
- Advisor: `vt_ops` uten SELECT-policy er bevisst (privat idempotens); autoriserte SECURITY DEFINER-RPC-er er bevisst beskyttet.
- Ikke testet: ekte AI, ekte Graph-sending, forretningsdata. Frontend-publisering gjenstår (root).
