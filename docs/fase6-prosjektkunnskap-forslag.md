# Forslag til prosjektkunnskap etter fase 6 (til gjennomgang, ikke anvendt)

Erstatter avsnittet «USER REJECTED DELIVERY 2026-10-11» og «Completed independent audit» bare etter roots gjennomgang.

## Navigasjon og eiere
- `/ravarer` Oversikt · `/ravarer/varer` (ni lister + råvarekort med ni `?seksjon=`) · `/ravarer/priskontroll` (+ `faktura/:id`, `varekort`, `saker/:id`, `verktoy/reberegn`) · `/ravarer/leverandorer` (sju `?seksjon=`, forhandlinger) · `/ravarer/lager` (seks `?fane=`) · `/ravarer/innstillinger`. Offentlige: `/tilbud/:token`, `/bekreftelse/:token`. Rute-eiere i `src/ravarer/routes.tsx`; per-ID-kart i `docs/ravarer-funksjonsmapping.json`.

## Forretningsregler som skal bevares
- Fakturalinjer rettes bare via eksisterende rettedialog/`rm_correct_invoice_line`; læring = gjenbruk av gjennomgåtte eksempler per selskap+leverandør, ikke modelltrening. «Rett sumavvik» åpner rettedialogen for en bestemt linje, aldri overstyring.
- Sumavvik beskrives etter retning (for høy/for lav/ukjent) fra sammenlignbare beløp.
- Leverandørkladder går bare til Henrik (intern kladd), aldri direkte til leverandør.
- Gjeldende kostpris = nyeste gyldige kandidat; historikk leses fra låste snapshots.
- Allergenstatus: vurdert (`allergens_reviewed_at`) er adskilt fra om allergener finnes.

## Bevisregler
- Kilde, mock-test, nettlesermåling og aksept er separate dimensjoner. Rute/import er ikke bevis for at handlingen virker. Ingen ekte forretningshandlinger (retting, godkjenning, utlesing, reberegning, lagerbevegelse, e-post, portalpålogging, AI) som test.

## Gjenstår
- Nettlesermåling 390/1440 av 44 px, fokus og Escape i fakturaflaten; innlogget gjennomgang av alle 313 ID-er; rettelenke i faktura-peek.
