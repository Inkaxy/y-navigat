# Opprydding Råvarer – kun versjon D (17.11.2026)

Henriks beslutning: «Det skal kun stå igjen versjon D.» Ingen evne fjernes før den er flyttet; det som ikke lot seg flytte står som «beholdt – ikke flyttet ennå».

Råvarer-menyen: Oversikt · Fra faktura · Varer · Fakturaer · Leverandører · Lager (+ tannhjul for Innstillinger).

Forklaring: **flyttet til** = evnen finnes nå i D; **dekkes allerede av** = fantes allerede utenfor de gamle flatene; **uendret** = flaten består; **fjernes** = evnen er borte (med begrunnelse); **beholdt – ikke flyttet ennå** = gammel flate står igjen fordi evnen ikke er flyttet.

Kilde: `docs/ravarer-funksjonsmapping.json` (bygget på nytt med `scripts/build-funksjonsmapping.mjs`).


## Navigasjon, tilgang og felles

| ID | Funksjon | Disposisjon |
|---|---|---|
| F1 | Omdirigeringer: /ravarer, /pakninger, /innstillinger, fakturaer /ny, /import-ehf, /import-pdf, /vareminne, /fakturaer/* | dekkes allerede av: gamle adresser i legacyRoutes; nå også /ravarer/prislinje → Varer og /ravarer/automatikk → Innstillinger |
| F2 | Meny-badger: linjer til behandling, varekort som venter (ukoblet + mangler pakning), avtaler som utløper, ukvitterte datablad-endringer | flyttet til: menymerke på Fra faktura (åpne spørsmål); Fakturaer uten merke |
| F3 | Meny-badger: linjer til behandling, varekort som venter (ukoblet + mangler pakning), avtaler som utløper, ukvitterte datablad-endringer | flyttet til: menymerke på Fra faktura |
| F4 | Tilgang: fakturadel og forhandlinger krever fakturatilgang (`user_has_invoice_access`, roller read/write/approve/admin); Innstillinger krever approve/admin; AI-tjenester krever plattformadmin | uendret: src/ravarer/routes.tsx |
| F108 | Nivådelt forklaring av prisavvik (speiler `rm_price_deviation_eval`) i alle prisvisninger | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F109 | Oversatte etiketter for årsakskoder, matchtype og linjetype | uendret: src/ravarer/lib/labels.ts |
| R1 | Råvarer-meny med grupper, nedtrekk og aktiv-markering | dekkes allerede av: Råvarer-menyen, nå Oversikt · Fra faktura · Varer · Fakturaer · Leverandører · Lager (+ tannhjul) |
| R2 | Meny-badger: linjer til behandling, varekort som venter (ukoblet + mangler pakning), avtaler som utløper, ukvitterte datablad-endringer | flyttet til: menymerke på Fra faktura |
| R3 | Tilgang: fakturadel og forhandlinger krever fakturatilgang (`user_has_invoice_access`, roller read/write/approve/admin); Innstillinger krever approve/admin; AI-tjenester krever plattformadmin | uendret: src/ravarer/routes.tsx |
| R4 | Mobilmeny som bunnark | uendret: src/components/layout/SubAppNav.tsx |
| R5 | Sidetitler i nettleserfanen | uendret: src/lib/pageLabels.ts |
| R6 | Omdirigeringer: /ravarer, /pakninger, /innstillinger, fakturaer /ny, /import-ehf, /import-pdf, /vareminne, /fakturaer/* | uendret: src/ravarer/lib/legacyRoutes.ts |

## Fakturaer: I dag / Beslutninger / Råvarespørsmål

| ID | Funksjon | Disposisjon |
|---|---|---|
| F5 | Prioritert topp-5 over beslutninger på tvers av fakturaer | flyttet til: Oversikt › kortet «Fra faktura til vare» (tall for Nye varer, Prishopp, Ikke lest) |
| F6 | Tellere «N åpne beslutninger på M fakturaer» og «gjentatte linjer slått sammen» | flyttet til: Oversikt › kortet «Fra faktura til vare» |
| F7 | Kort for varekort som venter, med lenke | flyttet til: Oversikt › kort «Nye varer»/«Prishopp» med lenke til Fra faktura |
| F8 | Kort med fakturaer klare til intern godkjenning | flyttet til: Oversikt › kort «Til godkjenning» (Godkjenning-fanen uendret) |
| F9 | Beslutningsliste: søk, leverandørfilter, typefilter, paging, «alle» eller «bare råvarer» | flyttet til: Fra faktura (leverandørchips, «Vis flere»); typer D ikke dekker står i Beslutninger |
| F10 | Material: velg forslag, søk i hele registeret, bruk på alle like linjer og husk (alias) | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F11 | Material: opprett ny råvare og koble resten av gruppen | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F12 | Package: bekreft pakning for alle linjer i gruppen | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F13 | First cost: sett manglende pakning og før første kostpris | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F14 | Price: referanse mot fakturert pris, nivådelt forklaring, samlet kronebeløp | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F15 | Price: godta avviket for alle linjer, med sjekk av at linjene er uendret | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F16 | Price: opprett én leverandørsak for gruppen | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F17 | Gå automatisk til neste etter lagring, i samme filterrekkefølge | fjernes (besvart rad forsvinner fra listen i Fra faktura; ingen egen auto-neste trengs) |
| F18 | Frys gruppen mens den vises | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |

## Til behandling / innboks

| ID | Funksjon | Disposisjon |
|---|---|---|
| F19 | Innboksfaner «Må avklares», «Klar til å fullføre», «Fullført» | dekkes allerede av: Fakturaer-arkivet (liste med status, søk og filter) |
| F20 | Søk på leverandør eller fakturanr., leverandørfilter, «Vis flere» | dekkes allerede av: Fakturaer-arkivet (liste med status, søk og filter) |
| F21 | «Oppdater matching» for alle fakturaer, med fremdrift og feilliste | uendret: Fakturaer › Verktøy › «Beregn alle åpne på nytt» |
| F22 | Hovedknapp per faktura (Se flagget, Hent linjer, Registrer linjer, Koble kreditnota, Fullfør kontroll, Avklar N) | dekkes allerede av: Fakturaer-arkivet (liste med status, søk og filter) |
| F23 | Radmeny (åpne detalj, kjør matching, flagg, fjern flagg) | dekkes allerede av: Fakturaer-arkivet (liste med status, søk og filter) |
| F24 | Fokusvisning: fremdrift, angre siste, originalfaktura, «Bekreft prismatch» | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F25 | Varsel om feil på fakturanivå med «Rett registreringen» | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F26 | Linjekø: årsaksfilter (13 grupper), tre sorteringer | fjernes (Henrik: eldste først er ren sortering; linjefilter på fakturasiden beholdt) |
| F27 | «Kontroller linjer på tvers av fakturaer» (opptil 200) | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F28 | Masse: godta forslag, ikke aktuell, opprett råvarer | flyttet til: Fra faktura › «Opprett N sikre» og «Ikke vare» per rad |
| F44 | Hurtigtaster ↑/↓, Enter, m, n, x, u, Esc | fjernes (hurtigtastene fulgte køen som er fjernet; Oversikt har g f / g v / g p) |
| F45 | Angre siste linjehandling | dekkes allerede av: Fra faktura › «Angre» på besvart rad; fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F46 | Dokumentpanel ved siden av køen; tilstand huskes | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) (PDF ved siden av linjene) |

## Linjeoppgave og MatchDrawer

| ID | Funksjon | Disposisjon |
|---|---|---|
| F29 | Oppgavekort med linjestatus og tre steg (råvare, pakning, pris) | flyttet til: Fra faktura › én rad per leverandørvare (vare, pakning, svar) |
| F30 | Forslag og søk på navn/varenr., valgfri treffprosent | flyttet til: Fra faktura › «Koble til en vare jeg har» |
| F31 | Bekreft råvare (og pakning) i ett steg | flyttet til: Fra faktura › hovedknappen lagrer kobling og pakning samtidig |
| F32 | Pakningsskjema med hint fra varenavn og varsel ved uenighet | flyttet til: Fra faktura › pakning i raden (kreditlinjer spør ikke om pakning) |
| F33 | «Husk varenummer» / «Husk varetekst» (aliaslæring, avviste forslag) | dekkes allerede av: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (læring per leverandør skjer ved kobling) |
| F34 | «Prisen er riktig» (godta per linje) | flyttet til: Fra faktura › Prishopp › «Prisen stemmer» |
| F35 | «Rett avtalepris» og beregn på nytt | dekkes allerede av: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) › «Rett avtalepris» |
| F36 | «Kontroller pakningen» og «Endre råvare» fra prissteget | flyttet til: Fra faktura › Prishopp › «Feil pakning»; leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) › «Kontroller pakningen» |
| F37 | «Beregn prisen på nytt» / «Prøv igjen» ved feil | dekkes allerede av: Fakturaer › Verktøy › «Beregn alle åpne på nytt» |
| F38 | «Bekreft startpris» (vurdering + bekreftelse) | dekkes allerede av: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) › «Bekreft startpris» |
| F39 | «Hent AI-forslag» | dekkes allerede av: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) › «Hent AI-forslag» |
| F40 | «Løs konflikt» (SKU: omdøpt vare, ny vare, e-post til leverandør) | dekkes allerede av: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (SKU-konflikt) |
| F41 | «Ikke råvare» med grunn og eventuelt utelatelsesmønster | flyttet til: Fra faktura › «Ikke vare» og «Hold utenfor …» |
| F42 | «Åpne varekort» | dekkes allerede av: «Åpne varekort» i fakturaens linjetabell og Varer |
| F43 | «Koble N like linjer» (snapshot, årsaker til eksklusjon) | flyttet til: Fra faktura (ett svar gjelder alle like linjer for leverandørvaren) |
| F47 | MatchDrawer: match én linje (forslag, søk, avtalepris, pakning, husk SKU, primær, AI-hjelp) | flyttet til: Fra faktura (kobling per leverandørvare); feillest enkeltlinje via «Rett linjen» |
| F48 | «Godta og neste» og «Bekreft og bruk på alle like linjer» | flyttet til: Fra faktura (svaret gjelder alle linjer for leverandørvaren) |
| F49 | «Opprett ny vare» og «Åpne varekort» | flyttet til: Fra faktura › «Opprett som ny» |

## Ny råvare (alle veier → én dialog)

| ID | Funksjon | Disposisjon |
|---|---|---|
| F50 | Opprett råvare fra linje (varetype, navn, foreslått SKU, lev.-SKU, kategori/ny, grunnenhet, pakning, bekreft pakning, live kostpris) | flyttet til: Fra faktura › «Opprett som ny» (samme dialog/skrivevei) |
| F51 | Masseopprettelse av råvarer fra valgte linjer (felles kategori) | flyttet til: Fra faktura › «Opprett N sikre» |
| F52 | Masseimport av umatchede linjer som nye råvarer, med AI-forslag | dekkes allerede av: «Opprett N sikre» i Fra faktura; masseimport på fakturasiden beholdt |
| R27 | «Ny råvare» (SKU, kategori, varetype, flere kategorier, navn, basisenhet, pakning, kostpris, beskrivelse, emballasje; åpner råvaren) | uendret: src/ravarer/pages/VareArbeidsflate.tsx |

## Varekoblinger / varekort

| ID | Funksjon | Disposisjon |
|---|---|---|
| F53 | Liste over leverandørvarer: søk, leverandørfilter, seks statusfaner med antall | beholdt – ikke flyttet ennå: leverandørvarelisten /ravarer/priskontroll/varekort (nås fra Leverandører og Varer) |
| F54 | Kolonner (leverandør, varenr., beskrivelse, råvare, pakning, siste pris %, linjer, årsaker, sist sett, status); mobil; tastatur | beholdt – ikke flyttet ennå: leverandørvarelisten |
| F55 | Paging og URL-synk av alle filtre | beholdt – ikke flyttet ennå: leverandørvarelisten |
| F56 | «Hva mangler» i klartekst + merknader (f.eks. karantene) | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F57 | Velg eksisterende råvare (forslag med «Hvorfor», søk) | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F58 | Opprett ny råvare (navn fra beskrivelse, gjettet grunnenhet, varetype, kategori, deklarasjonsnavn) | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F59 | Utledet pakning (regnestykke/varenavn) med forklaring, kildemerke, forhåndskrysset bekreftelse | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F60 | Vis bekreftet pakning med «Endre» | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F61 | «N åpne linjer på M fakturaer» + «Sett som primær leverandør» | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F62 | Koble og regn om alle åpne linjer på alle fakturaer i ett steg | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F63 | «Dette er ikke en vare» med grunn; nye linjer utelates automatisk | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F64 | Resultatoppsummering (koblet, auto-avstemt, gjenstående årsaker, ikke regnet om) + «Neste varekort» | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F65 | Historikk per linje (faktura, mengde, beløp, kr/grunnenhet, status, linjetype, kostpris ført, prishistorikk, merknad) | beholdt – ikke flyttet ennå: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) (brukes av Beslutninger, Varer og Leverandørkort) |
| F66 | Varekort nås fra råvarekort, leverandørkort og vareliste | dekkes allerede av: lenker fra Varer og Leverandørkort |

## Fakturadetalj

| ID | Funksjon | Disposisjon |
|---|---|---|
| F67 | Status, inkl. «Avstemt automatisk» med forklaring | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F68 | Vis/skjul original side om side eller som bunnark; åpne i ny fane | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F69 | Hent linjer fra PDF/Tripletex med teller for forsøk og feilmelding | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F70 | Kjør automatisk matching på nytt | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F71 | Flagg for oppfølging / fjern flagg | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F72 | «Bekreft prismatch» med sperre og forklaring | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F73 | Banner for lav lesesikkerhet | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F74 | Avvik i linjesum: sjekk på nytt, overstyr med begrunnelse | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F75 | «Tripletex mot faktura» (beløp, mva, netto, bilagsnr., betalt, linjesum, avvik, lesesikkerhet, forsøk, kilde) | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F76 | «Rett mva-avvik» | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F77 | «Beregn på nytt» (kø) | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F78 | Kortet Detaljer (org.nr., forfall osv.) | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F79 | Linjetabell: forventet pris, referansekilde, avvik, matchtype, årsaker, linjetype, merknad, valgfri konto | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F80 | Per linje: «Åpne varekort», «Match/Endre match», «Se prishistorikk» | dekkes allerede av: «Åpne varekort»/«Se prishistorikk» i linjetabellen; «Match/Endre match» sender nå til Fra faktura |
| F81 | «Registrer linjer» når fakturaen mangler linjer | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |

## Fakturaliste

| ID | Funksjon | Disposisjon |
|---|---|---|
| F82 | Filtre: selskap, status, leverandør, periode, avvik, betalt, fritekst; sortering og paging | dekkes allerede av: Fakturaer-arkivet (liste med status, søk og filter) |
| F83 | Kolonner: kilde, betalt, status, uttrekksstatus, sumavvik, lav lesesikkerhet | dekkes allerede av: Fakturaer-arkivet (liste med status, søk og filter) |
| F84 | Banner med linjer til gjennomgang + Tripletex-statuskort | dekkes allerede av: arkivlisten; «N ting venter i Fra faktura» på rader og faktura |
| F107 | Automatisk avstemming og visningen «Avstemt automatisk» | dekkes allerede av: Fakturaer-arkivet (liste med status, søk og filter) |

## Godkjenning / Fakturaoversikt

| ID | Funksjon | Disposisjon |
|---|---|---|
| F85 | Bøttene Klare, Avventer, Godkjent; søk og leverandørfilter | uendret: Fakturaer › Godkjenning |
| F86 | Blokkeringer per faktura | uendret: Fakturaer › Godkjenning |
| F87 | Godkjenn valgte internt (med bekreftelse; ingen betaling) | uendret: Fakturaer › Godkjenning |
| F88 | Før kostpris for trygge linjer | uendret: Fakturaer › Godkjenning |
| F89 | Historikk og tilbaketrekking av godkjenning med begrunnelse | uendret: Fakturaer › Godkjenning |

## Leverandørsaker, flagg og kreditnota

| ID | Funksjon | Disposisjon |
|---|---|---|
| F90 | Liste over saker med status | flyttet til: Leverandører › Leverandørsaker (/ravarer/leverandorer?fane=saker) |
| F91 | Sak: linjer, kreditfordeling (kreditnota, faktura, beløp), idempotent lagring | dekkes allerede av: saksiden /ravarer/priskontroll/saker/:id (nås fra Leverandørsaker og Prishopp «Spør leverandøren») |
| F92 | Merk som løst, avbryt eller åpne igjen, med begrunnelse | dekkes allerede av: saksiden |
| F93 | Flagg faktura med begrunnelse og handlingstype | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |
| F94 | Koble kreditnota til opprinnelig faktura | flyttet til: Fra faktura › kreditrad «Koble til opprinnelig faktura» (åpner fakturaens kreditnotadialog) |

## Import

| ID | Funksjon | Disposisjon |
|---|---|---|
| F95 | Import av EHF | uendret: Fakturaer › «Importer faktura» |
| F96 | Import av PDF med AI-uttrekk, automatisk leverandør og forhåndsvisning | uendret: Fakturaer › «Importer faktura» |
| F97 | Manuell registrering av faktura | uendret: Fakturaer › «Importer faktura» |

## Registrer linjer

| ID | Funksjon | Disposisjon |
|---|---|---|
| F98 | Registrer eller erstatt linjer, deretter matching | uendret: fakturasiden › «Registrer linjer» |

## Reberegn kostpriser

| ID | Funksjon | Disposisjon |
|---|---|---|
| F99 | Forslag i fire grupper fra serverens prøvekjøring (Linjer endres, Usikre linjer, Ingen linjer endres, Kunne ikke vurderes); foreløpig forslag, aldri garantert endelig kost | uendret: Fakturaer › Verktøy › «Reberegn kostpriser» |
| R190 | Forslag i fire grupper fra serverens prøvekjøring (Linjer endres, Usikre linjer, Ingen linjer endres, Kunne ikke vurderes); foreløpig forslag, aldri garantert endelig kost | uendret: Fakturaer › Verktøy › «Reberegn kostpriser» |
| R191 | Søk, og velg per rad (lesetilgang: ingen valg/kjøring) | uendret: Fakturaer › Verktøy › «Reberegn kostpriser» |
| R192 | Visning av før, etter, endring, kilde og regnestykke | uendret: Fakturaer › Verktøy › «Reberegn kostpriser» |
| R193 | Bekreft kjøring i bolker med kontekstsjekk før hver bolk; bekreftede bolker lagres straks; ukjent utfall holdes til eksplisitt kontroll; faktisk kost i kvittering | uendret: Fakturaer › Verktøy › «Reberegn kostpriser» |
| R194 | Angre per bolk med serverens svar per post (angret / feilet / uavklart); ukjent angring beholder kvittering | uendret: Fakturaer › Verktøy › «Reberegn kostpriser» |
| R195 | Lenker til Pakninger og fakturaer | uendret: Fakturaer › Verktøy › «Reberegn kostpriser» |

## Vareminne-funksjoner som må gjenopprettes

| ID | Funksjon | Disposisjon |
|---|---|---|
| F100 | Endre eksisterende kobling med påkrevd begrunnelse, sperre når kostpris er ført, vis aliaser og pakninger | dekkes allerede av: leverandørvaren (/ravarer/priskontroll/varekort/:leverandør/:vare) |
| F110 | Revisjonshistorikk (AuditHistory) for faktura og leverandørkobling | dekkes allerede av: fakturasiden i arkivet (/ravarer/priskontroll/faktura/:id) |

## Variant B-flater (ikke i funksjonsmappingen)

### Prislinje (`/ravarer/prislinje` → videresendes til Varer)

| Evne | Disposisjon |
|---|---|
| Prishistorikk per vare og leverandør (stolper, periode, avviksgrense) | flyttet til: Varer › varen › Pris › «Prishistorikk per leverandør» |
| «Rett pris» for ett kjøp (approve/admin, loggført, angre) | flyttet til: samme sted (krever `20261117_prislinje`) |
| «Endre godkjent pakning» med forhåndsvisning | flyttet til: samme sted (krever `20261117_prislinje`) |
| Innstilling for periode/avviksgrense i grafen | flyttet til: Innstillinger › Automatikk og regler |
| «Åpne råvarekortet»-lenke | fjernes (visningen ligger nå på råvarekortet) |
| Lenke fra D5 «Leverandører og innkjøpspris» | flyttet til: lenken «Prishistorikk, rett pris eller pakning» per leverandør |

### Automatikk (`/ravarer/automatikk` → videresendes til Innstillinger › Automatikk og regler)

| Evne | Disposisjon |
|---|---|
| Pant som følgevare, automatisk ny lesing (regelkort) | flyttet til: Innstillinger › Automatikk og regler |
| Regler som venter på databaseendring | flyttet til: samme sted |
| Hopp-over-regler (paller, miljøvederlag, frakt, gebyr) | flyttet til: samme sted |
| Logg over automatiske handlinger | flyttet til: samme sted |
| Leverandørregler for nye varer | flyttet til: samme sted (også i Fra faktura) |
| Prisgrense, stille prisendringer, pakning fra faktura | flyttet til: samme sted; Prishopp har lenke dit |
| Egne grenser per nøkkelråvare | fjernes (Henrik: utgår; «egen grense per vare» i D erstatter dem) |
| Morgen-e-post (forhåndsvisning) | fjernes (bare forhåndsvisning av utsending som ikke er bygget) |

### Beslutninger (`/ravarer/beslutninger`)

| Spørsmålstype | Disposisjon |
|---|---|
| Ukjent vare, pant, hopp over, pakning | flyttet til: Fra faktura › Nye varer |
| Pris / over avtale over grensen, sjekk pakning | flyttet til: Fra faktura › Prishopp |
| Kan ikke leses (faktura) | flyttet til: Fra faktura › Ikke lest |
| Kontroll (lesekontroll av linje) | beholdt – ikke flyttet ennå: ingen radtype i D |
| Små prisendringer under grensen | beholdt – ikke flyttet ennå: blir stille når `20261119_fra_faktura` er kjørt |
| Videresalg, emballasje, råvare ikke klar | beholdt – ikke flyttet ennå: ingen radtype i D |

Derfor står Beslutninger og lenken «Øvrige spørsmål» i Fra faktura igjen.

### Andre ting som er fjernet

| Evne | Disposisjon |
|---|---|
| Arbeidsbord / «Å gjøre» / «Arbeid» / klassisk kø / mengde-diagnostikk | fjernes; gamle adresser videresendes til Fra faktura, leverandørvaren eller fakturaen |
| «Trenger deg»-køen, «Bekreft pakning», linje-for-linje-arbeid | flyttet til: Fra faktura |
| Oversiktens gamle KPI-rad, neste fakturaer, gjøremålsliste, lager over minimum | fjernes; Oversikt viser bare D-kortet og tall som peker til Fra faktura, Varer og Fakturaer |
| Verktøymenyen: Full fakturaliste, Varegrupper, Alle varekort | fjernes fra menyen (arkivet er fakturalisten; leverandørvarer nås fra Leverandører) |
| Verktøymenyen: Importer faktura, Les fakturaer på nytt, Beregn alle åpne, Reberegn kostpriser | uendret |
| Leverandørsak fra Prishopp-raden | flyttet til: Prishopp › «Spør leverandøren …» (utkast til Henrik, aldri direkte til leverandør) |
| Rett feillest linje | flyttet til: «Rett linjen …» under «Vis på fakturaen» i raden, og på fakturasiden |
| Hold utenfor råvarebehandling (linje/faktura) | flyttet til: «Hold utenfor …» ved siden av «Ikke vare» (gjelder nyeste linje; hele fakturaen for kreditnota) |

