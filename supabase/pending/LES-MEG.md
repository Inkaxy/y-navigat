# Databasefiler – les meg først

Oppdatert 18.11.2026. **Én fil venter på Henriks ja:** `1-kjor-na/01_nullstill_koen.sql` («Nullstill køen», se under).
Henrik kjørte 00–07 i SQL Editor 18.11, alle med «Success», og root har kontrollert dem i produksjon. De er flyttet uendret til `kjort/`.
Det som gjenstår, ligger i `2-endrer-data/` (eget ja per fil) og `3-valgfritt/`. Ingen fil kjøres automatisk.

**Slik kjører du én fil (når en fil har fått ja)**
1. Åpne filen og kopier hele filen (også `begin;` øverst og `commit;`/`rollback;` nederst). Bruk «kopier fil»-knappen
   eller rå visning (f.eks. «Raw» på GitHub) hvis den finnes, framfor å merke tekst i kodevisningen.
2. Lim inn i Supabase › SQL Editor (nytt, tomt vindu) og trykk **Run**. Én fil om gangen; dry-run først der den finnes.
3. Feiler noe: stopp, ikke kjør neste fil, og send hele feilmeldingen. Filen ruller da tilbake av seg selv.

## Venter på ja – `1-kjor-na/`

| Nr | Fil | Hva den slår på | Endrer data ved kjøring? | Hva Henrik ser i appen etterpå |
|---|---|---|---|---|
| 01 | `01_nullstill_koen.sql` | «Nullstill køen»: egen kategori «Avsluttet ved nullstilling» for «Hold utenfor» (bare én linje), fire tabeller for kjøringen og funksjonene som styrer den (start, bolker, pause/stopp, kontroll av uavklarte steg, avslutning, angre-merking, status). | Nei. Ingen kjøring startes, ingen linjer, kostpriser eller innstillinger endres. Grensen 1 % settes først når en kjøring Henrik starter er ferdig uten feil. | «Nullstill køen …» øverst i Råvarer › Fra faktura (godkjenner/admin): forhåndsvisning, eksport, start, fremdrift, kvittering, angre. Helsesiden viser grensen og siste nullstilling. |

Kontroll før og etter: `kontroll/20261124_nullstill_koen.check.sql` (alle rader `ok = true`). Tåler Windows-linjeskift.

## Kjørt 18.11 – nå i `kjort/`, kjør aldri på nytt

| Nr | Fil (`kjort/`) | Hva den slo på | Endret data ved kjøring? | Hva Henrik ser i appen nå |
|---|---|---|---|---|
| 00 | `00_test_innliming.sql` | Ingenting – test av innlimingen. | Nei (ren SELECT) | Ingenting. |
| 01 | `01_gjenlesing_fjern_linjer.sql` | Gjenlesing kan bytte ut hele linjesettet og fjerne gamle restlinjer, bare når ingen manuelt behandlet linje går tapt. | Nei | Når et nytt forslag brukes under Fra faktura › Ikke lest, forsvinner linjer som ikke finnes i den nye lesingen. |
| 02 | `02_raske_oppslag_del1.sql` | Raske oppslag for menyens tall, Prishopp og Ikke lest. | Nei | Menyen, Prishopp og Ikke lest laster raskere. Tallene er de samme. |
| 03 | `03_raske_oppslag_del2_rls.sql` | Tilgang til fakturaer sjekkes én gang per oppslag i stedet for per linje. | Nei (bare leseregelen; angrefil i `kontroll/`) | Fakturaer og fakturalinjer laster raskere. Hvem som ser hva er uendret. |
| 04 | `04_prislinje.sql` | «Rett pris» på ett kjøp og «Endre godkjent pakning», med logg og angre. | Nei | Knappene er aktive på varens Pris-fane (godkjenner/admin). |
| 05 | `05_slaa_sammen_varer.sql` | «Slå sammen varer» med forhåndsvisning og angre. | Nei (data endres først når noen trykker «Slå sammen») | «Slå sammen …» og «Mulige duplikater» under Råvarer › Varer er aktive (godkjenner/admin). |
| 06 | `06_varselmal_lesing_stopper.sql` | E-postmalen «Fakturalesingen står stille». | Nei (én ny e-postmal) | Ingen synlig endring. |
| 07 | `07_lesevarsel_stillstand.sql` | Serverkontroll for stillstand og høy feilrate. | Nei | Ingen synlig endring. E-post ved stillstand kommer først når tidsplanen nederst i filen legges inn etter eget ja (ingen ny tidsplan er lagt inn). |

**Root kontrollerte i produksjon 18.11:** `rm_cap_gjenlesing_fjern_v1`, `rm_cap_raske_oppslag_v1`, `rm_cap_prislinje_v1` og
`rm_cap_slaa_sammen_v1` finnes; tabellene `rm_material_merges` (0 rader) og `rm_purchase_corrections` finnes; de nye
lesepolicyene ligger på `invoices`/`invoice_lines`; `rm_reading_stall_check` finnes; ingen ny tidsplan (cron); ingen av
funksjonene har Windows-linjeskift (CR); 793 fakturaer og 5 561 linjer uendret; ingen tilgangsfeil eller tidsavbrudd etterpå.

## Gjenstår – kjør ikke uten eget ja

| Mappe | Innhold |
|---|---|
| `2-endrer-data/` | Endrer eksisterende data. **Venter på Henriks ja per fil**, og kjøres først som dry-run. `like_linjer` og `sumkontroll_omregning` har egen `.dryrun.sql`. `varenummer_normalisering.PENDING.sql` er forhåndsvisningen (endrer ingen data) og kjøres før sin `.DATAENDRING.sql`. `fra_faktura_opprydding` lager en funksjon som er dry-run som standard. DATAENDRING-filene slutter med ROLLBACK til tallene er kontrollert. |
| `3-valgfritt/` | Ikke del av Fra faktura: `handelsvarer` og `prisgrunnlag` (påslag og emballasje i Brutto/DG2), `ai_fallback_provider` (reserve-AI når hovedtjenesten er nede), `push_breadscale_floor` (brødskala som helt tall rundet ned til nettsiden). `automatikk`: pant som følgevare og automatisk ny lesing trengs fortsatt, men tabellen for nøkkelråvaregrenser (`rm_key_material_limits`) er erstattet av egen prisgrense per vare og bør strykes før kjøring. Fire av filene (`automatikk`, `handelsvarer`, `push_breadscale_floor`, `ai_fallback_provider`) har ikke sluttsteget mot Windows-linjeskift. |

## Andre mapper

| Mappe | Innhold |
|---|---|
| `1-kjor-na/` | `01_nullstill_koen.sql` – venter på Henriks ja. |
| `kjort/` | Kjørt i produksjon – kjør aldri på nytt. Beholdt fordi tester og historikk leser dem. |
| `kontroll/` | Alle `.check.sql` (bare lesing). «Nullstill køen» = `20261124_nullstill_koen`. For de kjørte 01–07 heter de: 01 = `20261123_gjenlesing_fjern_linjer`, 02 = `20261124_raske_oppslag_del1`, 03 = `20261124_raske_oppslag_del2_rls`, 04 = `20261117_prislinje`, 05 = `20261120_slaa_sammen_varer`, 06 = `20261113_invoice_reading_alert_template`, 07 = `20261125_lesevarsel_stillstand`. |
| `delfiler/` | «Slå sammen varer» delt i åtte deler. **Kjør ikke** – hele filen (05) er kjørt. Beholdt fordi testene leser dem. |
| `utgaatt/` | Erstattet eller unødvendig – kjør aldri. |
| `functions/` | Serverkode som venter på utrulling (ikke SQL). |

## Innliming (feilen 18.11)

01 stoppet først med «anker a finnes ikke nøyaktig én gang» fordi innlimingen ga Windows-linjeskift. Ingenting ble endret.
Etter rettelsen gikk 00–07 gjennom. Filene i `2-endrer-data/` har samme rettelse:
- Tekstbytter: CR fjernes og harde mellomrom/tabulator blir mellomrom i ankeret og erstatningen før de sammenlignes
  med den uendrede live-teksten. Kravet «nøyaktig én gang» står.
- Funksjoner som filen oppretter: et sluttsteg skriver dem på nytt uten CR, så databasen alltid ender med vanlige linjeskift.
- md5-vakter og alle kontrollfiler i `kontroll/` regner md5 på tekst uten CR.
- Testet lokalt: hver fil gir samme resultat med LF og CR+LF (`node scripts/test-innliming-crlf.mjs`).

Full status, brytere og utrullinger: `docs/ravarer-drift.md`.
