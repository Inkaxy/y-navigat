# Deklarasjoner og næringsinnhold ut til et annet prosjekt

Målet er at en annen løsning (utenfor NBhub) kan hente ingrediensdeklarasjon, allergener og næringsinnhold for varene dine — men bare for varer som står som **Merking: Godkjent**, og bare med en hemmelig nøkkel du selv utsteder.

## Slik blir det å bruke

1. Du åpner nøkkelsiden i NBhub og lager en ny nøkkel, for eksempel «Nettside – deklarasjoner».
2. Nøkkelen vises én gang. Den limes inn i det andre prosjektet.
3. Det andre prosjektet henter en adresse og får tilbake en liste med varer: navn, varenummer, strekkode, ingrediensliste med uthevede allergener, «kan inneholde spor av», næringsinnhold per 100 g, nettovekt, holdbarhet, oppbevaring, produsent og når deklarasjonen sist ble godkjent.
4. Varer som ikke er godkjent (utdatert eller mangler pliktfelt) blir **ikke** med i svaret. Det gjør at feilaktig merking aldri kan komme ut på en pakke eller en nettside.
5. Blir en nøkkel misbrukt eller skal den byttes, trekker du den tilbake på samme side, og henting stopper umiddelbart.

Det andre prosjektet trenger ingen innlogging og ingen tilgang til resten av databasen — bare denne ene adressen og nøkkelen.

## Må vi gjøre noe i dette prosjektet?

Ja, tre ting — alt skjer her i NBhub, og ingenting av eksisterende funksjonalitet endres:

- En ny hentetjeneste som svarer med deklarasjonsdata, med nøkkelsjekk og godkjent-filter.
- Nøkkelsiden utvides slik at en nøkkel kan merkes for «deklarasjoner» i tillegg til pakkesystemet (rettighetsfeltet finnes allerede, det er ikke i bruk for dette ennå).
- En kort bruksanvisning i appen med adressen, et eksempel på svaret og hvordan nøkkelen brukes, slik at du kan gi den videre til det andre prosjektet.

## Teknisk gjennomføring

**Ny edge-funksjon `declarations-export`** (mønster hentet fra `pakkesystem-export`):

- `GET /declarations-export?updated_since=<ISO>&product_ids=…&page=…` — sidedelt liste.
- `GET /declarations-export?schema=1` — JSON Schema for svaret, slik at mottaker kan validere.
- Auth: `Authorization: Bearer nbps_…`. Nøkkelen SHA-256-hashes og slås opp mot `pakkesystem_api_keys.key_hash`; avvist når `revoked_at` er satt eller `scopes` ikke inneholder `declarations`. `last_used_at` oppdateres, og kall logges i `pakkesystem_api_log` som i dag. Ingen anonym tilgang, ingen JWT-vei nødvendig.
- Selskap hentes fra nøkkelraden (`legal_entity_id`) — aldri fra forespørselen.

**Datakilde og godkjent-filter** (samme regel som «Merking»-kolonnen i varelisten, jf. `productLabelingStatus` / `deriveLabelingStatusFromDb`):

- Grunnlag: `products` (`manual_ingredient_declaration`, `manual_allergens_contains`, `manual_allergens_may_contain`, `manual_nutrition_per_100g`, `manual_declaration_updated_at`, `declaration_needs_review`), koblingen i `product_recipe_links` og beregningsraden i `recipe_label_calculated` (`computed_at`, `is_stale`).
- Tas med bare når: deklarasjonstekst finnes, `declaration_needs_review` er usann, og — når en beregningsrad finnes — `is_stale` er usann.
- Etikettfelt (nettovekt, holdbarhet, oppbevaring, opprinnelse) leses fra oppskriften; produsentnavn/-adresse fra `legal_entities` (`legal_name`, `invoice_*`), som i etikettforhåndsvisningen.
- Allergenmarkering beholdes som `*stjerner*` (samme format som etiketten) og leveres i tillegg som rene lister, slik at mottaker selv velger visning.
- Svaret får `schema_version` og `generated_at`; hver vare får `approved_at` og `content_hash` slik at mottaker kan cache og oppdage endringer.

**Frontend (`src/ordre/pages/Pakkesystem.tsx`)**: nøkkeldialogen får avkryssing for rettighetene `pakkesystem` og `declarations`; lista viser hvilke rettigheter hver nøkkel har. `pakkesystem-create-key` utvides til å ta imot valgte rettigheter (standard som i dag, så eksisterende nøkler er uendret).

**Tester**: enhetstester for godkjent-filteret (godkjent / utdatert / mangler / uten kobling) og for nøkkelsjekken (ukjent, tilbakekalt, feil rettighet, gyldig).

Ingen databaseendringer, ingen endring i eksisterende RPC-er eller i pakkesystemets svar, og ingen publisering.
