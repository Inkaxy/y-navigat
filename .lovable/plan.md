# Aktiver "Inviter bruker"-knapp

## Problem
Knappen på `/admin/brukere` er hardkodet `disabled` med tooltip "Krever Supabase admin-invite (kommer i senere fase)". Den ble aldri koblet til en faktisk invitasjons-flow.

## Løsning
Bygg en komplett invitasjons-flow basert på Supabase `auth.admin.inviteUserByEmail`. Tilgang begrenset til eiere (samme `is_owner`-sjekk som brukes i RLS i dag). Stilling og selskap er påkrevd i samme dialog så bruker er klar til bruk umiddelbart etter at de aksepterer.

## Komponenter

### 1. Edge Function: `invite-user`
Ny `supabase/functions/invite-user/index.ts` (verify_jwt på).
- Henter caller fra JWT, sjekker at caller har `is_owner=true` via `user_positions` join (RPC eller direkte query med service_role). Returnerer 403 ellers.
- Validerer payload: `email`, `first_name`, `last_name`, `legal_entity_id`, `position_id`, valgfritt `outlet_scope`/`outlet_ids`.
- Kaller `supabase.auth.admin.inviteUserByEmail(email, { data: { first_name, last_name }, redirectTo: <site>/auth/accept-invite })` med service_role-klient.
- På suksess: insert i `public.users` (id = auth-user.id, display_name, email, status='invited') og `public.user_positions` (user_id, position_id, legal_entity_id, is_primary=true, valid_from=today, assigned_by=caller).
- Returnerer `{ success, user_id }`. Logger til audit.

### 2. UI: `InviteUserDialog.tsx`
Ny komponent `src/pages/admin/components/InviteUserDialog.tsx`:
- Felter: Fornavn, Etternavn, E-post, Selskap (Select fra `legal_entities`), Stilling (Select fra `positions`, filtrert på valgt selskap hvis aktuelt).
- Submit kaller `supabase.functions.invoke("invite-user", { body })`.
- Suksess-toast: "Invitasjon sendt til {email}". Lukker dialog og refetcher brukerlisten.
- Feil: vis serverfeil i toast (f.eks. 403, e-post finnes allerede).

### 3. Endring i `Brukere.tsx`
- Fjern `disabled` og Tooltip-wrapper på knappen.
- Vis kun knappen hvis `useIsOwner()` (ny liten hook som kaller eksisterende RPC eller leser fra session-claims). Hvis ikke-eier: skjul helt.
- Wire knapp til å åpne `InviteUserDialog`.

### 4. Akseptside (verifisering)
Sjekk at det finnes en eksisterende rute som håndterer Supabase-recovery/invite-callback (typisk `/auth` eller `/auth/callback`). Hvis ja: bruk den som `redirectTo`. Hvis ikke: legg til kort `/auth/accept-invite`-side som setter passord via `supabase.auth.updateUser({ password })` etter at session er aktiv fra invite-lenken.

## Tekniske detaljer

**RLS:** `users` og `user_positions` har allerede policies som tillater eier å skrive — edge function bruker service_role uansett, så ingen RLS-endringer trengs.

**Selskap/stilling-data:** `Brukere.tsx` henter allerede `legal_entities`. Stillinger hentes fra `positions`-tabellen (ny query i dialog).

**E-post-template:** Bruker default Supabase invite-mail i denne iterasjonen. (Egen branded mal kan legges til senere uten å endre flow.)

**Sikkerhet:**
- Function har `verify_jwt = true` i `config.toml`.
- Eierrolle-sjekk inne i function — kan ikke omgås fra klient.
- Service role brukes kun server-side i edge function.

## Filer som opprettes/endres
- `supabase/functions/invite-user/index.ts` (ny)
- `supabase/config.toml` (registrer function, verify_jwt=true)
- `src/pages/admin/components/InviteUserDialog.tsx` (ny)
- `src/pages/admin/Brukere.tsx` (aktiver knapp, hook for is_owner, åpne dialog)
- Evt. `src/pages/auth/AcceptInvite.tsx` + rute i `App.tsx` (kun hvis ingen eksisterende callback finnes)

## Akseptansekriterier
- Eier ser aktiv "Inviter bruker"-knapp; ikke-eier ser ingen knapp.
- Dialog krever e-post, navn, selskap og stilling før send.
- Ved send: bruker mottar Supabase invite-mail, ny rad i `users` (status='invited') og `user_positions`.
- Etter at invitert bruker setter passord via lenke kan de logge inn og bruker dukker opp som `active` i listen.
- Forsøk på å invitere som ikke-eier returnerer 403.
