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

## Tillegg fra 7a-restpunkter
- [ ] A «Mangler N felt» i KobleMatvaretabellen.tsx regnet i klienten fra raw_material_nutrition
- [ ] B normalizePackageUnit koblet inn i SetPackageDialog.tsx
- [ ] C Deno-tester på autorisasjonsgrenen i microsoft-graph-subscription-renew og pakkesystem-push-cron
- [ ] D Fjern env CRON_SECRET-grenen i microsoft-graph-subscription-renew

## Intern lanseringsstatus – ordrelagring (8cc8227-oppfølging)
- [x] Ny linje skilles fra eksisterende via database-id; produkt/merknad brukes ikke lenger som identitet
  (`src/ordre/lib/orderLineRows.ts`, `src/ordre/hooks/useCustomerOrders.ts`)
- [x] Ny linje bærer egen bekreftet pris/kilde fra prisoppslaget (`appendProductLine` i `CustomerOrderModal.tsx`)
- [x] Utestående prisoppslag forkastes ved lukking og ved bytte av ordre/kunde (`src/ordre/hooks/usePricingTracker.ts`)
- [x] Tester: `src/test/orderLineRows.test.ts` (6), `src/test/usePricingTracker.test.tsx` (3)
- Status: IKKE erklært 100 % lanseringsklar. `src/test/ticketInbox.test.tsx` er tidsavhengig (timeout ved
  samtidig bygg, grønn alene) og bør stabiliseres før lansering.

## Anvendte sikkerhetsmigrasjoner (speilet i repo, IKKE kjørt på nytt av meg)
- [x] 20260912191531 `restrict_global_cake_cleanup_to_server` — fil i `supabase/migrations/`
- [x] 20260912204709 `scope_close_delivered_orders_to_user_entities` — ordrett kopi hentet fra
  `supabase_migrations.schema_migrations.statements`, lagt i `supabase/applied-sql/` fordi
  `supabase/migrations/` er låst av migrasjonsverktøyet og bare kan skrives ved å kjøre SQL-en.
  GJENSTÅR: flytte filen til `supabase/migrations/` uten å kjøre DDL-en om igjen.
- [x] Regresjon: `src/test/appliedSecuritySql.test.ts` (8 tester) pinner signatur, SECURITY DEFINER,
  entitetsfilter, `IS NOT TRUE`-guard, anon-avvisning, dato-/returregler og fravær av destruktiv SQL.
- Testdekning: kun statisk kontroll av speilet SQL i repoet + Henriks isolerte PGlite-kjøring (6/6).
  INGEN test med ekte rollebrukere mot live-prosjektet er kjørt herfra.
