# Roadmap – fakturaflyt (Florapan/pose)

- [x] Trinn 1: pose som egen enhet, strengere pakningsforslag, deploy av enhetsbrukende serverfunksjoner
- [x] Rett varetype/grunnenhet (dialog koblet inn)
- [ ] Trinn 2a: utvide `rm_supplier_item_lines` med rabatt/prisgrunnlag/lesevarsler/versjon + felles gjennomgangsplan (hook)
- [ ] Trinn 2b: køkort og varekort på samme plan: hovedårsak, én primærhandling, kompakt sjekkliste i fast rekkefølge
- [ ] Trinn 2c: handlinger per faktura (Bekreft 100 g pose, Registrer rabatt/Avklar prisgrunnlag, Bekreft første pris, Vurder pris) med eksakt faktura/linje/retur; kortet blir stående til 0 åpne
- [ ] Trinn 2d: ryddig høyrepanel, kompakte tellere, sammenleggbar historikk, fast primærknapp 44 px
- [ ] Trinn 2e: kildemerking generert Tripletex-PDF vs leverandøroriginal fra dokumentinnhold; vise rabatt/netto-regnestykke
- [ ] Trinn 2f: nettverksfri forhåndsvisning av hele flyten (390/1280/1440) + komponent-/integrasjonstester
- [ ] Deploy til gjennomgang: suggest-invoice-line-match, ai-config-test, extract-invoice-from-pdf, invoice-model-eval
