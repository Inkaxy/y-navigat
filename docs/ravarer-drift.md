# Råvarer – driftsliste

Oppdatert 18.11.2026. Én samlet oversikt over databasefiler, brytere, utrullede serverfunksjoner og kjente
begrensninger. Root kjører databasefiler; ingenting her kjøres automatisk. «Kjørt» betyr meldt kjørt av root.

## A. Databasefiler (`supabase/pending/`)

Startpunkt for den som kjører filene: `supabase/pending/LES-MEG.md` (tabell, framgangsmåte i SQL Editor).
Mappene: `1-kjor-na/` (nummerert, kjøres nå; tom etter 18.11), `2-endrer-data/` (eget ja + dry-run), `3-valgfritt/`, `kjort/`,
`kontroll/` (alle `.check.sql`, bare SELECT), `delfiler/`, `utgaatt/`, `functions/` (serverkode). Filer som endrer
en eksisterende funksjon/policy stopper selv hvis live-definisjonen avviker fra den som ble lest (md5-vakt).
Innholdet i SQL-filene ble ikke endret ved ryddingen 18.11; kontrollfilene beholder gamle navn.
Etter innlimingsfeilen 18.11 (01 stoppet på «anker a» fordi innlimingen ga CR+LF) tåler filene 00–07 og
`2-endrer-data/` Windows-linjeskift: ankre renses for CR/hardt mellomrom/tabulator, et sluttsteg skriver opprettede
funksjoner på nytt uten CR, og md5-vakter/kontrollfiler regner md5 uten CR. `kjort/00_test_innliming.sql` (ren SELECT)
viser hva utklippstavlen gjør. Test: `node scripts/test-innliming-crlf.mjs` (hver fil LF mot CR+LF).

### Kjørt – `kjort/`, kjør aldri på nytt
| Fil | Hva den slo på |
|---|---|
| `20261012_varetelling_foundation`, `_stage3`, `_stage3_storage` | Varetelling (12.10). Speil i `supabase/live-mirror/`. |
| `20261020_label_approved_version_claims` | Etikett/nettside fra godkjent deklarasjonsversjon (20.10, som `preserve_approved_declarations_during_review`; speil i `supabase/live-mirror/`). |
| `20261113_lines_sum_credit_vat` | Sumkontroll med kreditnota og mva (15.11). |
| `20261113_line_extraction_release_requeue` | AI-feil teller ikke forsøk; «Les på nytt i bolk» (15.11). |
| `20261117_beslutninger_angre` | Angre «godta pris» og «ikke vare». |
| `20261119_nye_varer_les` | Rask liste for Fra faktura › Nye varer. |
| `20261121_kobling_godkjent_faktura` | Kobling lov på internt godkjente fakturaer (avstemt/flagget/kostført fortsatt låst). |
| `20261119_fra_faktura` | Prishopp-grense, egen grense per vare, leverandørvaretype, innstillinger for Fra faktura. |
| `20261119_godta_sum` | «Godta sum» med begrunnelse og angre. |
| `20261122_fakturalesing_opplaering` | Tabeller og funksjoner for opplæring av fakturaleseren. Alle brytere står av. |
| `00_test_innliming` (18.11) | Ren SELECT som viste hva utklippstavlen gjør. |
| `01_gjenlesing_fjern_linjer` (`20261123_gjenlesing_fjern_linjer`, 18.11) | Gjenlesing kan erstatte hele linjesettet når ingen beskyttet linje går tapt (`rm_cap_gjenlesing_fjern_v1`). Første innliming stoppet på anker a (CR+LF) uten endring; rettet fil gikk gjennom. |
| `02_raske_oppslag_del1` (`20261124_raske_oppslag_del1`, 18.11) | Raske tellere i menyen, Prishopp og Ikke lest (`rm_cap_raske_oppslag_v1`). |
| `03_raske_oppslag_del2_rls` (`20261124_raske_oppslag_del2_rls`, 18.11) | Fakturatilgang sjekkes én gang per spørring. Tilbakerulling i `kontroll/20261124_raske_oppslag_del2_rls.check.sql`. Ekte før/etter-tid er ikke målt. |
| `04_prislinje` (`20261117_prislinje`, 18.11) | «Rett pris» på ett kjøp og «Endre godkjent pakning» (`rm_cap_prislinje_v1`, `rm_purchase_corrections`). |
| `05_slaa_sammen_varer` (`20261120_slaa_sammen_varer`, 18.11) | «Slå sammen varer» med angre (`rm_cap_slaa_sammen_v1`, `rm_material_merges`). Delfilene i `delfiler/` skal ikke kjøres. |
| `06_varselmal_lesing_stopper` (`20261113_invoice_reading_alert_template`, 18.11) | E-postmalen for «lesingen står stille». |
| `07_lesevarsel_stillstand` (`20261125_lesevarsel_stillstand`, 18.11) | `rm_reading_stall_check`. Tidsplanen (cron) nederst i filen er ikke lagt inn; krever eget ja. |

### Venter – `1-kjor-na/`
| Fil | Hva den slår på | Merknad |
|---|---|---|
| `01_nullstill_koen` (kontroll `20261124_nullstill_koen`) | «Nullstill køen» (`rm_cap_nullstill_koen_v1`): kategori `nullstilling` for «Hold utenfor» på linje, tabellene `rm_queue_reset_runs/_snapshot/_items/_item_lines`, funksjonene `rm_queue_reset_*`. Oppdatert 18.11 (romsligere regler A/B/C): forhåndsvisningen leser lesevarsler på faktura og alle linjekoder i stedet for prissikkerhetsstatusen, og `rm_queue_reset_finish` skriver `lesegrunnlag` i revisjonsloggen. | Venter på Henriks ja. Ingen utrulling av serverfunksjoner trengs (bruker `link-supplier-item` og `match-invoice-lines` som allerede er ute). Starter ingen kjøring; grensen 1 % settes av appen etter ferdig kjøring uten feil. |


**Kontrollert av root i produksjon 18.11 etter 00–07:** `rm_cap_gjenlesing_fjern_v1`, `rm_cap_raske_oppslag_v1`,
`rm_cap_prislinje_v1` og `rm_cap_slaa_sammen_v1` finnes; tabellene `rm_material_merges` (0 rader) og
`rm_purchase_corrections` finnes; de nye lesepolicyene ligger på `invoices`/`invoice_lines`; `rm_reading_stall_check`
finnes; ingen ny cron-jobb; ingen funksjoner fra filene har CR; 793 fakturaer og 5 561 linjer uendret; ingen
tilgangsfeil eller tidsavbrudd i loggene etterpå.

### Valgfritt – `3-valgfritt/`
| Fil | Hva den slår på | Merknad |
|---|---|---|
| `20261113_ai_fallback_provider` | Reserveleverandør når hoved-AI-tjenesten er nede/avviser nøkkelen. | Fortsatt nyttig: selvkontrollen hjelper mot dårlig lesing, ikke mot at tjenesten er nede. Aktivering er egen linje. |
| `20261118_handelsvarer`, `20261118_prisgrunnlag` | Påslag per prisgruppe; emballasje i Brutto/DG2. | Uavhengige av Fra faktura. |
| `20261112_push_breadscale_floor` | Brødskala sendes som helt tall rundet ned. | Venter på ja. |
| `20261117_automatikk` | Pant som følgevare, automatisk ny lesing. **Delvis utgått:** tabellen `rm_key_material_limits` er erstattet av egen prisgrense per vare. | Bør strykes for tabelldelen før kjøring; avgjøres av Henrik/root. |

### Dataendringer – `2-endrer-data/`, venter på Henriks ja per fil (alle har dry-run)
`20261119_fra_faktura_opprydding` (funksjon med dry-run som standard), `20261119_sumkontroll_omregning` (+ `.dryrun.sql`),
`20261121_varenummer_normalisering` (`.PENDING.sql` = forhåndsvisning uten dataendring, kjøres før `.DATAENDRING.sql`),
`20261122_like_linjer` (+ `.dryrun.sql`, 41 mulige like linjegrupper).

### Utgått – `utgaatt/`, kjør aldri
`20261117_automatikk_cron.DATAENDRING` (cron trengs ikke), `20261012_negotiation_item_preservation` (erstattet, gjennomgått versjon kjørt 12.10).

### Store filer
Root/Henrik limer inn hele filen i SQL Editor (tåler 77 kB; 05 gikk gjennom 18.11, så delfilene for den skal ikke kjøres). Delfiler fra `node scripts/splitPendingSql.mjs <fil>`
ligger i `delfiler/` som reserve ved innskriving for hånd: delene legger teksten i en mellomlagring med md5-kontroll
per del, og siste del kjører hele den gjennomgåtte teksten i én transaksjon. Test: `src/test/splitPendingSql.test.ts`.

## B. Brytere – anbefalt rekkefølge

Fakturalesing (Råvarer › Innstillinger › Fakturalesing; alle av nå):
1. **Varekatalog som fasit** – mål på fasitfakturaene med «Kvalitetstest» før og etter. Behold bare hvis ikke dårligere.
2. **Leverandørprofil** – bekreft profil for ASKO, Idun, PALS, TINE først; mål på nytt.
3. **Læring av rettinger** – bare menneskelige rettinger; se gjennom eksemplene, slå av enkeltvise ved behov.
4. **Selvkontroll** (+ valg av sterkere modell) – sist, når 1–3 er målt.

Fra faktura (Innstillinger › Priskontroll):
5. **Pakning fra faktura** – når Nye varer har vært brukt en stund uten feil pakning.
6. **Prisendringer under grensen føres uten spørsmål** – sist; standardgrense og egen grense per vare settes først.

Helsesiden (Innstillinger › Fakturalesing › Helse) viser hvilke brytere som er på og hvilke databasefiler som er kjørt.

## C. Utrullede serverfunksjoner

| Dato | Funksjon | Hvem | Merknad |
|---|---|---|---|
| 12.10.2026 | `vt-count-ocr` v1, `vt-count-report-email` v1 | root | Varetelling. |
| 13.11.2026 | `invoice-model-eval` | assistent | Kvalitetstest av lesing. |
| 15.11.2026 | `match-invoice-lines` (lifecycle-vakt, v215) | root | |
| 17.11.2026 | `extract-invoice-from-pdf`, `tripletex-import-invoice-lines`, `invoice-model-eval` | assistent | ASKO-regel. **Uten avtale** – årsaken til utrullingsforbudet 18.11. |
| 17.11.2026 | `match-invoice-lines` (manuelle koblede linjer bak markør) | root | |
| 18.11.2026 | `tripletex-ehf-test` (ny, bare lesing) | assistent, Henriks ja | EHF-testen. |
| 18.11.2026 | `extract-invoice-from-pdf`, `invoice-model-eval`, `tripletex-import-invoice-lines` (ny leser) | assistent, Henriks ja | Alle nye brytere av; test viser samme tekst til AI-modellen som før. Tilbakerulling: forrige versjon i git (før kopiering fra `supabase/pending/functions/`). |
| 19.11.2026 | `tripletex-import-invoice-lines` (lesekø: én faktura prøves ikke igjen i samme kjøring, `patches/20261119_lesekoe_ett_forsok_per_kjoring.patch`) | assistent, Henriks ja | Ingen SQL. Svarer på serveren etter utrulling. Tilbakerulling: forrige versjon i git (commit før utrullingen). |

Lagring under `supabase/functions/` ruller ut automatisk. Ny serverkode legges derfor i
`supabase/pending/functions/` og flyttes først etter ja til akkurat den utrullingen.

### Venter på utrulling – `supabase/pending/functions/`

| Laget | Funksjon | Hva | Status |
|---|---|---|---|
| – | – | Ingen serverendringer venter. | |

**19.11.2026 – venter på ja (serverutrulling):** `supabase/pending/functions/_shared/ehfLines.ts` (rettet) + `patches/20261119_ehf_tekst.patch` (`tripletex-import-invoice-lines`). Funnet ved gjennomgang av 11 ekte EHF-fakturaer (119 linjer): XML-tolkeren kuttet ledende nuller i varenummer/fakturanummer, enhetspris ble rundet til 2 desimaler (48,015 → 48,02), ASKO-koden NMP og Drammen Papirs XBE/XCA var ukjente, og trykte tillegg ble oversett. Etter rettingen lander varenummer, mengde, enhetspris og sum riktig på alle 119; 19 Drammen-linjer med tillegg får lesevarsel. Utrulling: kopier `ehfLines.ts` til `supabase/functions/_shared/` og bruk patchen. Bryteren `ehf_first` er fortsatt AV.

**19.11.2026:** `02_ehf_forst.sql` kjørt (bryter `ehf_first`, AV) og `tripletex-import-invoice-lines` rullet ut med EHF først etter Henriks ja. Bryteren slås på separat i appen. `02_ehf_bryter.sql` kjørt 19.11 etter Henriks ja (kontroll ok, bryteren AV); den gir bryteren under Innstillinger › Fakturalesing. `02_ehf_forst.sql` ligger i `kjort/`.

## D. Kjente begrensninger

- Oversikt og Varer-fanene bruker fortsatt den tunge oppsummeringen (`rm_work_summary`, opptil 6–8 s). Menyen,
  Prishopp og Ikke lest skal være raske etter fil nr. 02–03 (kjørt 18.11). Målet «under 1 s på alle sider» er ikke nådd for disse to.
- Tidene for de nye lesefunksjonene er målt lokalt og med tilgangskontroll omgått mot live; ekte før/etter-tid etter
  kjøringen 18.11 er ikke målt ennå.
- md5-verdiene for nye funksjonskropper i check-filene er regnet lokalt; root bør sammenligne med live etter kjøring.
- Gjentatte oppslag mot databaseobjekter som ikke finnes, huskes i én time per fane; årsaken til hundrevis av
  404/400 i døgnet i produksjon er ikke bevist (loggene var ikke tilgjengelige), og nbhub.no får endringen først ved publisering.
- Varetellingstesten «kalender viser tellingen» feiler fordi den forventer oktober 2026 i kalenderen (datoavhengig test).

## E. Røyktest og sjekkliste per utgivelse

Uten innlogging (forhåndsvisning eller lokalt): `python3 scripts/smoke-preview.py [adresse]`. Sjekker testdatasidene
og at Råvarer krever innlogging.

Innlogget – klikk gjennom (Henrik):
1. Råvarer › Oversikt åpner; tallene vises (ikke «0» der det skal være ukjent).
2. Menyen: Fra faktura-merket stemmer med antallet i fanene.
3. Fra faktura › Nye varer: koble én vare → grønn kvittering, raden forsvinner, telleren går ned, «Angre» virker.
4. Nye varer: rad på avstemt faktura er merket og står utenfor «Opprett N sikre».
5. Prishopp: én rad åpnes, «Godta» gir kvittering; «Mindre prisendringer under grensen» kan foldes ut.
6. Ikke lest: «Sjekk tallene» viser linjer med lesekontroll; ett svar kan angres.
7. Ikke lest › «Forslag venter på deg»: «Bruk alle» bruker bare forslag der summen stemmer.
8. Varer: merker («Ny fra faktura», videresalg, emballasje) vises på PC og mobil.
9. Vare › Pris: egen prisgrense kan settes og vises i Prishopp.
10. Fakturaer: én faktura åpnes med PDF og linjer; Godkjenning-fanen virker som før.
11. Leverandører: én leverandør og én leverandørvare (detaljsiden) åpnes.
12. Lager: alle seks faner åpnes.
13. Innstillinger › Fakturalesing › Helse: siste lesing, kø og brytere vises; ingen bryter er på uten at det er bestemt.
14. Innstillinger › Fakturalesing › EHF-test: kortet vises for godkjenner/admin.
15. Gamle lenker (`/ravarer/beslutninger`) sender til Fra faktura.
