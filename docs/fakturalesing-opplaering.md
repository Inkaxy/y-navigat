# Opplæring av fakturaleseren – leveranse 18.11.2026

Alt er AV til Henrik slår det på. Ingen SQL er kjørt, ingen edge-funksjon er rullet ut, ingenting er publisert.

## Hva som er bygget
| Del | Hvor | Status |
|---|---|---|
| 1 Varekatalog som fasit | `rm_supplier_reading_catalog` + `readingCatalog.ts` (utvalg etter fakturatekst, etterkontroll av varenummer) | Venter på SQL + utrulling, bryter av |
| 2 Leverandørprofil | `invoice_supplier_profiles`, utkast fra 3–5 fakturaer, side under Råvarer › Innstillinger › Fakturalesing | Venter på SQL; siden virker når SQL er kjørt |
| 3 Læring av rettinger | `rm_record_extraction_example` (krever innlogget person) kalt etter bekreftet kobling/«ikke vare» i Fra faktura; liste med av/på | Venter på SQL; lagrer bare når «Læring» er på |
| 4 Selvkontroll | `readingContext.runWithSelfCheck`: feil tilbake + ett nytt forsøk, deretter sterkere modell, beste etter sumkontroll; `invoice_reading_log` | Venter på SQL + utrulling, bryter av |
| 5 Fasit og måling | `invoice_gold_invoices` (linjer fryses), merking på innstillingssiden; `invoice-model-eval` får `setup: gjeldende/kandidat` og treff per felt | Merking venter på SQL; måling venter på utrulling |
| 6 Like linjer | `supabase/pending/2-endrer-data/20261122_like_linjer.dryrun.sql` + `.DATAENDRING.sql` (ROLLBACK som standard) | Ikke kjørt |

Rettede fakturalinjer (`rm_correct_invoice_line` med læring) ble eksempler fra før og gjør det fortsatt.

## Like linjer (C6)
41 grupper / 64 linjer for mye / 30 åpne fakturaer. 35 grupper er ekte (samme lesing, summen stemmer med dem:
pant per vare hos Coca-Cola, samme vare på flere leveranser hos PALS, Flemming Egg, Idun og Drammen Papir).
Seks Coca-Cola-fakturaer har rester fra samlet gjenlesing 17.11 (`invoice_line.reread_added`): 11 pantlinjer
gjør linjesummen nøyaktig så mye for høy (96 kr på fem, 240 kr på 9204947561). DATAENDRING-filen fjerner bare
disse 11, med vakter (samme beløp/updated_at, eldre lik linje finnes, ingen kostføring/varemottak/lager/avvikssak,
summen stemmer etterpå), sikkerhetskopi og revisjonslogg. Prisobservasjonen markeres «linje_slettet» av dagens trigger.

## EHF (D) – undersøkt, ikke bygget
- Alle 793 fakturaer har `lines_source = pdf_extracted`; `ehf_payload` er tom.
- Tripletex API 2.0 (OpenAPI https://tripletex.no/v2/openapi.json):
  - `SupplierInvoice.orderLines` er strukturerte linjer (tekst, antall, pris, rabatt, mva, produkt), men produktet
    er Tripletex' eget, ikke nødvendigvis leverandørens varenummer. Om linjene er fylt for EHF-fakturaer er ikke verifisert.
  - `Voucher.ediDocument` peker til maskinlesbart originaldokument (EHF/EFO/NELFO); `GET /document/{id}/content`
    (beta) kan gi selve XML-en. `supplierInvoice/{id}/pdf` gir bare PDF. Ingen offentlig `/incomingInvoice`.
  - Tilgang: samme consumer + employee token som i dag; selskapet må ha «Motta EHF» aktivert. Om dokument-
    endepunktene krever ekstra rettighet er ukjent.
- Peppol-katalogen (https://directory.peppol.eu): 12 av 13 leverandører er registrert for faktura/kreditnota
  (PALS, Lantmännen Cerealia, TINE, Norgesmøllene, Idun, ASKO, Drammen Papir, Stangeland Mølle, Flemming Egg,
  Baker Nilsen, Condifa, Bama); Coca-Cola har oppføring uten fakturatyper. Registrering viser at de KAN motta,
  ikke at de sender EHF til oss. Nøtterø Bakeri er registrert som mottaker (2022-09-06).
- EHF-linjer ville gitt leverandørens varenummer (`SellersItemIdentification`), antall med enhetskode, pris med
  `BaseQuantity`, rabatt/tillegg som `AllowanceCharge`, mva-kategori og linjesum – uten lesing. `import-ehf-invoice`
  kan allerede tolke UBL 2.1/Peppol BIS 3.0.
- **Anbefaling:** prøv én kjent faktura per leverandør: `supplierInvoice → voucher → ediDocument → /document/{id}/content`,
  og sammenlign med `orderLines`. Finnes XML: bruk EHF-linjer først og AI-lesing bare som reserve. Usikkerhet: høy
  sikkerhet for at API-et beskriver veien, middels/lav for at våre data og rettigheter faktisk gir XML-en.

## EHF-test (bygget 18.11.2026, venter på utrulling)
- Kort «EHF-test» under Råvarer › Innstillinger › Fakturalesing (bare godkjenner/admin). Velg leverandør eller «Én per
  leverandør» og 1–3 fakturaer per leverandør; verktøyet tar de nyeste som er hentet fra Tripletex og lest fra PDF.
- Lesende funksjon `tripletex-ehf-test` (i `supabase/pending/functions/`, se README der) prøver
  supplierInvoice → voucher → ediDocument/attachment → document/content og incomingInvoice (beta).
- Nettleseren tolker EHF (UBL) og Tripletex-linjer, viser dem side om side med PDF-linjene (forskjeller per felt) og
  et sammendrag per leverandør. Eksport som JSON. Ingenting lagres i NBhub.

## Ikke verifisert
- Ingenting er prøvd innlogget mot ekte data; innstillingssiden er bare typekontrollert og enhetstestet.
- Leserens kvalitetsgevinst er ikke målt (krever utrulling + fasitfakturaer).
- Kostnad for måling med sterkere modell beregnes med hovedmodellens sats i `invoice-model-eval`.
