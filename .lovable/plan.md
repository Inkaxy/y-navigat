# To endringer

## 1. Bruk `display_name` (visningsnavn) overalt der selskap vises

I dag vises `legal_name` ("Nøtterø Bakeri & Konditori AS") og `short_code` ("NK") i topbar, dropdown, command palette og selskapsliste. Visningsnavnet ("NB") fra Rediger selskap-dialogen lagres, men brukes ingen steder.

**Endring:** Innfør en helper `entityLabel(e) = e.display_name?.trim() || e.legal_name` og bruk den som primær visning:

- `src/components/layout/CompanySelector.tsx` — knappetekst, dropdown-rader, initialer
- `src/components/layout/CompanyBlock.tsx` — brand-label
- `src/components/layout/CommandPalette.tsx` — "Bytt til …"
- `src/pages/admin/Selskaper.tsx` — ny kolonne "Visningsnavn", behold "Juridisk navn"
- Alle tre `select(...)` legger til `display_name`

`legal_name` beholdes som sekundær (liten grå tekst under) der det er plass, så formell tittel ikke forsvinner.

## 2. Aktivere/deaktivere apper per selskap

I dag styres app-tilgang av stilling (`position_app_access`). Vi legger på et selskaps-nivå filter: en app kan markeres som "ikke i bruk" for et selskap, og forsvinner da fra meny / launcher / command palette for ALLE brukere som er aktive i det selskapet.

### Database (migrasjon)

Ny tabell `legal_entity_app_access`:
```
legal_entity_id uuid → legal_entities.id  (cascade)
app_id          uuid → apps.id            (cascade)
enabled         bool default true
created_at, updated_at
PRIMARY KEY (legal_entity_id, app_id)
```
- GRANTs: select for authenticated, all for service_role
- RLS: les for innloggede med stilling i selskapet (via `current_user_entity_ids`); skriv kun for platform owners
- Konvensjon: rad **mangler** = enabled. Rad med `enabled=false` = skjult. Slik trenger vi ikke seede noe.

Oppdater `public.get_my_accessible_apps()` til å filtrere ut apper hvor det finnes en `enabled=false`-rad for det aktivt valgte selskapet. Siden RPC-en ikke kjenner aktivt selskap, eksponerer vi i stedet en ny RPC `get_apps_for_entity(entity_id uuid)` som returnerer apper brukeren har tilgang til OG som er aktivert for selskapet. `useAccessibleApps` kaller den nye RPC-en med `legalEntityId` fra `SelectionProvider` og inkluderer id-en i query-key så menyen oppdateres ved bytte av selskap.

### UI

I `Rediger selskap`-dialogen (`Selskaper.tsx`) — ny seksjon **APPER**:
- Liste over alle aktive apper, hver med en `Switch` (på/av)
- Lagring: upsert i `legal_entity_app_access` ved toggle; toast ved suksess/feil
- Invalider `["accessible-apps", entityId]` etterpå

### Tekniske detaljer

- `useAccessibleApps`: `queryKey: ["accessible-apps", legalEntityId]`, `enabled: !!legalEntityId`, kaller `get_apps_for_entity(legalEntityId)`.
- Topbar/launcher/MobileMenu bruker allerede hooken — endring er transparent.
- Bytte av selskap i `CompanySelector` trigger ny query → menyen reagerer umiddelbart.
- Bakoverkompat: behold `get_my_accessible_apps` i en periode i tilfelle andre kallesteder finnes; ny RPC supplerer.

### Filer som endres
- ny migrasjon: tabell, GRANTs, RLS-policies, `get_apps_for_entity` RPC
- `src/hooks/useAccessibleApps.ts`
- `src/pages/admin/Selskaper.tsx` (Apper-seksjon + Visningsnavn-kolonne)
- `src/components/layout/CompanySelector.tsx`
- `src/components/layout/CompanyBlock.tsx`
- `src/components/layout/CommandPalette.tsx`
- liten `src/lib/entityLabel.ts` helper
