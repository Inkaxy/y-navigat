# Samle integrasjoner under /admin/integrasjoner

I dag viser siden bare Tripletex + tre "Kommer"-placeholders. Microsoft 365-e-post er allerede satt opp men gjemt i Ordre-app/innstillinger, og AI-konfig/forbruk ligger i Råvarer-app/innstillinger. Vi løfter disse opp på integrasjonssiden så plattform-admin har én oversikt.

## Endring 1 — E-post (Microsoft 365)

Microsoft-tokens ligger i `microsoft_oauth_tokens` (service_role-only), så vi kan ikke lese direkte fra browser. Vi lager en `SECURITY DEFINER`-RPC `get_email_m365_status()` som returnerer kun ufarlig metadata for plattform-admin:

```
{ connected boolean, email_address text, display_name text,
  connected_at timestamptz, scope text, expires_at timestamptz }
```

Nytt kort på `Integrasjoner.tsx`:
- Tittel "E-post (Microsoft 365)", subtittel "Felles avsender-konto for utgående og innkommende e-post."
- Status-badge: "Tilkoblet" / "Ikke konfigurert".
- Kobler til detalj-side `/admin/integrasjoner/email-m365`.

Ny detalj-side `src/pages/admin/EmailM365Integrasjon.tsx`:
- Tilkoblet konto (email, navn, tilkoblet-dato, scope).
- Knapp "Administrer i Ordre-appen" → `/ordre/innstillinger` (hvor selve OAuth-flow bor).
- Liten 7/30-dagers oppsummering fra `email_send_log` (sendt / feilet / suppressed) deduplisert på `message_id` — link til ekstern liste hvis ønskelig.

## Endring 2 — AI-tjenester

Nytt kort på `Integrasjoner.tsx`:
- Tittel "AI-tjenester", subtittel "Provider, modell og forbruk for AI-funksjoner."
- Badge med antall aktive purpose-konfig + "$X siste 30 dager".
- Kobler til `/admin/integrasjoner/ai`.

Ny detalj-side `src/pages/admin/AiIntegrasjon.tsx`:
- Seksjon "Aktive konfigurasjoner": rad per `purpose` med provider/modell/temperatur/max_tokens og hvilke som er aktive. Knapp "Rediger" → går til Råvarer-innstillinger der full editor bor (gjenbruker eksisterende `AiServicesSettings` uten å duplisere).
- Seksjon "Forbruk siste 30 dager" fra `ai_usage_log`:
  - Stat-kort: totale kall, suksessrate, input-tokens, output-tokens, total kost USD.
  - Tabell gruppert pr `purpose` × `provider` × `model`: kall, suksess, tokens inn/ut, kost.
  - Tidsperiode-toggle: 24t / 7d / 30d.
- Også samlestats fra `ai_call_log` (ticket-AI) hvis det viser noe — provider/model breakdown.

## Endring 3 — Rydding i integrasjons-oversikten

- Fjern "E-post (SMTP/IMAP)"-placeholder (erstattet av M365-kortet).
- Behold Tedebe og Fiken som "Kommer".
- Sorter kortene: faste øverst (Tripletex, M365, AI), så generiske, så placeholders.

## Database

En ny migrasjon med kun ny RPC `get_email_m365_status()` (ingen tabellendringer). Funksjonen kjører som SECURITY DEFINER, sjekker `is_platform_owner(auth.uid())` og returnerer kun metadata, aldri tokens.

## Filer

- ny migrasjon: `get_email_m365_status()`
- `src/pages/admin/Integrasjoner.tsx` — tre nye kort, fjern e-post-placeholder, ny status-fetcher
- `src/pages/admin/EmailM365Integrasjon.tsx` (ny)
- `src/pages/admin/AiIntegrasjon.tsx` (ny)
- `src/App.tsx` — to nye ruter `/admin/integrasjoner/email-m365` og `/admin/integrasjoner/ai`

## Ute av scope (gjøres senere ved behov)

- Flytte selve M365 OAuth-flowen fra Ordre-app til admin (krever endring av redirect-URI).
- Flytte AI-config-editoren fra Råvarer til admin (krever refaktor av `AiServicesSettings`).
- Per-selskap AI-config (i dag er purpose globalt).
