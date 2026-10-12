# Varetellingssystem – spesifikasjon og fremdrift

Baseline: `e29ad95e8e372578ffa8f205c2560633f0e8ef9b`. Godkjent spesifikasjon er gjengitt i sin helhet nederst.

## Fremdrift (sannferdig sjekkliste)

Forklaring: **[x]** bygget og testet i kode · **[~]** delvis · **[ ]** ikke bygget. Ingenting er i drift før SQL-en er godkjent og kjørt.

### Databasegrunnlag – foreslått, IKKE kjørt mot live
- [x] `supabase/pending/20261012_varetelling_foundation.PENDING.sql` (additivt, kun `vt_*`)
- [x] Atferdstest `supabase/pending/20261012_varetelling_foundation.test.sql`, kjøres med `node scripts/test-varetelling-sql.mjs` (innebygd PGlite, 45 kontroller)
- [x] RLS per firma via `has_ravarer_access` (read/write/approve); PUBLIC/anon tilbakekalt; ingen klientskriving i tellinger/linjer
- [x] Startgrunnlag (navn, varenummer, sted, enheter, pris, priskilde, tidspunkt) låst av trigger
- [x] Avsluttet/avbrutt telling uforanderlig; tellinger/linjer kan ikke slettes
- [ ] Kjørt mot live (krever uavhengig gjennomgang og eksplisitt autorisasjon)

### Fase 1 – grunnlag og arbeidsflate
- [x] Arbeidsflate under Lager › Varetelling (`?vt=tellinger|maler|uten-liste|dagstelling`, `?telling=<id>`)
- [x] Eksisterende dagstelling bevart uendret som «Dagstelling»
- [x] «Ikke tatt i bruk»-melding når databasedelen mangler; ingen falsk lagring
- [x] Avdelinger og fysiske steder (opprett/arkiver, unik per firma)
- [x] Listemaler: opprett, arkiver, legg til/fjern varer med plassering, versjon øker ved endring
- [x] Duplikatvarsel (samme sted = feil, annet sted = lovlig info), serverhåndhevet unikhet i mal og telling
- [x] Varer uten liste (aktive lagerførte), manglende enhet/pris markert
- [x] Planlagt telling (navn, telledato) idempotent på op-id
- [x] Dekningskontroll før start (duplikater, manglende pris, manglende plassering)
- [x] Start: atomisk kopi av valgte maler og frosset grunnlag; idempotent; duplikat stopper start
- [x] Pris = bare `cost_basis_status='verifisert'` (samme kontrakt som `rm_usable_cost`); ellers «mangler»
- [x] Tilbakedatert telledato: ingen pris, kilde «historisk_ikke_tilgjengelig» (ingen oppdiktet historikk)
- [~] Verdsettelsesdato lagres separat, men settes lik telledato i UI (eget valg ikke bygget)
- [x] Telefon/iPad-registrering: store felt, desimalkomma, flere telleenheter, eksplisitt 0, «Ikke på stedet», «Må kontrolleres», kommentar, «Neste vare», gjenstår-filter
- [x] Forventet beholdning vises ikke under registrering
- [x] Linjelagring med CAS (revisjon) og op-id; konflikt viser begge verdier, ingen stille overskriving
- [x] Ukjent utfall: samme registrering sendes på nytt med samme op-id
- [x] Sammendrag: registrert, må kontrolleres, 0/ikke på stedet, foreløpig verdi av talt omfang, ufullstendig ved manglende pris
- [x] Samme vare på flere steder summeres én gang
- [x] Listestatus (til kontroll / godkjent / gjenåpne), godkjenning krever approve
- [x] Telling: til kontroll ↔ pågår, avslutt (approve; stoppes av ikke talt / må kontrolleres / manglende pris), avbryt med begrunnelse
- [x] Arkiv med søk; åpning viser frosset grunnlag
- [x] Syntetisk forhåndsvisning `/forhandsvisning/varetelling` (`?utilgjengelig=1`) med faktiske komponenter

### Gjenstår (neste leveranser)
- [ ] Tilordning av tellere/ansvarlige per liste og filteret «Mine lister»
- [ ] Manuell sortering (dra) og kopiering av listemal; kategori-utvalg ved opprettelse
- [ ] Flytt vare mellom maler direkte fra duplikatvarselet
- [ ] Kalender og gjentakende planlegging, påminnelser
- [ ] Offline-kø (holdbar lagring, gjenoppretting) – IKKE bygget, ikke lovet
- [ ] Papirlister A4, QR per telleliste, utskriftsversjoner
- [ ] Rapport (PDF/regneark), sammenligning mellom tellinger
- [ ] E-post-forhåndsvisning og sending – IKKE bygget
- [ ] Dokumentlesing/OCR av utfylte skjemaer – IKKE bygget
- [ ] Bevegelseskontroll i tellevindu og «Oppdater lagerbeholdning» – IKKE bygget (ingen automatisk lagerjustering)
- [ ] Revisjon av avsluttet telling
- [ ] Manuell prisavklaring med begrunnelse
- [ ] Kontroll i ekte nettleser 390/768/1440 og utskrift (root)

---

## Godkjent spesifikasjon (12. oktober 2026)
