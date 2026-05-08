## Mål

1. **`/admin/apper`** går fra CRUD-side til **read-only "App-helse & bruksstatistikk"**.
2. **Alle eksterne `https://*.nbhub.no`-lenker fjernes** fra app-launcher/switcher/tabs/command-palette/cards. Apper navigeres internt via React Router uansett hva `apps.deploy_url` inneholder.

Ingen DB-endringer. Ingen migrasjon.

---

## Del 1 — Ny `/admin/apper`: App-helse & bruksstatistikk

Erstatt CRUD-tabellen i `src/pages/admin/Apper.tsx` med en read-only oversikt. Beholder ruten, sidetittel og `AppHeaderBanner`.

**Datakilder (alt finnes allerede):**
- `apps` — grunninfo (code, display_name, color_hex, status, category, sort_order)
- `audit_log` aggregert på `source_app` — bruks-signal
- `position_app_access` aggregert på `app_id` — tilgangs-signal

**Kolonner i ny tabell** (én rad per app, sortert etter `sort_order`):

| Kolonne | Innhold |
|---|---|
| App | Fargeprikk + `display_name` + `code` (mono, muted) |
| Status | Badge (`active` / `in_development` / `planned` / `deprecated` / `disabled`) |
| Kategori | tekst |
| Hendelser 7d | COUNT fra `audit_log` siste 7 dager der `source_app = apps.code` |
| Hendelser 30d | tilsvarende 30 dager |
| Aktive brukere 30d | COUNT(DISTINCT user_id) |
| Siste aktivitet | `MAX(occurred_at)` formatert relativt ("2t siden", "i går", "3d siden") + tooltip med eksakt tidspunkt; "—" hvis ingen |
| Tilganger | Antall stillinger som har tilgang til appen (`position_app_access` gruppert på `app_id`), liten badge per nivå (read/write/approve/admin) |

**Topp-rad med KPI-kort** (4 kort over tabellen):
- Totalt antall apper (split: aktive / under utvikling / planlagt)
- Hendelser siste 7 dager (sum)
- Aktive brukere siste 7 dager (distinct user_id på tvers)
- App uten aktivitet siste 30d (count) — hjelp til å se "døde" apper

**Filter-rad** (over tabellen, beholder `Select`-stil fra dagens side):
- Status-filter (samme som i dag)
- Kategori-filter (ny)
- "Vis kun apper med aktivitet siste 30d"-toggle

**Det som FJERNES fra siden:**
- `Ny app`-knapp
- `Pencil`/`Arkivér`-knappene per rad og hele edit-`Dialog`-en
- Kolonnen "Deploy URL" og kolonnen "Access pattern"
- `save`/`archive` mutations + `editing` state

**Det som beholdes:**
- Selve ruten `/admin/apper` og menyoppføringen i admin-sidemenyen
- `AdminLayout` + `AppHeaderBanner` (ny subtitle: "Bruks- og helseoversikt over registrerte apper.")

**Implementasjon:**
- Bruk én `useQuery` som henter `apps`, og to RPC-løse `useQuery` som kjører:
  - `supabase.from('audit_log').select('source_app, user_id, occurred_at')` med `gte('occurred_at', 30dagerSiden)` — aggregeres klient-side til 7d/30d-tall (volumet er lavt; ~mindre enn 1000 rader per måned per dagens målinger)
  - `supabase.from('position_app_access').select('app_id, level')` — aggregeres klient-side
- Join skjer i TS via `Map<appCode, stats>` og `Map<appId, accessCounts>`.
- Loading: skeleton-rader. Empty state per celle: "—".

**Edit-flyt for app-metadata** (status, farge, sort_order osv.) er ikke en del av denne siden lenger. Hvis Henrik trenger å endre slikt: gjøres direkte i Supabase eller en ny dedikert side senere — utenfor scope.

---

## Del 2 — Fjern eksterne `https://*.nbhub.no`-lenker fra app-navigasjon

Alle apper bor nå i samme React-app. `deploy_url` skal **ikke lenger** drive `window.location.href`-navigasjon. Vi router internt via `react-router-dom` `useNavigate` mot en sentralisert `INTERNAL_ROUTES`-mapping.

**Sentraliser routing-mappingen:**

Lag `src/lib/appRoutes.ts`:
```ts
export const APP_INTERNAL_ROUTES: Record<string, string> = {
  nbhub: "/",
  nbos: "/admin",
  varer: "/varer",
  kunder: "/kunder",
  ravarer: "/ravarer/vareliste",
  ordre: "/ordre",
  produksjon: "/produksjon",
  // pos_styring: "/pos-admin", ← legges inn når intern rute finnes
};

export function getAppInternalRoute(slug: string): string | null {
  return APP_INTERNAL_ROUTES[slug] ?? null;
}
```

**Filer som endres til å bruke `navigate(internalRoute)` og droppe `window.location.href = deploy_url + ...`:**

| Fil | Endring |
|---|---|
| `src/components/layout/AppSwitcher.tsx` | Fjern lokal `INTERNAL_ROUTES`. Bruk `getAppInternalRoute`. Hvis ingen intern rute → vis appen som "ikke tilgjengelig" (disabled rad) i stedet for å åpne `deploy_url`. |
| `src/components/AppSwitcher/AppSwitcher.tsx` | Samme — fjern lokal `INTERNAL_ROUTES`, fjern `new URL(app.deploy_url)`-host-sjekk (ikke relevant lenger siden vi ALDRI navigerer eksternt), bruk sentral helper og `navigate()`. |
| `src/components/layout/AppTabs.tsx` | Fjern `external`-feltet i `Entry`. Apper uten intern rute filtreres bort fra tab-baren (eller vises disabled med tooltip "Ikke tilgjengelig ennå"). |
| `src/components/layout/MobileAppWheel.tsx` | Samme som AppTabs. |
| `src/components/layout/CommandPalette.tsx` | `handleAppSwitch` bytter signatur til `(slug: string)` og kaller `navigate(getAppInternalRoute(slug))`. |
| `src/components/layout/GlobalSearch.tsx` | Fjern `deploy_url`-host-sjekk og ekstern redirect. Søketreff på app navigerer internt via `navigate()`. Hvis ingen intern rute → ekskluderes fra resultater. |
| `src/components/AppCard.tsx` | `planned`-sjekken endres fra `!app.deploy_url` til `!getAppInternalRoute(app.slug) || app.status === "planned"`. CTA bruker `<Link to={internalRoute}>` i stedet for `<a href={deploy_url}>`. |

**`deploy_url` selv beholdes i DB og typer** — vi rører ikke `apps`-tabellen, og typegenerasjonen i `src/integrations/supabase/types.ts` skal stå urørt. Feltet blir bare ubrukt i frontend.

**`src/lib/sharedCookieStorage.ts`** beholdes som-er. `.nbhub.no`-cookie-domain er fortsatt korrekt: vi er på `nbhub.no` i prod, og fallback til `localStorage` håndterer preview-domener.

**`src/varer/pages/embed/CakeBuilderEmbed.tsx`** og **`src/varer/features/cakeBuilder/contract.ts`** og **`src/ordre/pages/Innstillinger.tsx`**: rg-treffene her er ikke app-launcher-lenker (CakeBuilder-embed og e-post-innstilling-tekst). De rører vi ikke.

---

## Verifisering (manuell, etter implementasjon)

1. `/admin/apper` viser KPI-kort + tabell med stats. Ingen edit-knapper. Lasting OK med dagens datavolum.
2. Klikk på app i topbar AppSwitcher → intern navigasjon (ingen full reload).
3. ⌘+J Command Palette → intern navigasjon.
4. Globalt søk → app-treff navigerer internt.
5. Hjem-side AppCards → går til intern rute.
6. Apper uten intern rute (f.eks. POS Styring, Lager, Faktura, Salg, Kampanje, NB Insight) vises disabled/"kommer snart" — ingen redirect til ekstern URL.

---

## Ute av scope

- Faktisk sletting av `deploy_url`-kolonnen fra DB
- Ny CRUD-side for app-metadata
- Endring av `sharedCookieStorage`
- POS Styring og andre apper som ennå ikke har intern rute (markeres som "kommer snart")
