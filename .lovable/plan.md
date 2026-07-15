# Portaltilgang under Kunder

## Ny navigasjon
Legg til submeny-punkt **Portaltilgang** i Kunder-appen (ved siden av Kundeliste, Grupper, Profiler, Hentesteder, Innstillinger). Route: `/kunder/portaltilgang`.

## Datamodell (utvidelse)
`customer_portal_accounts` har i dag én kunde per rad. For å støtte at én bruker (auth-user) har tilgang til mange kunder — som Henrik i skjermbildet — endrer vi til to tabeller:

- `portal_users` — én rad per auth-bruker
  - `user_id` (auth.users), `display_name`, `email`, `role` (`kunde` | `admin`), `status` (`invited` | `active` | `disabled`), `last_login_at`
- `portal_user_customers` — kobling
  - `portal_user_id`, `customer_id`, `created_at`

Migrering: eksisterende rader i `customer_portal_accounts` flyttes automatisk (én `portal_users`-rad per unik `user_id`, én kobling per kunde). Gammel tabell beholdes til migreringen er verifisert.

RLS: kun brukere med tilgang til minst én av kundens `legal_entity` kan se/administrere portal-brukeren.

## Ny side: `PortalUsers.tsx`
Tabell med kolonner som i skjermbildet ditt:

| Nr | Navn | E-post | Rolle | Kunder |
|----|------|--------|-------|--------|

- Søk (navn / e-post / kundenavn / kundenr)
- Filter på selskap
- Klikk på rad → drawer/detaljvisning
- Knapp **Inviter portal-bruker** øverst til høyre

## Detaljvisning (drawer)
- Rediger navn, rolle
- Kunde-tilganger: legg til / fjern kunder (multi-select mot `customers`)
- Handlinger: *Send passord-recovery*, *Send ny invitasjon*, *Deaktiver / Aktiver*
- Sist innlogget, opprettet

## Invitasjonsdialog
- Fornavn, etternavn, e-post
- Multi-select: kunder som brukeren skal ha tilgang til
- Rolle (default `kunde`)
- Sender via ny edge function `portal-invite-user`

## Edge functions (service-role)
- `portal-invite-user` — oppretter auth-bruker (eller gjenbruker eksisterende), inserter `portal_users` + `portal_user_customers`, sender Supabase invite-mail med redirect til kundeportalens domene
- `portal-recovery` — sender passord-recovery
- `portal-set-status` — aktiver/deaktiver (setter `banned_until` på auth-brukeren + `status` i `portal_users`)

## Kundekort
Beholder ingen ny seksjon der. I stedet: liten badge/link «X portal-brukere» som hopper til `/kunder/portaltilgang?customer=<id>` (pre-filtrert).

## Tekniske detaljer
- Route og submeny-oppføring: `src/kunder/lib/routes.ts` + submeny-komponent
- Ny side: `src/kunder/pages/PortalUsers.tsx`
- Hooks: `src/kunder/hooks/usePortalUsers.ts`
- Dialoger: `src/kunder/components/InvitePortalUserDialog.tsx`, `PortalUserDrawer.tsx`
- Migration: nye tabeller + GRANT + RLS + backfill fra `customer_portal_accounts`
- Edge functions under `supabase/functions/portal-*`
