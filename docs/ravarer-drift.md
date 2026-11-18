# Råvarer – driftsliste

Oppdatert 18.11.2026. Én samlet oversikt over databasefiler, brytere, utrullede serverfunksjoner og kjente
begrensninger. Root kjører databasefiler; ingenting her kjøres automatisk. «Kjørt» betyr meldt kjørt av root.

## A. Databasefiler (`supabase/pending/`)

Startpunkt for den som kjører filene: `supabase/pending/LES-MEG.md` (tabell, framgangsmåte i SQL Editor).
Mappene: `1-kjor-na/` (nummerert, kjøres nå), `2-endrer-data/` (eget ja + dry-run), `3-valgfritt/`, `kjort/`,
`kontroll/` (alle `.check.sql`, bare SELECT), `delfiler/`, `utgaatt/`, `functions/` (serverkode). Filer som endrer
en eksisterende funksjon/policy stopper selv hvis live-definisjonen avviker fra den som ble lest (md5-vakt).
Innholdet i SQL-filene ble ikke endret ved ryddingen 18.11; kontrollfilene beholder gamle navn.

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

### Venter – `1-kjor-na/`, i nummerrekkefølge
| Nr | Fil (opprinnelig navn) | Hva den slår på | Merknad |
|---|---|---|---|
| 01 | `01_gjenlesing_fjern_linjer` (`20261123_gjenlesing_fjern_linjer`) | Gjenlesing kan erstatte hele linjesettet når ingen beskyttet linje går tapt (`rm_cap_gjenlesing_fjern_v1`). | md5-vakt mot `rm_apply_invoice_reread` (`c9c68ddd…`); stemte mot live 18.11. |
| 02 | `02_raske_oppslag_del1` (`20261124_raske_oppslag_del1`) | Raske tellere i menyen, Prishopp og Ikke lest (`rm_cap_raske_oppslag_v1`). | Bare nye lesefunksjoner. Appen bytter selv når filen er kjørt. |
| 03 | `03_raske_oppslag_del2_rls` (`20261124_raske_oppslag_del2_rls`) | Fakturatilgang sjekkes én gang per spørring i stedet for per linje. | Endrer bare lesepolicyene på `invoices`/`invoice_lines`; vakt stemte mot live 18.11; tilbakerulling i `kontroll/20261124_raske_oppslag_del2_rls.check.sql`. Mål tiden før/etter. |
| 04 | `04_prislinje` (`20261117_prislinje`) | «Rett pris» på ett kjøp og «Endre godkjent pakning» (`rm_cap_prislinje_v1`). | Uavhengig av resten. |
| 05 | `05_slaa_sammen_varer` (`20261120_slaa_sammen_varer`, hele filen) | «Slå sammen varer» med angre (`rm_cap_slaa_sammen_v1`). Ny tabell `rm_material_merges`. | md5-vakt mot `merge_raw_materials` (`3c2ed3cc…`) stemte mot live 18.11. Delfilene i `delfiler/` trengs ikke når hele filen limes inn. |
| 06 | `06_varselmal_lesing_stopper` (`20261113_invoice_reading_alert_template`) | E-postmalen for «lesingen står stille». | Flyttet hit fra valgfritt: nr. 07 trenger malen, og den utrullede leseren bruker den også. |
| 07 | `07_lesevarsel_stillstand` (`20261125_lesevarsel_stillstand`) | Servertjek: e-post ved stillstand ≥ 24 t med kø, eller feilrate ≥ 30 % (min. 5 lesinger) siste døgn. | Kjøres etter 06. Tidsplanen (cron) står kommentert nederst og legges inn bare etter ja. |

### Valgfritt – `3-valgfritt/`
| Fil | Hva den slår på | Merknad |
|---|---|---|
| `20261113_ai_fallback_provider` | Reserveleverandør når hoved-AI-tjenesten er nede/avviser nøkkelen. | Fortsatt nyttig: selvkontrollen hjelper mot dårlig lesing, ikke mot at tjenesten er nede. Aktivering er egen linje. |
| `20261118_handelsvarer`, `20261118_prisgrunnlag` | Påslag per prisgruppe; emballasje i Brutto/DG2. | Uavhengige av Fra faktura. |
| `20261112_push_breadscale_floor` | Brødskala sendes som helt tall rundet ned. | Venter på ja. |
| `20261117_automatikk` | Pant som følgevare, automatisk ny lesing. **Delvis utgått:** tabellen `rm_key_material_limits` er erstattet av egen prisgrense per vare. | Bør strykes for tabelldelen før kjøring; avgjøres av Henrik/root. |

### Dataendringer – `2-endrer-data/`, tas separat med Henrik (alle har dry-run)
`20261119_fra_faktura_opprydding` (funksjon med dry-run som standard), `20261119_sumkontroll_omregning` (+ `.dryrun.sql`),
`20261121_varenummer_normalisering` (`.PENDING.sql` = forhåndsvisning uten dataendring, kjøres før `.DATAENDRING.sql`),
`20261122_like_linjer` (+ `.dryrun.sql`, 41 mulige like linjegrupper).

### Utgått – `utgaatt/`, kjør aldri
`20261117_automatikk_cron.DATAENDRING` (cron trengs ikke), `20261012_negotiation_item_preservation` (erstattet, gjennomgått versjon kjørt 12.10).

### Store filer
Root/Henrik limer inn hele filen i SQL Editor (tåler 77 kB). Delfiler fra `node scripts/splitPendingSql.mjs <fil>`
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

Lagring under `supabase/functions/` ruller ut automatisk. Ny serverkode legges derfor i
`supabase/pending/functions/` og flyttes først etter ja til akkurat den utrullingen.

## D. Kjente begrensninger

- Oversikt og Varer-fanene bruker fortsatt den tunge oppsummeringen (`rm_work_summary`, opptil 6–8 s). Menyen,
  Prishopp og Ikke lest blir raske etter fil nr. 02–03. Målet «under 1 s på alle sider» er ikke nådd for disse to.
- Tidene for de nye lesefunksjonene er målt lokalt og med tilgangskontroll omgått mot live; ekte før/etter-tid må
  måles etter kjøring.
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
