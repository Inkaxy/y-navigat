# Roadmap — NBhub

## Varer 7b/7: P0-feil og regresjoner etter G1–G6 — ferdig
- [x] A Dekningsprosent med vannregel (declaration-core + begge edge-funksjoner, Deno-test)
- [x] B isGlutenFree på allergenkoder (keyhole.ts + Deno-test)
- [x] C Fullkorn av tørrstoff (58,6 / 45,0 / 30,8 i Deno-test)
- [x] D AI-PDF-import mot riktige produktkolonner
- [x] E Sjekkliste godtar markert/klartekst allergen
- [x] F Ny vare får kost (units_per_batch/dough_piece_grams + marginmål)
- [x] G Halvfabrikat-linjer og fjern-kobling i linjegridet
- [x] H Advarselslenker mot riktige ruter
- [x] I Kornklasse-verdier som CHECK godtar
- [x] J whole_grain_grams vs vektet grovkorn (coarse_weighted_grams)
- [x] K Næringsavrunding og etiketter fra én kilde
- [x] L Kun edge skriver produktsnapshot
- [x] M Ingen falsk «endret av noen andre» etter egen lagring
- [x] N Kanonisk enhetsliste og tetthet
- [x] O Ingen nye eslint-disable + PDF-wrap

## Varer 7c/7: komplettering av delvis leverte G1–G6
- [ ] 1 Grid-tastatur (input+select, forslagsnavigasjon, test)
- [ ] 2 Vektet vanntemperatur lagret på oppskriften + PDF-linje
- [ ] 3 Skalering → ny oppskrift med skalerte mengder + PDF per sats
- [ ] 4 Sticky statuslinje, Fordeig %, margin, missing_cost
- [ ] 5 Splitt RecipeDetail + invalidering + selskapsfiltrert råvarespørring
- [ ] 6 Likt enhetsantall (RecipeSummaryCard + validate-recipe-share)
- [ ] 7 Stektap som krav i declarationGate
- [ ] 8 Fritekst-kornlinjer låser grovhetspåstand
- [ ] 9 Ordre-dialog viser godkjent snapshot + manuell sperre i edge
- [ ] 10 Tekst-rester, deklarasjonsnavn, (øvrige), arvet næring
- [ ] 11 Nøkkelhull-grafikk, grunnlagstekst, grenser, salt gr. 9, væskeliste
- [ ] 12 Halvfabrikat modell B
- [ ] 13 Meny med sju grupper + prismatrise-kolonner
- [ ] 14 Opprydding (as any, fetchAllRows, priser, døde ruter, invalidering)
- [ ] 15 Merking-siden restpunkter
- [ ] 16 PrintLabelDialog mangler fra RPC
- [ ] 17 Én definisjon av næringsfeltene
- [ ] 18 Manglende tester
