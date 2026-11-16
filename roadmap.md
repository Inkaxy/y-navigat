# Roadmap – fakturaflyt (Florapan/pose)

- [x] Trinn 1: pose som egen enhet, strengere pakningsforslag, deploy av enhetsbrukende serverfunksjoner
- [x] Rett varetype/grunnenhet (dialog koblet inn)
- [x] Trinn A-kontroll: frossen dialog/payload, op_gjenbrukt, original kvittering, ubekreftede faktorer, godkjente fakturaer urørt, lagertekst
- [x] B: felles pakningsfelt (Kjøpes som/Fakturert som/Innhold per)
- [x] C: fersk serverkvittering, kort beholdes ved gjenstående
- [x] Trinn 2a: utvide `rm_supplier_item_lines` med rabatt/prisgrunnlag/lesevarsler/versjon + felles gjennomgangsplan (hook)
- [~] Trinn 2b: plan brukt i valgt varekort; køkortet bruker fortsatt aggregatstatus (har ikke linjene)
- [x] Trinn 2c: primærhandling per eldste åpne linje + én neste handling per faktura med eksakt faktura/linje/retur; kort beholdes til 0 åpne
- [~] Trinn 2d: plan/primærknapp/«hvorfor venter» lagt inn; full opprydding av eksisterende blokker i høyrepanelet og kompakte køtellere gjenstår: ryddig høyrepanel, kompakte tellere, sammenleggbar historikk, fast primærknapp 44 px
- [x] Trinn 2e: kildemerking generert Tripletex-PDF vs leverandøroriginal fra dokumentinnhold; vise rabatt/netto-regnestykke
- [x] Trinn 2f: nettverksfri forhåndsvisning av hele flyten (390/1280/1440) + komponent-/integrasjonstester
- [ ] Deploy til gjennomgang: suggest-invoice-line-match, ai-config-test, extract-invoice-from-pdf, invoice-model-eval
- [x] Regresjon 1539842: rabatt/prisgrunnlag/lesevarsler i inspektør, varekort og plan; ingen død prisknapp; varetype vist atskilt fra kategori
- [x] rm_infer_package v3: bare bekreftede ikke-erstattede varianter, g/ml-grunnlag regnes om til kg/l; matcher bruker bare bekreftede varianter (deployet)

# Råvaremodul-remake (15.10.2026)
- [x] 1 Oversikt som arbeidsstart: statusstripe med enhet (ukjent = –), én «Start behandling» (eldste først), 5 neste oppgaver, snarveier; prisutvikling/aktivitet/datakvalitet bak «Mer»
- [x] 2 Fakturaflyt (ny fane «Fakturaer», `fane=arbeid`): én liste → én faktura → oppgave → lagre → kvittering → neste; filtre Trenger deg/Klare/Ferdig/Holdt utenfor; 1280×800 over bretten; valgfri original
- [x] 3 Guidet (førstepris via rm_confirm_start_price-dialog) blokkerrekkefølge lesing→råvare→pakning→pris→godkjenning; førstegangspris via rm_set_documented_cost_price
- [x] 4 Vareliste (delvis, se melding) + råvarekort forenklet, avansert bak sekundær tilgang
- [~] 5 Leverandør/Lager/Innstillinger samme rytme, ingen dobbel header
- [ ] Skjermbilder 390/1280/1440, full testsamling

# Demo C – faktura/råvare/pris (13.11.2026) — ERSTATTET av variant B 16.11.2026
- [x] Oppdater plan med Henriks svar (intern godkjenning beholdes, DB 11 strykes)
- [x] Fase 0: verifiser fase a-punkter + undersøk Tripletex EHF/strukturerte linjer (bare lesing)
- [x] Fase a1: «Alle priser» (bare lesing) i RawMaterialPeek og råvarekortets Pris-seksjon + tester
- [ ] a2 «Rett pris» – venter på Henriks ja til DB-endring 1

# Rettepakke fakturalesing (13.11.2026)
- [x] A AI-feil ≠ «ingen lesbare linjer» (extract + import, stopp ved auth-feil, null linjer med beløp = kontroll)
- [x] B Varsel Oversikt/Fakturaer + e-post til Henrik (2 på rad, maks 1/døgn)
- [x] C Reserveleverandør (forslag/PENDING + kode klar)
- [x] D Kreditnota-fortegn i sumkontroll
- [x] E Mva 0 på hode = mangler når posteringer viser mva
- [x] F Avgift/gebyr/frakt/pant i oppsummering som linjer (prompt/skjema)
- [x] G Lange fakturaer: oppdeling ved kutt
- [x] H Tallkontroll antall×pris=beløp, entydig retting
- [x] I Klargjør gjenlesing (45/28/60), ikke kjør
- [ ] Venter på root: fire PENDING-SQL 20261113_* (kreditnota/mva 0, forsøk/requeue, reserve, e-postmal)
- [ ] Venter på Henrik: ny OpenAI-nøkkel under AI-tjenester, deretter start «Les på nytt i bolk»

# Kvalitetstest fakturalesing før gjenlesing (15.11.2026)
- [x] Nøkkelsjekk per lagret oppsett, lesing med valgt oppsetts nøkkel (OpenAI/Anthropic), sidebolker, målinger mot kontrollsum/fasit
- [x] Fast testsett (10 fasit, 9 vanskelige, 3 uten linjer) + knapp under AI-tjenester + tester; invoice-model-eval rullet ut
- [ ] Venter på Henrik: kjør «Start kvalitetstest» i forhåndsvisningen og send eksportert JSON, deretter tabeller og anbefaling

# Variant B – beslutninger, ikke fakturaer (16.11.2026)
- [x] Plan og roadmap oppdatert til variant B
- [x] 0 Haster: sidelesing lagres alltid (Drammen Papir 9041438168), aldri «ingen lesbare linjer» når sider ble lest, ≥5 sider leses side for side direkte; extract-invoice-from-pdf + invoice-model-eval rullet ut
- [ ] 0b Venter på Henrik: legg 9041438168 tilbake i køen via «Les på nytt» (ikke kjørt av meg)
- [x] 1a Beslutninger (B1): meny med teller, kø eldste først, 12 spørsmålstyper, fakta (regnestykke, kjøp, «Det systemet vet», fakturautdrag, bruk), svar via dagens paneler, kvittering + Neste, tom kø, vennlig «Spør leverandøren»-tekst
- [ ] 1b Tre svarknapper direkte i spørsmålet (Ja godta / Spør leverandøren / Pakningen er feil) med forhåndsvisning av pakningsretting
- [ ] 1c «Angre» og «Angre siste» – krever PENDING-SQL (angre-RPC per svartype)
- [ ] 1d Brutto/DG2 før og etter per vare i spørsmålet (bygges sammen med fase 5)
- [ ] 2 Prislinje (B4): «Alle priser», «Rett pris», «Endre godkjent pakning»
- [ ] 3 Automatikk (B7): regler, logg, nøkkelråvarer, hopp over, pant, morgen-e-post
- [ ] 4 Handelsvarer (B5) i Varer
- [ ] 5 Prisgrunnlag (B6) i Varer
- [ ] 6 Fakturaer som arkiv + ny Oversikt
