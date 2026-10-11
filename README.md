# NBHub

Driftsplattformen til Nøtterø Bakeri: ordre, produksjon, varer, kunder, kasse (POS), fakturering og kundeportal i én React-app.

## Stack
- React 18 + Vite 5 + TypeScript (strict) + Tailwind/shadcn
- Supabase (Postgres, RLS, Edge Functions) som backend
- TanStack Query for datahenting, react-router for ruting

## Kom i gang
```bash
npm ci      # kun package-lock.json er gjeldende lockfil
npm run dev # http://localhost:8080
```

## Nyttige kommandoer
| Kommando | Beskrivelse |
| --- | --- |
| `npm run dev` | Utviklingsserver |
| `npm run build` | Produksjonsbygg |
| `npm run lint` | ESLint |
| `npm test` | Vitest (enhetstester) |

## Struktur
`src/<app>/` er én mappe per app-modul (ordre, produksjon, varer, kunder, pos, pos_styring, fakturering, kundeportal, ravarer). Delte UI-komponenter ligger i `src/components/`, delte hjelpere i `src/lib/`.

## Konvensjoner
- Farger og skygger via semantiske tokens i `src/index.css` / `tailwind.config.ts` — aldri hardkodede fargeklasser.
- Datoer i Europa/Oslo via `src/lib/osloDate.ts`.
- Databaseendringer skjer via migrasjoner i `supabase/migrations/`.

## Status Råvarer 2.0 priskontroll (2026-10-11)
Første UX-del av 3A/3B er bygget i de ekte sidene (`/ravarer/priskontroll` og fakturaarbeidsflaten):
- Å gjøre: gruppekolonne (mobil: nedtrekk + filterknapp), oppgaveoverskrift med forklaring og tellere (leverandørvarer · fakturasaker for hele køen), rader med årsak og neste handling, nyttig tomt panel. Klikk-valg legges i nettleserhistorikken; faktura åpnet fra Å gjøre får med filtrene tilbake.
- Kronevirkning: bare `effect_status='verified_price_effect'` fra serveren vises som «Beregnet prisavvik». Ellers «Kontroller lesingen» eller «Prisvirkning ikke beregnet». Bruttobeløp vises bare som «Fakturabeløp». Serverfeltene kommer i root-patch; inntil da er alt «ikke beregnet».
- Fakturaarbeidsflaten: originaldokument åpent som standard fra 1280 px, én kontrollblokk (netto, lest sum, differanse, gjenstår), sum/mva/overstyring/retting samlet i «Flere valg», faner Dokument/Linjer/Kontroll og fast hovedknapp på mobil.
- Rettet: sum regnes som kontrollert bare ved `ok`/`overridden`; «Hent linjer» bare for tom faktura; null hentede linjer er ikke suksess; rå AI-score kalles aldri «sikker».
Ikke ferdig: ny lesing med forhåndsvisning (venter på root-kontrakt), serverens effektfelt, 3C og fase 4–6. Lokale sjekker med faste data: `/gjore-routed-preview.html`, `/faktura-routed-preview.html` (bare i utviklingsserveren).
