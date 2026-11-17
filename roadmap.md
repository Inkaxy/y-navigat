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
- [x] Root kjørte 20261113_lines_sum_credit_vat og 20261113_line_extraction_release_requeue 15.11.2026
- [ ] Venter på root: 20261113_ai_fallback_provider og 20261113_invoice_reading_alert_template
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
- [x] 1b Svarknapper direkte i spørsmålet (dagens skriveveier) + pakningsretting med forhåndsvisning
- [x] 1c «Angre»/«Angre siste» bygget; pris/«ikke vare» skjult til root kjører 20261117_beslutninger_angre («én gang» virker nå)
- [ ] 1d Brutto/DG2 før og etter per vare i spørsmålet (Prisgrunnlag viser det per vare; ikke koblet inn i spørsmålet ennå)
- [x] 2 Prislinje (B4): meny, søyler, «Alle priser», kost, andre leverandører, klar for bruk, endringslogg; «Rett pris»/«Endre godkjent pakning»/avviksgrense venter på 20261117_prislinje
- [x] 3 Automatikk (B7): regler som setninger (dagens innstillinger), logg, hopp over, morgen-e-post (forhåndsvisning); pant/bolk/nøkkelråvarer venter på 20261117_automatikk (+ DATAENDRING-fil for timekjøring)
- [x] 3b Matchmotoren bruker nøkkelgrenser og pant-som-følgevare (i repo, ikke rullet ut; venter root-gjennomgang + 20261117_automatikk)
- [ ] 3c Morgen-e-post faktisk utsending (planlagt kjøring + mal)
- [x] Runde 3 (16.11): SQL fra runde 2 IKKE kjørt — alt bak rm_cap_* forblir skjult/deaktivert uten feilmelding
- [x] 4 Handelsvarer (B5) i Varer › Priser: matrise handelsvare × prisliste, innpris/påslag/salgspris, standard 1,2, overstyring per vare/prisgruppe, via ulagrede endringer + set_prices
- [x] 5 Prisgrunnlag (B6) i Varer: kalkylekort, emballasje/handelsvare som linje, emballasje i Brutto+DG2 (innstilling), innsatsfaktorer siste 12 mnd / hele historikken
- [x] 6 Råvarer-Oversikt: åpne beslutninger, lesestatus, største prisendringer, lenker; Fakturaer uendret
- [x] 3b Nøkkelgrenser + pant som følgevare i matchingen bak cap
- [x] Banner «Fakturalesingen står stille» → «Nøkkelen er testet og virker, venter på første lesing» etter vellykket nøkkeltest

# Demo D – «Fra faktura til vare» (17.11.2026) — erstatter variant B som hovedflyt
- [x] SQL: 20261119_fra_faktura.PENDING.sql + .check.sql (grense, per vare, leverandørregel, skrivemåter, angre kobling, «Kalkylen bruker» md5-vakt) og 20261119_fra_faktura_opprydding.DATAENDRING.sql (dry-run)
- [x] 1 Ny side Råvarer › «Fra faktura» (D1–D4) + meny (erstatter Beslutninger i menyen, «Øvrige spørsmål (n)» nederst)
- [x] 1a Nye varer: koble/opprett/ikke vare, pakning i raden, utsnitt, kvittering+Angre, «Opprett N sikre», leverandørchips, regellinje
- [x] 1b Prishopp: grense (20 %), per vare, Prisen stemmer / Feil pakning / Legg i prisrunden
- [x] 1c Ikke lest: årsak i klartekst, Åpne PDF, Les alle på nytt (rm_requeue_invoice_line_extraction, bekreftelse)
- [x] 2 Varer: «Leverandører og innkjøpspris» i peek, hovedleverandør, «Kalkylen bruker», «Ny fra faktura»
- [x] 3 Matching: skrivemåter, pakning fra faktura, stille prisendring under grensen – bak innstillinger (av til SQL er kjørt)
- [x] Tester, typekontroll, bygg, AGENTS/README, rapport

# Feil i «Fra faktura › Nye varer» (17.11.2026) – tidsavbrudd i rm_work_items
- [x] Felles port: ett tungt oppslag om gangen, ett nytt forsøk ved tidsavbrudd
- [x] Nye varer sidevis (50) med «Vis flere», leverandørfilter på serveren, feil bare for delen som mangler
- [x] Tellere uten egne listekall (delte tellere, menyen låner sidens oppsummering); Prishopp/Ikke lest lastes først ved åpning
- [x] PENDING 20261119_nye_varer_les (+ .check.sql, PGlite-test) – rask lesefunksjon bak cap
- [ ] Kjøre 20261119_nye_varer_les (root)

# «Ikke lest» sitter fast (17.11.2026)
- [x] Del fanen: «Ikke lest» (ingen linjer) og «Lest, men summen stemmer ikke» (har linjer)
- [x] Summen stemmer ikke: «Les på nytt» (gjenlesing med forslag), differanse i kr, «Godta som den er» (begrunnelse, kan angres), «Åpne PDF»
- [x] Ærlig melding etter «Les alle på nytt»
- [x] «N venter på lesing» (sammenfoldet)
- [x] Dry-run sumkontroll for gamle fakturaer + DATAENDRING-fil (ikke kjørt)
- [ ] Kjøre 20261119_godta_sum (root); DATAENDRING sumkontroll tas med Henrik

# Opprydding – kun versjon D (17.11.2026, Henrik)
- [ ] Steg 1: docs/ravarer-opprydding-demo-d.md (flytteliste fra funksjonsmappingen)
- [ ] Steg 2: flytt evner inn i D (kreditnota-radtype, rett feillest linje, hold utenfor, leverandørsaker, prishistorikk/rett pris/endre pakning i Varer, Automatikk-regler i Innstillinger, Beslutninger-typer)
- [ ] Steg 3: fjern Prislinje/Automatikk/Beslutninger (videresending), Fakturaer som rent arkiv, Oversikt bare D, død kode
- [ ] Steg 4: SQL-liste (ubrukte rm_*-funksjoner, utgåtte PENDING-filer)
