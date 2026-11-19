# Serverkode som venter på utrulling (fakturalesing – opplæring, 18.11.2026)

Plattformen ruller ut edge-funksjoner automatisk når filer under `supabase/functions/` lagres. Derfor ligger
denne koden her, utenfor `supabase/functions/`, til Henrik har sagt ja til akkurat denne utrullingen.

**Status: RULLET UT 18.11.2026 (Henriks ja).** Modulene er flyttet til `supabase/functions/_shared/`, patchen er brukt,
og `READER_CODE_DEPLOYED = true`. Alle brytere er av. Tilbakerulling: se `docs/ravarer-drift.md`.

## Innhold (historikk)
- `_shared/readingSettings.ts`, `readingCatalog.ts`, `supplierProfile.ts`, `exampleRanking.ts`, `selfCheck.ts`,
  `goldCompare.ts`, `readingContext.ts` – ren kode (testet med vitest i `src/test/fakturalesing*.test.ts`).
  Innstillingssiden importerer de samme filene.
- `patches/20261122_fakturalesing_opplaering.patch` – endringer i fire eksisterende funksjoner:
  `extract-invoice-from-pdf` (index.ts, aiRead.ts), `invoice-model-eval` (index.ts), `tripletex-import-invoice-lines` (index.ts).

## Rekkefølge ved utrulling (etter ja)
1. Root kjører `supabase/pending/20261122_fakturalesing_opplaering.PENDING.sql` (etter ja) og `.check.sql`.
2. Flytt (`git mv`) de sju filene i `_shared/` til `supabase/functions/_shared/` og oppdater importstiene i
   `src/ravarer/lib/fakturalesing/readingApi.ts`, `src/ravarer/pages/innstillinger/fakturalesing/*` og testene.
3. Bruk patchen fra prosjektroten (`patch -p1 < supabase/pending/functions/patches/20261122_fakturalesing_opplaering.patch`).
4. Sett `READER_CODE_DEPLOYED = true` i `src/ravarer/lib/fakturalesing/readingApi.ts`.
Steg 2–4 i samme endring; lagring under `supabase/functions/` ruller ut automatisk.

## Hva som skjer etter utrulling
Ingenting endres før en bryter slås på under Råvarer › Innstillinger › Fakturalesing. Uten SQL eller ved feil i
oppslag leser leseren som i dag. Kontrollert lokalt: patchen gjelder rent mot dagens kode, og `deno check` gir
ingen nye feil (de tre feilene som vises finnes også i dagens kode med lokal Deno-versjon).

---

# EHF-test (18.11.2026) – `tripletex-ehf-test/`

**Status: RULLET UT 18.11.2026 (Henriks ja)** – ligger nå i `supabase/functions/tripletex-ehf-test/`. Ny, rent lesende funksjon. Ingen SQL trengs.

## Hva den gjør
Ett kall = én faktura, valgt fra kortet «EHF-test» under Råvarer › Innstillinger › Fakturalesing.
1. Krever innlogget bruker med godkjenner/admin (`has_ravarer_invoice_approve`). Ingen cron- eller tjenestevei.
2. Leser `invoices` (id, selskap, fakturanr, Tripletex-ID-er) – bare SELECT.
3. Sender bare **GET** til Tripletex med dagens tilkobling (`_shared/tripletex.ts`):
   - `GET /v2/supplierInvoice/{id}?fields=…` – fakturahode, bilag og `orderLines` (enklere felt-utvalg prøves ved 400)
   - `GET /v2/ledger/voucher/{voucherId}?fields=…` – `ediDocument`, `attachment`, `document`
   - `GET /v2/document/{docId}` og `GET /v2/document/{docId}/content` – for hvert dokument som ble funnet (høyst 4)
   - `GET /v2/incomingInvoice/{voucherId}?fields=*` – beta; kan gi strukturerte linjer
4. Svarer med logg per kall (endepunkt, HTTP-status, innholdstype, størrelse, Tripletex' feiltekst), EHF-XML
   (innebygde PDF-vedlegg fjernet) og eventuelle `orderLines`. PDF-innhold sendes ikke videre.

Skriver aldri til fakturaer, linjer, varer eller storage. Eneste skriving er den samme som alle Tripletex-funksjoner
gjør: `getSessionToken` kan fornye og bufre sesjonsnøkkelen i `tripletex_credentials`.

## Utrulling (etter ja)
`git mv supabase/pending/functions/tripletex-ehf-test supabase/functions/tripletex-ehf-test` – lagringen ruller ut
funksjonen automatisk. Ingen andre endringer trengs: kortet oppdager selv om funksjonen finnes.
Kontrollert lokalt: `deno check` gir ingen nye feil (bare den kjente feilen i `_shared/tripletex-crypto.ts`).

---

# Lesekø: ett forsøk per faktura per kjøring (19.11.2026) – `patches/20261119_lesekoe_ett_forsok_per_kjoring.patch`

**Status: RULLET UT 19.11.2026 (Henriks ja).** Patchen er brukt i `supabase/functions/`. Gjelder bare `tripletex-import-invoice-lines/index.ts`. Ingen SQL.

Feil: importen tar én faktura om gangen fra køen. En faktura som feiler av en ikke-systemisk grunn legges tilbake
som `pending` uten ventetid, og køen (sortert på færrest forsøk) kan gi den tilbake i samme kjøring. Da kan alle
tre forsøk brukes opp på sekunder, og fakturaen ender som «failed / needs_review».

Rettelse: kjøringen husker fakturaer som feilet. Gir køen tilbake en av dem, kalles
`rm_fail_invoice_line_extraction` med `release_attempt: true` (samme feiltekst, status `pending`) og kjøringen stopper.
Forsøket telles dermed ikke, og neste planlagte kjøring prøver igjen – som før ombyggingen.

Utrulling (etter ja): `patch -p1 < supabase/pending/functions/patches/20261119_lesekoe_ett_forsok_per_kjoring.patch`
fra prosjektroten. Kontrollert lokalt: patchen gjelder rent mot dagens kode, og `deno check` gir de samme to kjente
feilene som dagens kode, ingen nye.
