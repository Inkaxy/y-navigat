# Databasefiler – les meg først

Oppdatert 18.11.2026. Bare mappen **`1-kjor-na/`** inneholder filer som skal kjøres nå, i nummerrekkefølge.
Ingen fil kjøres automatisk. Innholdet i SQL-filene er uendret ved ryddingen (bare flyttet/omdøpt).

**Slik kjører du én fil**
1. Åpne filen i `1-kjor-na/`, merk alt og kopier (hele filen – også `begin;` øverst og `commit;` nederst).
2. Lim inn i Supabase › SQL Editor (nytt, tomt vindu) og trykk **Run**. Ta én fil om gangen, i nummerrekkefølge.
3. Feiler noe: stopp, ikke kjør neste fil, og send hele feilmeldingen. Filen ruller da tilbake av seg selv.

| Nr | Fil (`1-kjor-na/`) | Hva den slår på | Endrer data ved kjøring? | Hva Henrik ser i appen etterpå |
|---|---|---|---|---|
| 01 | `01_gjenlesing_fjern_linjer.sql` | Gjenlesing kan bytte ut hele linjesettet og fjerne gamle restlinjer (f.eks. pantlinjer for mye), bare når ingen manuelt behandlet linje går tapt. | Nei | Når et nytt forslag brukes under Fra faktura › Ikke lest, forsvinner linjer som ikke finnes i den nye lesingen. Linjesummen kan ikke lenger øke på grunn av rester. |
| 02 | `02_raske_oppslag_del1.sql` | Raske oppslag for menyens tall, Prishopp og Ikke lest. | Nei | Menyen, Prishopp og Ikke lest laster merkbart raskere. Tallene er de samme. |
| 03 | `03_raske_oppslag_del2_rls.sql` | Tilgang til fakturaer sjekkes én gang per oppslag i stedet for per linje. | Nei (endrer bare leseregelen; angrefil i `kontroll/`) | Fakturaer og fakturalinjer laster raskere. Hvem som ser hva er uendret. |
| 04 | `04_prislinje.sql` | «Rett pris» på ett kjøp og «Endre godkjent pakning», med logg og angre; egen avviksgrense for prishistorikk. | Nei | Knappene «Rett pris» og «Endre godkjent pakning» blir aktive på varens Pris-fane (godkjenner/admin). |
| 05 | `05_slaa_sammen_varer.sql` | «Slå sammen varer» med forhåndsvisning og angre. Hele originalfilen (77 kB). | Nei (data endres først når noen trykker «Slå sammen») | Knappene «Slå sammen …» og «Mulige duplikater» under Råvarer › Varer blir aktive (godkjenner/admin). |
| 06 | `06_varselmal_lesing_stopper.sql` | E-postmalen «Fakturalesingen står stille». | Nei (legger bare til én ny e-postmal) | Ingen synlig endring. Henrik får e-post hvis lesingen feiler mot AI-tjenesten to ganger på rad, høyst én per døgn. |
| 07 | `07_lesevarsel_stillstand.sql` | Serverkontroll for stillstand (≥ 24 t med kø) og høy feilrate. | Nei | Ingen synlig endring ennå. E-post ved stillstand kommer først når tidsplanen nederst i filen (kommentert ut) legges inn etter eget ja. |

**Rekkefølge:** 06 og 07 må kjøres i denne rekkefølgen (07 trenger malen fra 06). 02 bør kjøres før 03.
De andre er uavhengige av hverandre, men ta dem i nummerrekkefølge. Alle vaktene i 01, 03 og 05 ble
sjekket mot produksjon 18.11 kl. 11.40 og stemte.

**Kontroll etterpå (valgfritt, bare lesing):** i `kontroll/` ligger én `.check.sql` per fil, med det gamle navnet:
01 = `20261123_gjenlesing_fjern_linjer`, 02 = `20261124_raske_oppslag_del1`, 03 = `20261124_raske_oppslag_del2_rls`,
04 = `20261117_prislinje`, 05 = `20261120_slaa_sammen_varer`, 06 = `20261113_invoice_reading_alert_template`,
07 = `20261125_lesevarsel_stillstand`.

## Andre mapper – kjør ikke uten eget ja

| Mappe | Innhold |
|---|---|
| `2-endrer-data/` | Endrer eksisterende data. Hver krever eget ja og kjøres først som dry-run. `like_linjer` og `sumkontroll_omregning` har egen `.dryrun.sql`. `varenummer_normalisering.PENDING.sql` er forhåndsvisningen (endrer ingen data) og kjøres før sin `.DATAENDRING.sql`. `fra_faktura_opprydding` lager en funksjon som er dry-run som standard. DATAENDRING-filene slutter med ROLLBACK til tallene er kontrollert. |
| `3-valgfritt/` | Ikke del av Fra faktura: `handelsvarer` og `prisgrunnlag` (påslag og emballasje i Brutto/DG2), `ai_fallback_provider` (reserve-AI når hovedtjenesten er nede), `push_breadscale_floor` (brødskala som helt tall rundet ned til nettsiden). `automatikk`: pant som følgevare og automatisk ny lesing trengs fortsatt, men tabellen for nøkkelråvaregrenser (`rm_key_material_limits`) er erstattet av egen prisgrense per vare og bør strykes før kjøring. |
| `kjort/` | Kjørt i produksjon – kjør aldri på nytt. Beholdt fordi tester og historikk leser dem. |
| `kontroll/` | Alle `.check.sql` (bare lesing). |
| `delfiler/` | «Slå sammen varer» delt i sju deler. Trengs ikke når hele filen limes inn (nr. 05). |
| `utgaatt/` | Erstattet eller unødvendig – kjør aldri. |
| `functions/` | Serverkode som venter på utrulling (ikke SQL). |

Full status, brytere og utrullinger: `docs/ravarer-drift.md`.
