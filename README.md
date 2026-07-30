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
