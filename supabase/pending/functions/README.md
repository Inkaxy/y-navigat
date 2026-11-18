# Serverkode som venter på utrulling (fakturalesing – opplæring, 18.11.2026)

Plattformen ruller ut edge-funksjoner automatisk når filer under `supabase/functions/` lagres. Derfor ligger
denne koden her, utenfor `supabase/functions/`, til Henrik har sagt ja til akkurat denne utrullingen.

**Status: klar for utrulling – venter på ja.**

## Innhold
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
