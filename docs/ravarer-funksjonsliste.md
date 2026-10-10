# Råvarer – funksjonsliste (sjekkliste for Råvarer 2.0)

Alle funksjoner her skal finnes etter remaken: Råvarer R1–R203 og Fakturaer F1–F110, med originalnummerering fra inventarene. Kolonnen «Ny plassering» viser ny sti og seksjon, fane eller panel. «Fase» er fasen som flytter funksjonen: 1 Fundament/nav, 2 Oversikt, 3 Priskontroll, 4 Varer, 5 Leverandører/Lager/Innstillinger, 6 Mobil/opprydding. «Status» starter som «Gammel plass» og settes til «Flyttet» og deretter «Verifisert» når fasen gjennomgås.
Stier i tabellene er relative til `/ravarer` (f.eks. `/varer/:id` = `/ravarer/varer/:id`). Seksjonene i råvarekortet heter `/varer/:id?seksjon=sammendrag|pris|leverandorer|naering|deklarasjon|bruk|lager|grunndata|historikk`. I Priskontroll er «varekort-panel» høyre panel i `?fane=gjore`, og «linjeinspektør» er høyre sone i `/ravarer/priskontroll/faktura/:id`.

## Navigasjon, tilgang og felles

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R1 | Råvarer-meny med grupper, nedtrekk og aktiv-markering | RavarerNav: Oversikt · Varer · Priskontroll · Leverandører · Lager + tannhjul | 1 | Gammel plass |
| R2, F2, F3 | Meny-badger: linjer til behandling, varekort som venter (ukoblet + mangler pakning), avtaler som utløper, ukvitterte datablad-endringer | RavarerNav-badge per inngang fra `rm_work_summary` (samme tall som Oversikt og faner) | 1 | Gammel plass |
| R3, F4 | Tilgang: fakturadel og forhandlinger krever fakturatilgang (`user_has_invoice_access`, roller read/write/approve/admin); Innstillinger krever approve/admin; AI-tjenester krever plattformadmin | Rutevakter på /priskontroll/*, /leverandorer/forhandlinger/* og /innstillinger (vakt på ruten, ikke bare i menyen) | 1 | Gammel plass |
| R4 | Mobilmeny som bunnark | RavarerNav mobil-bunnark (5 innganger + Innstillinger) | 1 | Gammel plass |
| R5 | Sidetitler i nettleserfanen | `pageLabels.ts` komplett for alle nye ruter | 1 | Gammel plass |
| R6, F1 | Omdirigeringer: /ravarer, /pakninger, /innstillinger, fakturaer /ny, /import-ehf, /import-pdf, /vareminne, /fakturaer/* | Omdirigeringskart i App.tsx: alle gamle stier peker til nye, og query videreføres. /ravarer blir Oversikt | 1 | Gammel plass |
| F108 | Nivådelt forklaring av prisavvik (speiler `rm_price_deviation_eval`) i alle prisvisninger | Felles PriceDeviationNote: varekort-panel › Prisblokk, linjeinspektør, råvarekort ?seksjon=pris | 3 | Gammel plass |
| F109 | Oversatte etiketter for årsakskoder, matchtype og linjetype | `src/ravarer/lib/labels.ts` (én kilde) + StatusPill | 1 | Gammel plass |

## Vareliste

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R7 | Fritekstsøk på navn, SKU, lev.-SKU og alias, med chip «lev.nr X» | /varer › søkefelt | 4 | Gammel plass |
| R8 | Filtre for kategori, varetype og status, lagret i URL | /varer › filterrad (bunnark på mobil) | 4 | Gammel plass |
| R9 | Åtte innebygde visninger (Alle, Mangler pakning/deklarasjon/næring, Avvik, Ikke kjøpt 12 mnd, Uten leverandør, Inaktive) | /varer?liste=pakning\|deklarasjon\|naering\|prisavvik\|uten-leverandor\|ikke-kjopt\|inaktive (arbeidslister) | 4 | Gammel plass |
| R10 | Avviksregel: kategoritoleranse + maksgrense (`isLargeDeviation`) | ?liste=prisavvik; samme regel i forrige/neste på råvarekortet | 4 | Gammel plass |
| R11 | Lagrede visninger (inkl. view): lagre, bruke, slette | /varer › visningsvelger | 4 | Gammel plass |
| R12 | Kolonnevelger med 15 kolonner (inkl. Priskilde, Pris oppdatert, Beholdning), lagret per bruker | /varer › DataTable kolonnevelger | 4 | Gammel plass |
| R13 | Sortering på 11 nøkler (`sort=key:dir`) | /varer › DataTable-header | 4 | Gammel plass |
| R14 | Radklikk åpner råvaren med listekonteksten bevart | ?valgt=:id (peek-panel) + «Åpne fullt» → /varer/:id med liste-query | 4 | Gammel plass |
| R15 | Inline kostpris med «Hvorfor?», skriver prishistorikk og setter gjeldende pris | Celle Kostpris → CostPriceEditor (begrunnelse) | 4 | Gammel plass |
| R16 | Inline avtalepris (primærkobling, ellers eldre felt) | Celle Avtalepris → kobling hos primærleverandør; eldre felt har knappen «Flytt til leverandør» | 4 | Gammel plass |
| R17 | Inline primærkategori | Celle Kategori | 4 | Gammel plass |
| R18 | Velg rader og «Velg alle synlige» | DataTable masseutvalg | 4 | Gammel plass |
| R19 | Masse: sett kategori | Massehandlingsrad | 4 | Gammel plass |
| R20 | Masse: sett varetype | Massehandlingsrad | 4 | Gammel plass |
| R21 | Masse: sett primærleverandør | Massehandlingsrad via PrimarySupplierControl (synker `is_primary`) | 4 | Gammel plass |
| R22 | Masse: aktiver og deaktiver | Massehandlingsrad | 4 | Gammel plass |
| R23 | Masse: kø for å bekrefte pakning (hopper over bekreftede) | Massehandlingsrad → PackageEditor i kø | 4 | Gammel plass |
| R24 | Masse: CSV med valgte rader × synlige kolonner (`;`, BOM) | Massehandlingsrad «Eksporter CSV» (norske verdier) | 4 | Gammel plass |
| R25 | Tøm valg | Massehandlingsrad | 4 | Gammel plass |
| R26 | Hurtigtaster `/`, ↑, ↓, Enter, `e`, `n`, Esc | useHotkeys + J/K og `?`-liste | 4 | Gammel plass |
| R28 | Banner om leverandørvarer som venter, lenke til Varekoblinger | Hint i header «N varekort venter» → /priskontroll?fane=gjore | 4 | Gammel plass |
| R29 | Mobil kortliste med merkene Avvik, Mangler deklarasjon og Inaktiv | DataTable mobilkort på /varer | 6 | Gammel plass |
| R30 | Teller «{filtrert} av {totalt}» og tom/laster/feil-tilstander | Tabellfot + QueryState | 4 | Gammel plass |

## Råvarekort – header og navigasjon

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R31 | Brødsmuler og «Tilbake» som bevarer listefiltre | /varer/:id › header (crumbs) | 4 | Gammel plass |
| R32 | Forrige/neste og `[` / `]` i listerekkefølge | Header; bruker samme filter og avviksregel som listen | 4 | Gammel plass |
| R33 | Endre navn (`rename_raw_material`) | Header «Endre navn» | 4 | Gammel plass |
| R34 | Statuschips (aktiv, type, kategorier, deklarasjon, datablad, allergener, næring) | Header: StatusPill + komplett-sjekkliste med hopp til løsning | 4 | Gammel plass |
| R35 | KPI-stripe med 9 KPI-er og lenke til primærleverandør | ?seksjon=sammendrag | 4 | Gammel plass |
| R36 | Fane lagret i URL (`?tab=`) | `?seksjon=` med kart fra gamle `?tab=`-verdier | 4 | Gammel plass |
| R37 | ⌘S lagrer aktiv fane | ⌘S lagrer seksjonen, med indikator for ulagrede endringer | 4 | Gammel plass |

## Råvarekort – Oversikt

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R38 | SKU, navn, deklarasjonsnavn, beskrivelse, basisenhet, primær + flere kategorier (★) | ?seksjon=grunndata (deklarasjonsnavn også i ?seksjon=deklarasjon) | 4 | Gammel plass |
| R39 | Vis pakning + «Endre pakning» (forhåndsvis, regn om, angre) | ?seksjon=grunndata › Pakning → PackageEditor | 4 | Gammel plass |
| R40 | Brytere for Aktiv og Emballasje | ?seksjon=grunndata | 4 | Gammel plass |
| R41 | Bakerifelt: kornklasse, kornslag (validering), vann %, vekt per stk | ?seksjon=grunndata › Bakerifelt | 4 | Gammel plass |
| R42 | Gjeldende kostpris, avtalepris (eldre felt) og primærleverandør | ?seksjon=pris (CostPriceEditor) + ?seksjon=leverandorer (PrimarySupplierControl, «Eldre avtalepris» → «Flytt til leverandør») | 4 | Gammel plass |
| R43 | Omregningshistorikk med «Angre» | ?seksjon=grunndata › Omregninger | 4 | Gammel plass |
| R44 | Forkast/Lagre med vakt mot å forlate ulagrede endringer | Sticky lagrerad for alle seksjoner | 4 | Gammel plass |

## Råvarekort – Priser & leverandører

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R45 | «Prisgrunnlag akkurat nå» per leverandør, med toleranse | ?seksjon=pris › Prisgrunnlag nå (+ peek-panel i varelisten) | 4 | Gammel plass |
| R46 | «Varekort hos leverandører»: tabell + varekort-panel (koble, opprett, pakning, primær, ikke vare) | ?seksjon=leverandorer › Varekort → samme varekort-panel som i Priskontroll | 4 | Gammel plass |
| R47 | Startpris: «Sett som avtalepris» og «Fjern startpris» med begrunnelse (approve/admin) | ?seksjon=pris › Startpris | 4 | Gammel plass |
| R48 | Koblingstabell: bytte prisenhet, karantenemerke, utløpsfarger, avtaledokument | ?seksjon=leverandorer › Koblinger (farger fra `agreementStatus.ts`) | 4 | Gammel plass |
| R49 | «Ny leverandør» | ?seksjon=leverandorer › felles SupplierDialog | 4 | Gammel plass |
| R50 | Koble/rediger leverandør (SKU, produktnavn, pakning, baseenheter, avtalepris per pakning/base, gyldighet, primær, fjern) | ?seksjon=leverandorer › RmSupplierDialog (pakning via PackageEditor, primær via PrimarySupplierControl) | 4 | Gammel plass |
| R51 | Pristidslinje med avtalebånd, Δ, klikk til faktura og CSV | ?seksjon=pris › Pristidslinje | 4 | Gammel plass |
| R52 | «Registrer pris» (pris, dato, leverandør, kilde, notat, sett gjeldende) | ?seksjon=pris › «Registrer pris» (CostPriceEditor) | 4 | Gammel plass |
| R53 | Siste fakturalinjer med lenker | ?seksjon=pris › Siste fakturalinjer → /priskontroll/faktura/:id | 4 | Gammel plass |
| R54 | Innkjøpsstatistikk: periode og sammenligning, månedstabell, innsikt | ?seksjon=pris › Innkjøp (uten emoji) | 4 | Gammel plass |

## Råvarekort – Næring & deklarasjon

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R55 | Deklarasjonsnavn med «Foreslå» og «Bruk Matvaretabellen-navn» | ?seksjon=deklarasjon | 4 | Gammel plass |
| R56 | Datablad: opplasting, AI-uttrekk, «Bruk» per felt, bekreft fjerning av allergener, snarvei til pakning, versjonshistorikk | ?seksjon=deklarasjon › Datablad | 4 | Gammel plass |
| R57 | Matvaretabellen-kilde (oppdater, hent på nytt, bekreft overskriving, koble fra) | ?seksjon=deklarasjon › Matvaretabellen-kilde | 4 | Gammel plass |
| R58 | 11 næringsfelt med «Manuelt overstyrt», auto-energi, «Marker som verifisert», kJ/kcal-varsel, kilde, lagre | ?seksjon=naering | 4 | Gammel plass |
| R59 | Ingrediensdeklarasjon, opprinnelsesland, kilde, E-numre | ?seksjon=deklarasjon | 4 | Gammel plass |
| R60 | 25 allergener med tre tilstander, lagres straks | ?seksjon=naering › Allergener | 4 | Gammel plass |
| R61 | AI-forslag til allergener (velg, bruk, forkast) | ?seksjon=naering › Allergener | 4 | Gammel plass |
| R62 | Næringsfanen skjules for emballasje | Seksjonsnavigasjonen skjuler naering når `is_packaging` | 4 | Gammel plass |

## Råvarekort – Oppskrifter, Lager, Historikk (gamle faner)

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R63 | Oppskrifter som bruker råvaren (mengde, kost, andel), med lenker | ?seksjon=bruk › Oppskrifter | 4 | Gammel plass |
| R64 | Lagersporing, min. beholdning, telling, ark med bevegelser | ?seksjon=lager | 4 | Gammel plass |
| R65 | Bryter for handelsvare (videresalg) | ?seksjon=lager | 4 | Gammel plass |
| R66 | «Selges som» (legg til produkt, faktor/enhet, fjern) | ?seksjon=bruk › Selges som | 4 | Gammel plass |
| R67 | Avanserte enheter (standard innkjøps-, telle- og salgsenhet; legg til, rediger, slett; pris per enhet) | ?seksjon=lager › Enheter | 4 | Gammel plass |
| R68 | Prissammenligning (avtale, forrige kjøp, snitt 90 d; leverandørfilter; fakturalenker) | ?seksjon=pris › Sammenligning | 4 | Gammel plass |
| R69 | Samlet tidslinje med filter, merker for eldre logikk og karantene, fakturalenker | ?seksjon=historikk (norske etiketter) | 4 | Gammel plass |

## Lager

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R70 | Fire lager-KPI-er | /lager?fane=beholdning › KPI-fliser | 5 | Gammel plass |
| R71 | Global «Registrer telling» med varevelger | /lager › handling i header | 5 | Gammel plass |
| R72 | Videresalgstabell (disponibelt, min., dager igjen, neste levering, sist kjøpt; merker for oversolgt og lav) | ?fane=beholdning (filter Videresalg) | 5 | Gammel plass |
| R73 | Telling og Svinn per rad | ?fane=beholdning › radhandlinger | 5 | Gammel plass |
| R74 | Radklikk åpner bevegelser | ?fane=beholdning&valgt=:id (peek-panel) | 5 | Gammel plass |
| R75 | Alle lagerførte varer, med søk og KPI-er | ?fane=beholdning (filter Alle lagerførte) | 5 | Gammel plass |
| R76 | Bevegelseslogg med filtre for dato, type og årsak, og søk | ?fane=bevegelser | 5 | Gammel plass |
| R77 | Fortjeneste (DB kr, DB %, solgt 30 d) | ?fane=fortjeneste | 5 | Gammel plass |
| R78 | «Bør bestilles» + «Kopier liste» | ?fane=bestilling | 5 | Gammel plass |
| R79 | Fakturalinjer uten mengde i baseenhet (90 d), med lenker | /priskontroll?fane=gjore › kø «Linjer uten mengde» | 5 | Gammel plass |
| R80 | Justeringsdialog: telling, svinn, åpningsbeholdning, med enheter | Felles StockAdjustDialog (?fane=beholdning og råvarekort ?seksjon=lager) | 5 | Gammel plass |

## Varemottak

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R81 | KPI-er for mottak | /lager?fane=varemottak › KPI-fliser | 5 | Gammel plass |
| R82 | Filtre for datoperiode og leverandør | ?fane=varemottak › filterrad | 5 | Gammel plass |
| R83 | Fakturaliste med mottaksstatus | ?fane=varemottak › DataTable | 5 | Gammel plass |
| R84 | Mottaksark per faktura | ?fane=varemottak&valgt=:fakturaId (peek-panel) | 5 | Gammel plass |
| R85 | Motta linje (`rm_receive_invoice_line`) | Peek-panel › «Motta», nå med lot og best før | 5 | Gammel plass |
| R86 | Avvik (mindre, mer, knust) med notat | Peek-panel › «Avvik» | 5 | Gammel plass |
| R87 | Sett pakning og regn linjen om | Peek-panel › PackageEditor + omregning av linjen | 5 | Gammel plass |
| R88 | Manuelt mottak med varesøk, mengde, enhet og notat | ?fane=varemottak › «Registrer mottak» | 5 | Gammel plass |

## Varetelling

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R89 | Telleliste med filtre for kategori og type, og søk | /lager?fane=telling | 5 | Gammel plass |
| R90 | Telling i flere enheter | ?fane=telling › rad (UnitAmountRows) | 5 | Gammel plass |
| R91 | Lokasjon per vare | ?fane=telling › rad | 5 | Gammel plass |
| R92 | KPI-er (varer, talt opp, differanse i kr) | ?fane=telling › KPI-fliser | 5 | Gammel plass |
| R93 | Lokalt utkast med fortsett/forkast, og ark på serveren | ?fane=telling › gjenoppta-banner | 5 | Gammel plass |
| R94 | «Sett resten til 0» | ?fane=telling › handlingsrad | 5 | Gammel plass |
| R95 | Notat på tellingen | ?fane=telling › handlingsrad | 5 | Gammel plass |
| R96 | Bokfør telling (`rm_stock_count_apply_v2`) med resultatdialog | ?fane=telling › sticky «Bokfør telling» | 5 | Gammel plass |

## Pakninger

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R97 | Statuskort (mangler, avviker, ustabil pris, uten pris, mangler kostpris, ubekreftet, OK, ingen fakturaer) | /varer?liste=pakning › tellerchips | 4 | Gammel plass |
| R98 | URL-filter (ubekreftet, mistenkelig, bekreftet, alle) og søk | ?liste=pakning&filter=… + søk | 4 | Gammel plass |
| R99 | Kolonner i arbeidslisten (referanse, forslag, spredning, kjøpt 12 mnd m.m.) | ?liste=pakning › arbeidsmodus-kolonner | 4 | Gammel plass |
| R100 | Forslag fra siste faktura | ?liste=pakning › kolonne Forslag | 4 | Gammel plass |
| R101 | Bekreft via SetPackageDialog (forslag, egen leverandørpakning, begrunnelse, forhåndsvis, bruk, angre, tidligere omregninger) | ?liste=pakning › «Bekreft» → PackageEditor | 4 | Gammel plass |
| R102 | Kort med mistenkelige pakninger | ?liste=pakning&filter=mistenkelig | 4 | Gammel plass |

## Deklarasjonsnavn

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R103 | Arbeidsliste sortert etter bruk | /varer?liste=deklarasjon | 4 | Gammel plass |
| R104 | Lagre inline | ?liste=deklarasjon › inline-felt | 4 | Gammel plass |
| R105 | «Lagre alle utfylte (N)» | ?liste=deklarasjon › «Lagre alle» | 4 | Gammel plass |
| R106 | Seksjon for sammensatte råvarer | ?liste=deklarasjon › gruppe «Sammensatte» | 4 | Gammel plass |
| R107 | Åpne råvaren | Peek-panel / «Åpne fullt» ?seksjon=deklarasjon | 4 | Gammel plass |

## Matvaretabellen

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R108 | Kort for dekning av næringsdata | /varer/matvaretabellen › header | 4 | Gammel plass |
| R109 | Gruppefilter, søk og paging | /varer/matvaretabellen › DataTable | 4 | Gammel plass |
| R110 | Kolonner for næringsstoffer | /varer/matvaretabellen › DataTable | 4 | Gammel plass |
| R111 | Koble til eksisterende råvarer (flere, merket «Allerede koblet», bekreft overskriving) | Radmeny › «Koble til råvare» | 4 | Gammel plass |
| R112 | Opprett som ny råvare | Radmeny → RawMaterialCreateSheet (forhåndsutfylt) | 4 | Gammel plass |
| R113 | Åpne i matvaretabellen.no | Radmeny | 4 | Gammel plass |
| R114 | Synk fra Matvaretabellen | Header «Oppdater fra Matvaretabellen» | 4 | Gammel plass |
| R115 | Lenke til Koble Matvaretabellen | Dekningskort → /varer?liste=naering | 4 | Gammel plass |

## Koble Matvaretabellen

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R116 | Arbeidsliste uten næring, sortert etter bruk | /varer?liste=naering | 4 | Gammel plass |
| R117 | Masse: «Koble entydige treff» (≥ 0,8) | ?liste=naering › «Koble entydige (N)» | 4 | Gammel plass |
| R118 | Forslagschips med % | ?liste=naering › inline forslag | 4 | Gammel plass |
| R119 | «Velg annen» med bekreft overskriving | ?liste=naering › FoodPickerDialog | 4 | Gammel plass |
| R120 | «Hopp over» | ?liste=naering › radhandling | 4 | Gammel plass |
| R121 | Seksjon for delvise data (datablad/manuelt) | ?liste=naering › gruppe «Delvise data» | 4 | Gammel plass |
| R122 | Koble fra Matvaretabellen | ?liste=naering radmeny + ?seksjon=deklarasjon › Matvaretabellen-kilde | 4 | Gammel plass |

## Leverandører

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R123 | Søk, filterchips (Alle, Kun følges, Kun aktive), vis inaktive | /leverandorer?fane=leverandorer | 5 | Gammel plass |
| R124 | Hent fra Tripletex | ?fane=leverandorer › header | 5 | Gammel plass |
| R125 | Ny/rediger leverandør (sjekk av dobbelt org.nr, kontakt, notater, aktiv, følg linjer) | Felles SupplierDialog | 5 | Gammel plass |
| R126 | Bryter «Følg fakturalinjer» med bekreftelse og henting av 12 mnd | ?fane=leverandorer › kolonne + leverandørkort | 5 | Gammel plass |
| R127 | Kolonner med status, siste faktura og antall | ?fane=leverandorer › DataTable + peek-panel | 5 | Gammel plass |

## Leverandørkort

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R128 | Merker og kontaktlenker (mailto, tel) | /leverandorer/:id › header | 5 | Gammel plass |
| R129 | Redigere notater | ?seksjon=notater | 5 | Gammel plass |
| R130 | KPI-er (andel av innkjøp, avtaler som utløper, prisindeks …) | ?seksjon=oversikt (uten duplikat-KPI) | 5 | Gammel plass |
| R131 | Statuschips for varekort, lenker til Varekoblinger | ?seksjon=varer › chips → /priskontroll?fane=gjore&leverandor=:id | 5 | Gammel plass |
| R132 | Pristidslinje per vare med CSV | ?seksjon=varer › Pristidslinje | 5 | Gammel plass |
| R133 | Varetabell (sortering, avtalemerke, dokument), åpner råvaren | ?seksjon=varer (redigerbar kobling, lenke /varer/:id) | 5 | Gammel plass |
| R134 | Fakturafane med merke for sumavvik og «Vis flere» | ?seksjon=fakturaer → /priskontroll/faktura/:id | 5 | Gammel plass |
| R135 | Aliasfane med søk, type, treff, sist sett | ?seksjon=aliaser (redigerbar, «Endre kobling») | 5 | Gammel plass |
| R136 | Rediger leverandør | Header › SupplierDialog | 5 | Gammel plass |

## Avtaler

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R137 | Søk og filtre for leverandør, kategori og status | /leverandorer?fane=avtaler | 5 | Gammel plass |
| R138 | Avtaletabell med status og dokument | ?fane=avtaler › DataTable | 5 | Gammel plass |
| R139 | Radklikk åpner råvarens prisfane | → /varer/:id?seksjon=leverandorer | 5 | Gammel plass |
| R140 | Ny avtale (vare, leverandør, SKU, navn, pris per pakning/enhet, pakning, gyldighet, primær, PDF; `rm_apply_agreement`) | ?fane=avtaler › «Ny avtale» (norske etiketter) + leverandørkort ?seksjon=avtaler | 5 | Gammel plass |
| R141 | Badge for avtaler som utløper | Fanen Avtaler + Oversikt-KPI (`rm_work_summary`) | 5 | Gammel plass |

## Datablad-endringer

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R142 | Filter (uavklarte, alle) | /varer?liste=datablad | 4 | Gammel plass |
| R143 | Detalj for endringen, før/etter | ?liste=datablad › peek-panel | 4 | Gammel plass |
| R144 | Bekreft én | Peek-panel › «Bekreft endring» | 4 | Gammel plass |
| R145 | Bekreft alle | ?liste=datablad › «Bekreft alle (N)» | 4 | Gammel plass |
| R146 | Åpne råvarens næringsfane | → /varer/:id?seksjon=naering | 4 | Gammel plass |

## Datablad-opplasting

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R147 | Masseopplasting av inntil 100 filer | /varer/datablad-opplasting | 4 | Gammel plass |
| R148 | Sammendrag av hva AI leste | Samme side › rad per fil | 4 | Gammel plass |
| R149 | Kandidatmatching (forhåndsvalgt ≥ 0,7) | Rad per fil › kandidatvelger | 4 | Gammel plass |
| R150 | Anvend per fil | Rad per fil › «Anvend» | 4 | Gammel plass |
| R151 | Bekreft alle med høy konfidens | Header-handling | 4 | Gammel plass |
| R152 | Opprett råvare fra datablad | Rad per fil → RawMaterialCreateSheet (datablad-variant) | 4 | Gammel plass |
| R153 | Pakningsdialog | Rad per fil → PackageEditor | 4 | Gammel plass |
| R154 | Rydd opp foreldreløse datablad (åpne, slett) | Seksjon «Rydd opp» | 4 | Gammel plass |

## Forhandlinger

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R155 | Liste med type og status | /leverandorer?fane=forhandlinger | 5 | Gammel plass |
| R156 | Velg RFQ eller Live | ?fane=forhandlinger › «Ny forhandling» | 5 | Gammel plass |
| R157 | Veiviser: grunninfo | /leverandorer/forhandlinger/ny › steg 1 | 5 | Gammel plass |
| R158 | Veiviser: velg råvarer med 12 mnd grunnlag | Steg 2 | 5 | Gammel plass |
| R159 | Veiviser: velg fulgte leverandører | Steg 3 | 5 | Gammel plass |
| R160 | Veiviser: e-posttekst | Steg 4 | 5 | Gammel plass |
| R161 | Veiviser: generer lenker og passord, kopier e-poster | Steg 5 | 5 | Gammel plass |
| R162 | Rediger RFQ | /leverandorer/forhandlinger/:id/rediger | 5 | Gammel plass |
| R163 | KPI-er i detaljen | /leverandorer/forhandlinger/:id › header | 5 | Gammel plass |
| R164 | Status per mottaker og «Send påminnelse» | /forhandlinger/:id › Mottakere | 5 | Gammel plass |
| R165 | Tilbudsmatrise med valg av vinner | /forhandlinger/:id › Tilbudssammenligning | 5 | Gammel plass |
| R166 | Merke for mottatt datablad | Tilbudsmatrise (ikon, ikke emoji) | 5 | Gammel plass |
| R167 | Avslutt med valg (ingen vinner, aktiver alle, oppdater pris, primær, leverandør) og bruk utfallet | /forhandlinger/:id › «Avslutt forhandling» | 5 | Gammel plass |
| R168 | Live-oppsett (leverandør, tittel, sted, notater, forhåndslast varer) | /leverandorer/forhandlinger/live/ny | 5 | Gammel plass |
| R169 | Live: tidtaker | /forhandlinger/live/:id › header | 5 | Gammel plass |
| R170 | Live: legg til varer | Live › søk «Legg til råvare» | 5 | Gammel plass |
| R171 | Live: statusflyt per vare | Live › LiveItemCard (felles statusetiketter) | 5 | Gammel plass |
| R172 | Live: vilkår per vare | Live › LiveItemCard | 5 | Gammel plass |
| R173 | Live: pause og gjenoppta | Live › header | 5 | Gammel plass |
| R174 | Live: tidslinje over hendelser | Live › «Tidslinje»-skuff | 5 | Gammel plass |
| R175 | Live: avslutt, lenke og passord, kopier sammendrag, mailto, auto-aktivering | Live › «Avslutt» (ingen råkode i teksten) | 5 | Gammel plass |
| R176 | Leverandørportal for RFQ (passord, tilbudsfelt, PDF, kladd, send og lås) | /tilbud/:token (uendret funksjon, visuelt løftet) | 5 | Gammel plass |
| R177 | Bekreftelsesportal for live (passord, bekreft/notat per linje, datablad, vilkår, betalingsdager, kladd, send) | /bekreftelse/:token (uendret funksjon) | 5 | Gammel plass |

## Innstillinger

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R178, F102 | Nivådelt prisavvik: toleranse, minste kronevirkning, maksgrense, med eksempel | /innstillinger?seksjon=priskontroll › Prisavvik | 5 | Gammel plass |
| R179, F103 | Godta første pris, bekreft utledet pakning og avstem rene fakturaer automatisk | ?seksjon=priskontroll › Automatikk | 5 | Gammel plass |
| R180, F104 | Linjetyper som utelates automatisk | ?seksjon=priskontroll › Automatikk | 5 | Gammel plass |
| R181, F105 | Beregn alle åpne fakturaer på nytt, med køstatus (i kø, under arbeid, ferdig siste time, feilet siste døgn) | ?seksjon=priskontroll + Priskontroll › Verktøy «Beregn alle åpne på nytt» | 5 | Gammel plass |
| R182, R183, R184, R186, F106 | Fuzzy-terskler (forslag, automatch, klar vinner); auto-godkjenning innen toleranse og mot siste kjøp; startprisregler; kategoritoleranser (legg til, rediger, slett med bekreftelse) | ?seksjon=priskontroll › Matching / Startpris / Kategoritoleranser (én lagringsmodell) | 5 | Gammel plass |
| R185, F101 | Startpriskandidater fra historikk (bekreft valgte) | ?seksjon=priskontroll › Startpriskandidater | 5 | Gammel plass |
| R187 | Tripletex: selskap, autentisering, tokens, autosynk og frekvens, test, lagre, kjør faktura- og leverandørsynk, status, historikk | ?seksjon=tripletex | 5 | Gammel plass |
| R188 | Kategorioversikt (antall, kun lesing) | ?seksjon=kategorier | 5 | Gammel plass |
| R189 | AI-oppsett (leverandør, modell, nøkkel, Azure, tokens, temperatur), test, lagre, slett, forbruk og kostnad 30 d | ?seksjon=ai (bare plattformadmin) | 5 | Gammel plass |

## Reberegn kostpriser

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R190, F99 | Skann i fire bøtter med forklaring (Rettes, Må bekreftes, Uendret, Kan ikke beregnes); helheten skann, prøvekjøring, bruk, angre | /priskontroll/verktoy/reberegn | 3 | Gammel plass |
| R191 | Søk, og velg per rad og per bøtte | /verktoy/reberegn › DataTable | 3 | Gammel plass |
| R192 | Visning av før, etter, endring, kilde og regnestykke | /verktoy/reberegn › kolonner | 3 | Gammel plass |
| R193 | Bekreft bruk (prøvekjøring → bruk → oppdater statistikk) | /verktoy/reberegn › «Oppdater kostpriser» | 3 | Gammel plass |
| R194 | Angre batch | /verktoy/reberegn › resultat «Angre» | 3 | Gammel plass |
| R195 | Lenker til Pakninger og fakturaer | → /varer?liste=pakning og /priskontroll/faktura/:id | 3 | Gammel plass |

## Ny råvare (alle veier → én dialog)

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R27 | «Ny råvare» (SKU, kategori, varetype, flere kategorier, navn, basisenhet, pakning, kostpris, beskrivelse, emballasje; åpner råvaren) | RawMaterialCreateSheet fra /varer header, tasten `n` og ⌘K | 1 | Gammel plass |
| F50 | Opprett råvare fra linje (varetype, navn, foreslått SKU, lev.-SKU, kategori/ny, grunnenhet, pakning, bekreft pakning, live kostpris) | RawMaterialCreateSheet i fakturakontekst via `link-supplier-item` (regner om linjene) | 1 | Gammel plass |
| F51 | Masseopprettelse av råvarer fra valgte linjer (felles kategori) | /priskontroll?fane=gjore › masseutvalg › «Opprett råvarer» | 3 | Gammel plass |
| F52 | Masseimport av umatchede linjer som nye råvarer, med AI-forslag | /priskontroll/faktura/:id › linjer › masseutvalg «Importer som nye råvarer» | 3 | Gammel plass |

## Fakturaer: I dag / Beslutninger / Råvarespørsmål

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| F5 | Prioritert topp-5 over beslutninger på tvers av fakturaer | /ravarer › «Til deg» (topp 7) + /priskontroll?fane=gjore sortert etter kronevirkning | 2 | Gammel plass |
| F6 | Tellere «N åpne beslutninger på M fakturaer» og «gjentatte linjer slått sammen» | /ravarer › header-setning + Å gjøre-køtall | 2 | Gammel plass |
| F7 | Kort for varekort som venter, med lenke | /ravarer › KPI «Å gjøre i priskontroll» → ?fane=gjore | 2 | Gammel plass |
| F8 | Kort med fakturaer klare til intern godkjenning | /ravarer › KPI → /priskontroll?fane=godkjenning | 2 | Gammel plass |
| F9 | Beslutningsliste: søk, leverandørfilter, typefilter, paging, «alle» eller «bare råvarer» | ?fane=gjore › venstre: køer, søk, leverandørfilter | 3 | Gammel plass |
| F10 | Material: velg forslag, søk i hele registeret, bruk på alle like linjer og husk (alias) | Varekort-panel › Råvare-blokk | 3 | Gammel plass |
| F11 | Material: opprett ny råvare og koble resten av gruppen | Varekort-panel › «Opprett ny råvare» | 3 | Gammel plass |
| F12 | Package: bekreft pakning for alle linjer i gruppen | Varekort-panel › Pakning-blokk | 3 | Gammel plass |
| F13 | First cost: sett manglende pakning og før første kostpris | Varekort-panel › «Første kostpris» | 3 | Gammel plass |
| F14 | Price: referanse mot fakturert pris, nivådelt forklaring, samlet kronebeløp | Varekort-panel › Prisblokk | 3 | Gammel plass |
| F15 | Price: godta avviket for alle linjer, med sjekk av at linjene er uendret | Prisblokk › «Godta ny pris» (`rm_supplier_item_accept_price`) | 3 | Gammel plass |
| F16 | Price: opprett én leverandørsak for gruppen | Prisblokk › «Opprett leverandørsak» | 3 | Gammel plass |
| F17 | Gå automatisk til neste etter lagring, i samme filterrekkefølge | Resultatboks + «Neste» (auto ved tastatur) | 3 | Gammel plass |
| F18 | Frys gruppen mens den vises | Varekort-panel fryser valgt element (`?valgt=`) | 3 | Gammel plass |

## Varekoblinger / varekort

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| F53 | Liste over leverandørvarer: søk, leverandørfilter, seks statusfaner med antall | ?fane=gjore › køer (Mangler kobling, Mangler pakning, Prisendringer, Kontroll) + visning «Alle varekort» for Koblet/Ikke vare | 3 | Gammel plass |
| F54 | Kolonner (leverandør, varenr., beskrivelse, råvare, pakning, siste pris %, linjer, årsaker, sist sett, status); mobil; tastatur | ?fane=gjore › listerader (mobilkort, J/K) | 3 | Gammel plass |
| F55 | Paging og URL-synk av alle filtre | ?fane=gjore&q=&leverandor=&valgt= | 3 | Gammel plass |
| F56 | «Hva mangler» i klartekst + merknader (f.eks. karantene) | Varekort-panel › topp | 3 | Gammel plass |
| F57 | Velg eksisterende råvare (forslag med «Hvorfor», søk) | Varekort-panel › Råvare-blokk | 3 | Gammel plass |
| F58 | Opprett ny råvare (navn fra beskrivelse, gjettet grunnenhet, varetype, kategori, deklarasjonsnavn) | Råvare-blokk → RawMaterialCreateSheet | 3 | Gammel plass |
| F59 | Utledet pakning (regnestykke/varenavn) med forklaring, kildemerke, forhåndskrysset bekreftelse | Varekort-panel › Pakning-blokk | 3 | Gammel plass |
| F60 | Vis bekreftet pakning med «Endre» | Pakning-blokk → PackageEditor | 3 | Gammel plass |
| F61 | «N åpne linjer på M fakturaer» + «Sett som primær leverandør» | Varekort-panel › Gjelder-blokk (PrimarySupplierControl) | 3 | Gammel plass |
| F62 | Koble og regn om alle åpne linjer på alle fakturaer i ett steg | Varekort-panel › hovedknapp (L) | 3 | Gammel plass |
| F63 | «Dette er ikke en vare» med grunn; nye linjer utelates automatisk | Varekort-panel › «Ikke vare» (X) | 3 | Gammel plass |
| F64 | Resultatoppsummering (koblet, auto-avstemt, gjenstående årsaker, ikke regnet om) + «Neste varekort» | Resultatboks + «Neste» | 3 | Gammel plass |
| F65 | Historikk per linje (faktura, mengde, beløp, kr/grunnenhet, status, linjetype, kostpris ført, prishistorikk, merknad) | Varekort-panel › Historikk | 3 | Gammel plass |
| F66 | Varekort nås fra råvarekort, leverandørkort og vareliste | /varer/:id?seksjon=leverandorer, /leverandorer/:id?seksjon=varer, /varer peek → samme panel | 4 | Gammel plass |

## Til behandling / innboks

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| F19 | Innboksfaner «Må avklares», «Klar til å fullføre», «Fullført» | /priskontroll?fane=fakturaer › hurtigfiltre | 3 | Gammel plass |
| F20 | Søk på leverandør eller fakturanr., leverandørfilter, «Vis flere» | ?fane=fakturaer › DataTable | 3 | Gammel plass |
| F21 | «Oppdater matching» for alle fakturaer, med fremdrift og feilliste | Priskontroll › Verktøy «Beregn alle åpne på nytt» (kø + status) | 3 | Gammel plass |
| F22 | Hovedknapp per faktura (Se flagget, Hent linjer, Registrer linjer, Koble kreditnota, Fullfør kontroll, Avklar N) | ?fane=fakturaer › rad-hovedknapp + Å gjøre › Fakturasak-kort | 3 | Gammel plass |
| F23 | Radmeny (åpne detalj, kjør matching, flagg, fjern flagg) | ?fane=fakturaer › radmeny | 3 | Gammel plass |
| F24 | Fokusvisning: fremdrift, angre siste, originalfaktura, «Bekreft prismatch» | /priskontroll/faktura/:id › header (tidslinje + én hovedknapp) | 3 | Gammel plass |
| F25 | Varsel om feil på fakturanivå med «Rett registreringen» | /faktura/:id › faktasone | 3 | Gammel plass |
| F26 | Linjekø: årsaksfilter (13 grupper), tre sorteringer | ?fane=gjore (kronevirkning, hyppighet, dato) + /faktura/:id › linjefilter | 3 | Gammel plass |
| F27 | «Kontroller linjer på tvers av fakturaer» (opptil 200) | ?fane=gjore (gruppert per varekort på tvers av fakturaer) | 3 | Gammel plass |
| F28 | Masse: godta forslag, ikke aktuell, opprett råvarer | ?fane=gjore › masseutvalg | 3 | Gammel plass |
| F44 | Hurtigtaster ↑/↓, Enter, m, n, x, u, Esc | Å gjøre: J/K, Enter, L, P, G, X, U, `?`; linjeinspektør: m, n, x, u | 3 | Gammel plass |
| F45 | Angre siste linjehandling | U / «Angre» i resultatboks og linjeinspektør | 3 | Gammel plass |
| F46 | Dokumentpanel ved siden av køen; tilstand huskes | /faktura/:id › dokumentsone (kan skjules) | 3 | Gammel plass |

## Linjeoppgave og MatchDrawer

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| F29 | Oppgavekort med linjestatus og tre steg (råvare, pakning, pris) | Linjeinspektør | 3 | Gammel plass |
| F30 | Forslag og søk på navn/varenr., valgfri treffprosent | Linjeinspektør › Råvare | 3 | Gammel plass |
| F31 | Bekreft råvare (og pakning) i ett steg | Linjeinspektør › hovedknapp | 3 | Gammel plass |
| F32 | Pakningsskjema med hint fra varenavn og varsel ved uenighet | Linjeinspektør › Pakning (PackageEditor-logikk) | 3 | Gammel plass |
| F33 | «Husk varenummer» / «Husk varetekst» (aliaslæring, avviste forslag) | Linjeinspektør › «Dette lagres» | 3 | Gammel plass |
| F34 | «Prisen er riktig» (godta per linje) | Linjeinspektør › Pris | 3 | Gammel plass |
| F35 | «Rett avtalepris» og beregn på nytt | Linjeinspektør › Pris (+ Prisblokk i varekort-panel) | 3 | Gammel plass |
| F36 | «Kontroller pakningen» og «Endre råvare» fra prissteget | Linjeinspektør › Pris | 3 | Gammel plass |
| F37 | «Beregn prisen på nytt» / «Prøv igjen» ved feil | Linjeinspektør (via køen) | 3 | Gammel plass |
| F38 | «Bekreft startpris» (vurdering + bekreftelse) | Linjeinspektør › Startpris | 3 | Gammel plass |
| F39 | «Hent AI-forslag» | Linjeinspektør › AI | 3 | Gammel plass |
| F40 | «Løs konflikt» (SKU: omdøpt vare, ny vare, e-post til leverandør) | Linjeinspektør › SKU-konflikt | 3 | Gammel plass |
| F41 | «Ikke råvare» med grunn og eventuelt utelatelsesmønster | Linjeinspektør › «Ikke vare» (felles grunnliste) | 3 | Gammel plass |
| F42 | «Åpne varekort» | Linjeinspektør og linjerad → varekort-panel | 3 | Gammel plass |
| F43 | «Koble N like linjer» (snapshot, årsaker til eksklusjon) | Linjeinspektør etter kobling → BulkLinkDialog / varekort-panel | 3 | Gammel plass |
| F47 | MatchDrawer: match én linje (forslag, søk, avtalepris, pakning, husk SKU, primær, AI-hjelp) | Linjeinspektør › «Bare denne linjen» (`rm_confirm_line_match`) | 3 | Gammel plass |
| F48 | «Godta og neste» og «Bekreft og bruk på alle like linjer» | Linjeinspektør › hovedknapp + «Bruk på like» | 3 | Gammel plass |
| F49 | «Opprett ny vare» og «Åpne varekort» | Linjeinspektør → RawMaterialCreateSheet / varekort-panel | 3 | Gammel plass |

## Fakturaliste

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| F82 | Filtre: selskap, status, leverandør, periode, avvik, betalt, fritekst; sortering og paging | /priskontroll?fane=fakturaer › DataTable | 3 | Gammel plass |
| F83 | Kolonner: kilde, betalt, status, uttrekksstatus, sumavvik, lav lesesikkerhet | ?fane=fakturaer › kolonne Leveransestatus (Mottatt → … → Kostpris ført) + egne kolonner | 3 | Gammel plass |
| F84 | Banner med linjer til gjennomgang + Tripletex-statuskort | ?fane=fakturaer › header-tellere + TripletexStatusCard | 3 | Gammel plass |
| F107 | Automatisk avstemming og visningen «Avstemt automatisk» | Leveransestatus «Avstemt (auto)» + /ravarer › «Skjedde automatisk» | 3 | Gammel plass |

## Fakturadetalj

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| F67 | Status, inkl. «Avstemt automatisk» med forklaring | /priskontroll/faktura/:id › header-tidslinje | 3 | Gammel plass |
| F68 | Vis/skjul original side om side eller som bunnark; åpne i ny fane | Dokumentsone (bunnark på mobil) | 3 | Gammel plass |
| F69 | Hent linjer fra PDF/Tripletex med teller for forsøk og feilmelding | Hovedknapp «Hent linjer» (én knapp, riktig kilde) | 3 | Gammel plass |
| F70 | Kjør automatisk matching på nytt | Én omberegningsknapp (køen) | 3 | Gammel plass |
| F71 | Flagg for oppfølging / fjern flagg | Header › meny | 3 | Gammel plass |
| F72 | «Bekreft prismatch» med sperre og forklaring | Hovedknapp «Avstem» (sperre forklart) | 3 | Gammel plass |
| F73 | Banner for lav lesesikkerhet | Faktasone (vises én gang) | 3 | Gammel plass |
| F74 | Avvik i linjesum: sjekk på nytt, overstyr med begrunnelse | Faktasone › Sumavvik | 3 | Gammel plass |
| F75 | «Tripletex mot faktura» (beløp, mva, netto, bilagsnr., betalt, linjesum, avvik, lesesikkerhet, forsøk, kilde) | Faktasone (slår sammen Detaljer, Tripletex og bannere) | 3 | Gammel plass |
| F76 | «Rett mva-avvik» | Faktasone › handling + Fakturasak-kort | 3 | Gammel plass |
| F77 | «Beregn på nytt» (kø) | Header › omberegningsknapp | 3 | Gammel plass |
| F78 | Kortet Detaljer (org.nr., forfall osv.) | Faktasone | 3 | Gammel plass |
| F79 | Linjetabell: forventet pris, referansekilde, avvik, matchtype, årsaker, linjetype, merknad, valgfri konto | Linjesone (midten) | 3 | Gammel plass |
| F80 | Per linje: «Åpne varekort», «Match/Endre match», «Se prishistorikk» | Linjesone › radhandlinger → linjeinspektør / varekort-panel / /varer/:id?seksjon=pris | 3 | Gammel plass |
| F81 | «Registrer linjer» når fakturaen mangler linjer | Hovedknapp → /faktura/:id/registrer-linjer | 3 | Gammel plass |

## Import

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| F95 | Import av EHF | /priskontroll?importer=ehf (sidepanel) | 3 | Gammel plass |
| F96 | Import av PDF med AI-uttrekk, automatisk leverandør og forhåndsvisning | ?importer=pdf (leverandør via felles SupplierDialog-logikk) | 3 | Gammel plass |
| F97 | Manuell registrering av faktura | ?importer=manuelt | 3 | Gammel plass |

## Registrer linjer

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| F98 | Registrer eller erstatt linjer, deretter matching | /priskontroll/faktura/:id/registrer-linjer | 3 | Gammel plass |

## Godkjenning / Fakturaoversikt

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| F85 | Bøttene Klare, Avventer, Godkjent; søk og leverandørfilter | /priskontroll?fane=godkjenning | 3 | Gammel plass |
| F86 | Blokkeringer per faktura | ?fane=godkjenning › rad/peek | 3 | Gammel plass |
| F87 | Godkjenn valgte internt (med bekreftelse; ingen betaling) | ?fane=godkjenning › sticky handlingsrad | 3 | Gammel plass |
| F88 | Før kostpris for trygge linjer | ?fane=godkjenning › handlingsrad + hovedknapp «Før kostpris» på /faktura/:id | 3 | Gammel plass |
| F89 | Historikk og tilbaketrekking av godkjenning med begrunnelse | ?fane=godkjenning › peek › Historikk | 3 | Gammel plass |

## Leverandørsaker, flagg og kreditnota

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| F90 | Liste over saker med status | /priskontroll?fane=saker | 3 | Gammel plass |
| F91 | Sak: linjer, kreditfordeling (kreditnota, faktura, beløp), idempotent lagring | /priskontroll/saker/:id | 3 | Gammel plass |
| F92 | Merk som løst, avbryt eller åpne igjen, med begrunnelse | /saker/:id › sticky handlingsrad | 3 | Gammel plass |
| F93 | Flagg faktura med begrunnelse og handlingstype | Flagg-dialog fra /faktura/:id, fakturaliste og Fakturasak-kort (kan opprette sak; lover ikke e-post) | 3 | Gammel plass |
| F94 | Koble kreditnota til opprinnelig faktura | Å gjøre › Fakturasak-kort «Koble kreditnota» + /faktura/:id | 3 | Gammel plass |

## Vareminne-funksjoner som må gjenopprettes

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| F100 | Endre eksisterende kobling med påkrevd begrunnelse, sperre når kostpris er ført, vis aliaser og pakninger | Varekort-panel › «Endre kobling» (`rm_change_supplier_link`) + leverandørkort ?seksjon=aliaser | 3 | Gammel plass |
| F110 | Revisjonshistorikk (AuditHistory) for faktura og leverandørkobling | /faktura/:id › Historikk; varekort-panel › Historikk; råvarekort ?seksjon=historikk | 3 | Gammel plass |

## Kryssmodul-funksjoner (må fortsatt virke)

| ID | Funksjon | Ny plassering | Fase | Status |
|---|---|---|---|---|
| R196 | RawMaterialAutocomplete: velg og hurtigopprett i oppskrifter og produkter | Varer (uendret sted) → RawMaterialCreateSheet | 1 | Gammel plass |
| R197 | Lagre oppskrift som råvare (halvfabrikat) og koble til eksisterende | Varer › oppskrift (uendret); vises i /varer/:id?seksjon=bruk | 4 | Gammel plass |
| R198 | Rettinger fra oppskriftsetikett (allergener vurdert, vann %, kornklasse, koble fritekstlinje) | Varer › etikett (uendret), felles skrivehooks | 4 | Gammel plass |
| R199 | Rettinger av deklarasjonsnavn fra oppskriftsetikett | Varer › etikett (felles `useSaveDeclarationName`) | 4 | Gammel plass |
| R200 | «Trekker fra lager» på produktkortet | Varer › produkt → /varer/:id?seksjon=lager | 4 | Gammel plass |
| R201 | Lenker fra faktura til råvare (detalj og `?tab=suppliers`) | → /varer/:id?seksjon=leverandorer | 3 | Gammel plass |
| R202 | Fakturaflyten skriver koblinger, pakninger, avtale- og startpriser, kostpris og aliaser | `link-supplier-item`, `rm_confirm_line_match`, `rm_post_safe_line_costs`, `rm_change_supplier_link` | 3 | Gammel plass |
| R203 | Offentlige portalruter `/tilbud/:token` og `/bekreftelse/:token` | Uendrede ruter | 5 | Gammel plass |

## Kryssmodul-lenker som må virke

- **Varer › oppskrift/produkt:** RawMaterialAutocomplete «Opprett ny råvare» åpner RawMaterialCreateSheet. «Lagre oppskriften som råvare» og «Koble til eksisterende» virker. ?seksjon=bruk lenker til `/varer/oppskrifter/:id`.
- **Varer › etikett:** InlineRawMaterialFix, MissingDeclarationNames og DeclarationNameInline. «Åpne råvarekortet» → `/ravarer/varer/:id?seksjon=deklarasjon`.
- **Varer › produktkort:** StockLinkNote «Trekker fra lager» → `?seksjon=lager`. CalculationTab og CostPriceTab leser kostpris, og tallene må stemme.
- **Faktura → råvare:** `/ravarer/vareliste/:id` og `?tab=suppliers` → `/ravarer/varer/:id?seksjon=leverandorer`. BulkImportRawMaterialsDrawer → `/ravarer/varer`.
- **TripletexStatusCard** → `/ravarer/innstillinger?seksjon=tripletex`.
- **SupplierItemStatusChips og SupplierItemsBanner** → `/ravarer/priskontroll?fane=gjore&leverandor=…`.
- **Leverandørkort, Avtaler og råvarekort:** lenker til `/priskontroll/faktura/:id` og `/varer/:id?seksjon=leverandorer`.
- **⌘K:** `raw_material` og `supplier` blir søkbare, med hurtighandlingene Ny råvare, Importer faktura og Åpne priskontroll.
- **Forhandlinger:** genererte lenker peker til uendrede `/tilbud/:token` og `/bekreftelse/:token`.
- **Gamle bokmerker:** hele omdirigeringstabellen virker, inkludert `?tab=`→`?seksjon=`, Varekoblinger `?status=`/`?leverandor=` og innboksens `?fane=klar`.
- **`/produksjon/lager`:** overlappen med Råvarer › Lager er ikke undersøkt. Avklar før fase 5.

## Kjente hull som skal tettes

1. **Vareminne-tap (F100, F110):** endre kobling med begrunnelse, sperre når kostpris er ført, aliaser og revisjonshistorikk må tilbake. Verifiser at `link-supplier-item` håndhever sperren.
2. **Flagg-dialogen lover e-post** som aldri sendes.
3. **QuickCreate setter kategorien «Annet»,** som ikke finnes i `RAW_MATERIAL_CATEGORIES`.
4. **Innstillingsrutene har ikke rollevakt.** Bare menyen skjuler dem.
5. **Ulik skrivetilgang:** approve kan koble i køen, men ikke i varekort eller I dag. Velg én regel.
6. **Blindveier ved prisavvik:** Varekoblinger «Prisavvik» har ingen handling, og InvoiceDetail har ingen godta-knapp.
7. **Leverandørsak** kan bare opprettes fra DecisionDetail (price).
8. **Badge-tall spriker:** `useReviewCount` filtrerer ikke på selskap og blander `ready` og `no_baseline`. Kort, grupper og fakturaer telles om hverandre. Alt skal komme fra `rm_work_summary`.
9. **Menyfilteret «Klar for prismatch»** (`?filter=klar`) er dødt.
10. **Varemottak** viser ikke lot og best før.
11. **Kategorier** kan bare leses, teller bare primærkategori og kan ikke forvaltes.
12. **⌘K** søker ikke i råvarer eller leverandører.
13. **Leverandørkortet:** varer og aliaser kan ikke redigeres, og to KPI-er er like.
14. **OverviewTab:** kostpris lagres uten historikk, `price_source` vises som råkode, og primærvalget synker ikke `is_primary`. Masse-primær er ikke bekreftet.
15. **RmSupplierDialog** skriver pakning uten omregning og angre.
16. **Avtalepris ligger i to felt** med 7 redigerere. Kostpris har 4 redigerere, og primærleverandør har 6 settere.
17. **Forrige/neste** bruker en annen avviksregel enn listen.
18. **Råkoder i UI:** «Kilde: invoice», HistoryTab `change_type · field`, CSV-pakning, «Referanse (last_purchase)» og `awaiting_confirmation`.
19. **Emoji som status:** 🔴🟡⚪ 📎 💡 ✅ ⚠️.
20. **Engelske etiketter:** Supplier SKU/produktnavn, API-key, Max tokens, Temperature.
21. **Forhandlinger** har to statusetikettsett.
22. **MatchToleranser** har to lagringsmodeller og overlappende innstillinger: første pris ↔ startpris, minste kronevirkning ↔ maks kronepåvirkning, auto-godkjenning ↔ nivådelt. Fallback-toleransen er endret fra 5 til 3.
23. **Omberegning** har 6 innganger og 2 motorer. «Kjør auto-match» skriver direkte, og «Hent linjer» finnes 3 steder.
24. **Ny råvare** har 9 veier. `createRawMaterialFromLine` regner ikke linjene om.
25. **«Ikke vare»** finnes på 4 måter med ulike grunnlister og etiketter.
26. **InvoiceDetail** viser fakta 4 ganger. Det finnes 3 «ferdig»-begreper uten samlet status, og ingen visning av hva som skjedde automatisk.
27. **Navnekonflikter:** «Fakturaer» er to sider, avstemming har 4 navn, og DecisionNav og meny har ulike etiketter.
28. **Varekort med status Koblet og Ikke vare** trenger et hjem: «Alle varekort» i Priskontroll og leverandørkort ?seksjon=varer.
29. **Leverandøropprettelse** finnes 3 steder, og ImportPdf setter inn direkte.
30. **Sidetitler** mangler for 8 ruter. Reberegn er merket «Fakturaer», og det finnes en løs deklarasjonsassistent-regel.
31. **Død kode:** `QueueTable`, `Vareminne.tsx`, aliaset `n` i `useRmSuppliers`, gamle bannere og DecisionNav. Utløpsfargene dupliserer `agreementStatus.ts`.
32. **Mobil** fungerer bare i varelisten, og der uten massehandlinger og inline-redigering.
33. **Forbehold:** NutritionTab, DatasheetSection, DeclarationNameCard, RecipesTab og StockTab er lest fra et eldre øyeblikksbilde. Les dem på nytt før fase 4.
