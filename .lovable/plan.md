# Forhandlingsmodul + Utvidet innkjøpsstatistikk

Stort omfang. Foreslår levering i 3 milepæler så vi kan teste underveis.

## Milepæl A1 — Månedlig kjøpsdata + periode-velger (datafundament)

**Database**
- Ny materialisert visning `raw_material_monthly_purchases` (måned-granularitet pr råvare/leverandør/legal_entity).
- Unique index + støtte-indekser.
- Inkluderes i eksisterende refresh-funksjon (`refresh_purchase_stats()`).

**Edge function: `get-purchase-stats-for-range`**
- Input: scope (raw_material_id / supplier_id / legal_entity_id), period_start/end, compare-mode (`previous_period` | `same_period_last_year` | `custom` | `none`), granularity (`total` | `monthly`).
- Output: `primary_period`, `comparison_period`, `delta` med `pure_price_impact_kr` og `pure_volume_impact_kr`.
- Beregning av ren pris-/volum-effekt:
  - `pure_price_impact = (avg_price_now - avg_price_prev) × volume_prev`
  - `pure_volume_impact = (volume_now - volume_prev) × avg_price_prev`

**UI-komponenter**
- `PeriodPicker` (gjenbrukbar) — snarveier: Hittil i år, Hele i fjor, Hittil i fjor, Siste 30/90/365 dg, Q1–Q4, Egendefinert.
- `ComparisonPicker` — Samme periode i fjor / Forrige tilsv. periode / Egendefinert / Ingen.
- `MonthlyBreakdownDialog` — linjegraf (recharts, 2 serier) + tabell + Excel-eksport.

**Steder periode-velger kobles på (erstatter dagens statiske kort)**
- Råvare-detaljside (Innkjøp-kort).
- Leverandør-detaljside (Total handel-kort).
- Ny side `/ravarer/innkjopsrapport` — topp-20 råvarer (volum/kostnad), topp-10 leverandører, inflasjonsbidrag, volume-shifts (>20%).

## Milepæl A2 — Forhandlingsmodul: kjerne (draft → invited)

**Database** (alle tabeller med RLS via `invoice_access` + legal_entity_id):
- `negotiations`, `negotiation_items`, `negotiation_recipients`, `negotiation_responses`, `negotiation_messages`, `negotiation_outcomes`.
- Helper: `negotiation_recipient_by_token(token, password)` SECURITY DEFINER for anonym tilgang.

**Navigasjon**
- Ny tab "Forhandlinger" mellom Avtaler og Fakturaer (synlig for `invoice_access = true`).
- Ruter: `/ravarer/forhandlinger`, `/ny`, `/arkiv`, `/:id`.

**Wizard (5 steg)**
1. Grunninfo (tittel, formål, perioder, baseline-periode default = forrige 12 mnd, svarfrist).
2. Velg råvarer — tabell viser ekte baseline-tall (volum, kostnad, snittpris, YoY) hentet fra `raw_material_monthly_purchases`. Auto-fyller `expected_annual_volume`, `actual_*_baseline`. Snarvei "alle råvarer fra leverandør X".
3. Velg leverandører — forhåndsvalgt: alle som leverer minst én valgt råvare. Viser handel siste 12 mnd + match-status.
4. Tilpass e-post — mal med faktiske volumer + tabell + token-lenke-placeholder.
5. Send — `generate-rfq-credentials` lager token + 6-tegns passord pr leverandør, kopierer e-post til utklippstavle, status → `invited`. Passord vises i klartekst i 5 min (via `expire-rfq-passwords` cron).

**Forberedelses-widget på råvare-detaljside**
- "Forhandlingsgrunnlag"-kort med pris-status, baseline-data, YoY, og "Start forhandling for denne råvaren".

## Milepæl A3 — Leverandør-portal + sammenligning + avslutning

**Public route `/tilbud/:token`** (egen shell, uten NBhub-nav)
- Login: kun passord. Rate limit (5 forsøk / 15 min pr token, 20 / time pr IP). 5 fail → token lockes.
- Tilbudsside: kun råvarer i forhandlingen, viser forventet volum + pakningsforslag. Ikke baseline-pris/andre tilbud.
- Skjema: pris, pakningsstørrelse, kontraktslengde, min.volum, betalings-/leveringsbetingelser, datablad-opplasting, notater.
- Kladd-lagring + endelig "Send tilbud" → `submitted`, lockes.

**Edge functions**
- `validate-rfq-access` (passord + rate limit + audit i `negotiation_messages`).
- `submit-negotiation-response` (kladd/endelig).
- `unlock-rfq-for-edit` (admin).
- `send-rfq-reminder`.
- `apply-negotiation-outcome` (oppdater `raw_material_suppliers`).
- Cron: `expire-old-tokens` (daglig), `expire-rfq-passwords` (5 min).

**Forhandlings-detaljside**
- Header med status, frist, baseline-sammendrag, mål.
- Råvare-liste med mål-pris og potensiell besparelse.
- Mottakerstatus-tabell (sendt/vist/svart, send purring).
- Sammenligningsmatrise: 🏆 beste, ✅ bedre enn baseline, ❌ dårligere. Beregner besparelse = `actual_volume_baseline × tilbudt_pris` vs `actual_cost_baseline`. Total årskostnad pr leverandør + total realisert besparelse.

**Avslutning**
- Modal: pr råvare velg vinner-leverandør (default = beste). Sjekkbokser for å oppdatere `raw_material_suppliers`, sette primær, sende takk-mail. Status → `concluded`, alle tokens → `expired`.

**Innstillinger** — `/ravarer/innstillinger/forhandlinger` (svartid, token-varighet, baseline-lengde, purring, auto-lås, e-postmaler).

## Tekniske notater

- Hash: `bcrypt` via `crypto.subtle` (Deno) eller pgcrypto. Velger pgcrypto (`crypt(password, gen_salt('bf', 10))`) — enklere, kjører server-side.
- Token: `crypto.randomBytes(24).toString('base64url')` (32 tegn).
- Passord: 6 tegn fra alfabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (uten 0/O/I/1/L).
- Rate limit: enkel tabell `rfq_access_attempts (token, ip, attempted_at)` med tids-vindu-query (per no-rate-limiting-direktivet: dette er sikkerhetskritisk inngang for anonyme leverandører — implementeres som ad-hoc i edge function siden brukeren eksplisitt har bedt om det).
- E-postsending: ikke konfigurert nå → "kopier til utklippstavle" som i tidligere leveranser. Kan byttes til Resend senere.
- RLS: alt scoper på `legal_entity_id` + `has_position_access(invoice_access)`. Anonym leverandørtilgang KUN via `negotiation_recipient_by_token` RPC.

## Spørsmål før jeg starter

1. Skal jeg levere i tre milepæler (A1 → vent på OK → A2 → A3) eller kjøre alle på rad?
2. OK at rate limiting implementeres ad-hoc i edge function for `validate-rfq-access` (siden anonym tilgang er sikkerhetskritisk her)?
3. E-post: bekrefter at vi fortsatt bruker "kopier til utklippstavle" for nå, ikke Resend.
