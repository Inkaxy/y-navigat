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
