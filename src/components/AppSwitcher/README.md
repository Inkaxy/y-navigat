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

RPC returnerer per app: `id, slug, display_name, category, deploy_url,
start_path, icon_name, sort_order, status, color_hex, access_level`.

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

Samme `CURRENT_APP_SLUG` må også oppdateres i `Topbar.tsx` (brukes til å
hente app-fargen for underlinjen) og i `GlobalSearch.tsx`.

Ikke endre noe annet lokalt. Endringer speiles tilbake via NBHub.

## Navigasjon

- Klikk på app → `window.location.href = deploy_url + start_path + ?from=<slug>`
- IKKE `target="_blank"`. IKKE `window.open()`.
- Samme fane → tilbake-knapp i nettleseren tar bruker tilbake.

## App-farger

Hver app har en signaturfarge (`color_hex` i `apps`-tabellen) som vises:

- **AppSwitcher-trigger**: 3px venstre border + 8% alpha bakgrunn + ChevronDown-ikon i app-fargen
- **Topbar**: 2px underlinje i app-fargen (i `Topbar.tsx`)
- **AppSwitcher-dropdown**: liten farget prikk per app-rad (visuell repetisjon for læring)
- **/mine-apper-kort**: 3px topp-border + ikon-bakgrunn (12% alpha) + "Åpne →"-tekst i app-fargen

Fargen hentes fra `get_my_accessible_apps()` RPC, så endringer i
`apps.color_hex` reflekteres øyeblikkelig etter cache-utløp (5 min) eller
window-focus-refresh.

Når en ny app opprettes, sett `color_hex` i NBOS `/apper`-admin (input
type="color"). Unngå farger for nær eksisterende apper for å bevare
visuell distinksjon.

Default fallback hvis `color_hex` mangler: `#64748b` (slate-500).

## CSS-avhengigheter

Bruker kun shadcn-komponenter (Popover, Input, Badge) + Lucide-ikoner +
standard Tailwind-klasser. App-farger settes via inline `style` siden de
er dynamiske per app — ikke via CSS-tokens.

Brukte shadcn-tokens:
`--background`, `--foreground`, `--muted`, `--muted-foreground`,
`--accent`, `--accent-foreground`, `--border`, `--primary`,
`--primary-foreground`, `--popover`, `--popover-foreground`, `--ring`.

## Avhengigheter

- `@tanstack/react-query`
- `@supabase/supabase-js`
- `lucide-react`
- shadcn/ui (Popover, Input, Badge)
- `react-router-dom` (kun for "Vis alle apper"-lenken i NBHub)
