# AppSwitcher

Felles komponent for NBOS-apper. Viser alle apper brukeren har tilgang til
og lar dem navigere mellom apper i samme fane.

## Bruk

I topbar, erstatt statisk app-tittel med:

```tsx
import { AppSwitcher } from "@/components/AppSwitcher";

<AppSwitcher />
```

Komponenten rendrer `[Appnavn ▾]`-trigger som åpner popover med alle
tilgjengelige apper.

## Datakilde

Henter data fra `get_my_accessible_apps()` RPC via
`useAccessibleApps()`-hook. Cache 5 min, refresh ved window focus.

## Aktiv app

Matches via `slug === CURRENT_APP_SLUG` (primært) og fallback hostname-
sammenligning mot `deploy_url`. Aktiv app er ikke-klikkbar (disabled)
og markert med ✓.

## Speiling til andre apper

Kopier hele `src/components/AppSwitcher/` + `src/hooks/useAccessibleApps.ts`
ordrett. Juster KUN disse to konstantene øverst i `AppSwitcher.tsx`:

```ts
const CURRENT_APP_SLUG = "nbhub";    // → bytt til 'nbos' / 'ordre' / 'kunder' / 'varer'
const SHOW_ALL_APPS_LINK = true;     // → false i alle satellittapper
```

Ikke endre noe annet lokalt. Endringer speiles tilbake via NBHub.

## Navigasjon

- Klikk på app → `window.location.href = deploy_url + start_path + ?from=<slug>`
- IKKE `target="_blank"`. IKKE `window.open()`.
- Samme fane → tilbake-knapp i nettleseren tar bruker tilbake.

## CSS-avhengigheter

Bruker kun shadcn-komponenter (Popover, Input, Badge) + Lucide-ikoner +
standard Tailwind-klasser. Ingen custom CSS.

Brukte tokens (alle shadcn-standard):
`--background`, `--foreground`, `--muted`, `--muted-foreground`,
`--accent`, `--accent-foreground`, `--border`, `--primary`,
`--primary-foreground`, `--popover`, `--popover-foreground`.

I tillegg brukes `bg-app` / `text-app-foreground` på trigger-knappen for
å matche topbar-fargen i hver app (definert via `AppThemeProvider`).

## Avhengigheter

- `@tanstack/react-query`
- `@supabase/supabase-js`
- `lucide-react`
- shadcn/ui (Popover, Input, Badge)
- `react-router-dom` (kun for "Vis alle apper"-lenken i NBHub)
