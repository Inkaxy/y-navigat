# Ordre-modulen: analyse og ombyggingsplan

Basert på lesing av NBOSv2/HEAD (`src/ordre`, `src/App.tsx`, `supabase/functions/*`) og read-only spørringer mot Supabase. Ingen kode eller database er endret.

## A. Bekreftede funn (verifisert) vs. antakelser

### A1. Omfang (bekreftet)
- `src/ordre`: 203 filer, 46 141 linjer. 29 ruter under `/ordre` (`src/App.tsx:445-475`).
- 62 hooks i `src/ordre/hooks`, 29 sider i `src/ordre/pages`.
- Største filer: `Leveringskalender.tsx` 2429, `DeliveryRuleFormDialog.tsx` 1661, `CustomerOrderModal.tsx` 1645, `NewOrder.tsx` 1421, `CakeImageEditor.tsx` 1287, `TicketDetail.tsx` 1173, `OrdersList.tsx` 1060, `DeliveryNoteDashboard.tsx` 897, `matrix/TourOrderDialog.tsx` 874, `useCustomerOrders.ts` 614.
- 35 `select('*')` i 20 filer; 27 `.tsx`-komponenter med direkte Supabase-kall; 175 `any`.
- **0 filer i `src/ordre` håndterer `isError`** mot 53 som bruker `isLoading`. Feiltilstander vises praktisk talt ikke.

### A2. Ordrekontorets dashbord (bekreftet)
`src/ordre/pages/Dashboard.tsx` (301 linjer) har bare fire KPI-er, alle ekte data:
- «Nye e-poster» — `useTicketCounts` (`useTickets.ts:193`, fire separate spørringer + `auth.getUser()`).
- «Fastordre i dag (ikke kjørt)» — `usePendingRecurringOrderRows`.
- «Levering i dag/i morgen» — `useDeliveryDayStats` (`useOrders.ts:123`, henter alle ordrerader og aggregerer i klienten).
- Under: `components/shell/TicketsInbox.tsx`-widget (373 linjer) + fastordre-liste med hardkodet `VISIBLE = 12`.

Data som allerede finnes, men **ikke** er på dashbordet:
| Arbeidsliste | Kilde som allerede finnes |
| --- | --- |
| Til godkjenning / avvik | `orders.status='awaiting_confirmation'`, `orders.rule_flags`, `approval_reason`; `useAcceptanceQueueCount`, `useOrdersLifecycle` |
| Frister som nærmer seg | RPC `check_order_deadline_violations`, `evaluate_delivery_rules`, `usePreviewDeliveryRules` |
| Pakkseddel-status/avvik | RPC `get_delivery_day_status` via `useDeliveryDayStatus.ts` (returnerer allerede `hovedkjoring`, `tilleggskjoringer`, `pauser`, og tellere for fastordre, daterte, retur, pakksedler, venter_godkjenning, **uten_tur**) — hooken finnes, men brukes ikke på dashbordet |
| Nettbutikkordre som venter | `website_orders` (11 rader), `website_order_rejects`, `WebsiteOrders.tsx` |
| Retur/tilbakebetaling | `refunds` (1 rad), `useRefunds`, `useReturnDeliveryNotes` |
| Nylige endringer | `order_status_history`, `audit_log`, `ticket_events` |
| Manglende tur/pris/kundeinfo | `orders.delivery_tour_id is null`, `order_lines.unit_price`, `pickup_locations` |

**Mangler:** ingen samlet «arbeidsbord»-RPC, ingen «mine oppgaver», ingen kobling mellom ticket-kø og ordrekø, ingen aggregering på server (dashbordet henter rader og teller i browseren).

### A3. Tickets / e-post / M365 / AI (bekreftet)
Datagrunnlag (faktiske radtall): `tickets` 73, `ticket_inbound_messages` **1**, `ticket_replies` 10, `ticket_events` 27, `ticket_attachments` 2, `email_outbox` 10, `microsoft_oauth_tokens` 2. Status: 72 av 73 tickets er `resolved`; kun 11 har `ai_status='success'`.

Flyten som finnes:
- `microsoft-graph-webhook` (355 l): validation-handshake, `clientState`-sjekk, idempotens på `microsoft_message_id` mot både `tickets` og `ticket_inbound_messages`, tråding via `conversation_id`, fallback via `[T-xxxxxxxx]` i emnet + RPC `find_ticket_by_short_id`, `awaiting_external`-håndtering, `ticket_events`-logging, vedleggsopplasting.
- OAuth: `microsoft-oauth-init/callback/disconnect`, `microsoft-token-refresh`, abonnement: `microsoft-graph-subscription-create/renew/delete`.
- Utsending: `microsoft-graph-send`, `microsoft-graph-reply`, `microsoft-graph-reply-ticket`, `process-email-outbox`, `send-order-confirmation`.
- AI: `analyze-email-with-ai` (581 l), `generate-ticket-reply` (398 l), `apply-ticket-change` (365 l), `check-ai-secrets`; UI `AiForslag.tsx`, `ChangeIntentCard.tsx`.
- `tickets.related_order_id` finnes, med RPC `sync_ticket_order_link` og tabell `ticket_order_links` (mange-til-mange) — **to parallelle koblingsmodeller**.

Konkrete feil/risikoer, alle bekreftet i kode:
1. **Postboks-inkonsistens `/me` vs `/users/{mailbox}`**: `microsoft-graph-webhook:104` og `:286` og `ticket-refetch-attachments:79` og `microsoft-graph-reply-ticket:81` bruker `/me/...`, mens `microsoft-graph-send:132`, `microsoft-graph-reply:115`, `send-order-confirmation:91` og `_shared/graph-mail.ts:51` bruker `/users/{mailbox}/...`. Med to rader i `microsoft_oauth_tokens` og delt postboks `ordre@notterobakeri.no` vil `/me` treffe kontoen som eier tokenet, ikke nødvendigvis den delte postkassen. Dette er den mest sannsynlige årsaken til at `ticket_inbound_messages` bare har 1 rad.
2. **Token-valg**: `microsoft-graph-send:98-103` tar «nyeste rad» i `microsoft_oauth_tokens` uten å filtrere på postboks. Med to rader er hvilken konto som sender ikke-deterministisk.
3. **Idempotens uten unik nøkkel**: webhooken sjekker eksistens og setter inn i to steg (les-så-skriv). Ved parallelle notifikasjoner for samme melding kan duplikater oppstå. Bør sikres med unik indeks + `on conflict`.
4. **Tråd-identitet**: kun `conversation_id` + emne-tag. `In-Reply-To`/`References`/`microsoft_internet_message_id` lagres, men brukes ikke til matching. Reply-all og videresending utenfra gir nye conversation-id-er.
5. **Sanitization**: `body_html` lagres rått og rendres i tråden. Må verifiseres at all rendering går gjennom sanitizer; quoted text trimmes ikke, så tråder blir uleselige.
6. **Status/SLA/ansvar**: `tickets.status` er fritekst `text`, ikke enum. `assigned_team` er enum `ticket_team`, `assigned_to` uuid, `followers` array — men det finnes ingen `sla_due_at`/`first_response_at`-kolonne; SLA beregnes i klienten (`lib/sla.ts`, `useSlaSettings`).
7. **Ingen låsing/concurrency**: `useUpdateTicket` skriver hele felt uten `updated_at`-sjekk; to saksbehandlere overskriver hverandre. `useTicketPresence` finnes, men er bare visning.
8. `useTickets` bruker `select('*')` med `limit(500)` og filtrerer klientsidig på tilordning — henter `body_html` for 500 tickets til listevisningen.

**«AI foreslår, menneske godkjenner» — det som mangler:** ingen felles forslagstabell med livssyklus (foreslått → godkjent/avvist → anvendt), ingen sporing av hvem som godkjente, ingen diff-visning som er lik på tvers av ordreutkast/svarutkast, ingen re-kjøring/versjonering av forslag. `ai_suggestion` er en løs jsonb uten skjema, og `apply-ticket-change` er eneste anvend-vei.

### A4. Leveringskalender / matrise (bekreftet)
- `Leveringskalender.tsx` 2429 linjer med all state, tabellrendering, dialoger og PDF-trigger i én fil. Matrisekomponentene er dialoger (`matrix/TourOrderDialog.tsx` 874, `CorrectionsDialog.tsx` 471, `ProductWeekEditor.tsx` 347 …), ikke et gjenbrukbart grid.
- Layout: `mx-auto w-[95%] max-w-[1800px] px-2` på linje 1105 og 1514 — dobbel container inne i sidens shell, med fast tak på 1800px og 5 % marg som spiser skjermbredde. Første kolonne er låst til `w-[320px] min-w-[320px]` (linje 2025, 2154, 2329, 2352). Sticky topprad `top-0 z-20` (2022) og sticky venstrekolonne `left-0` med tre ulike z-indekser (10/20/30).
- Ingen virtualisering: alle produktrader × dager rendres. Med full varekatalog blir dette tungt.
- **Dato/tidssone: tre ulike strategier i samme fil** — `new Date(dato + "T12:00:00")` (linje 244, 1292, 1565, 1892, 2031, 2071, 2154, 2390), `T00:00:00` (2071) og `Date.UTC(...)` (1913, 1916). `src/lib/osloDate.ts` finnes, men brukes bare delvis.
- Lagring går via `save_matrix_changes` (`useMatrix.ts:124`) som sender kun endrede celler — bra — men det finnes ingen optimistisk lås: `get_customer_matrix_data` leses med `staleTime: 15_000` og skrivinger sjekker ikke om raden er endret av andre.

### A5. Kundeordre (bekreftet)
- `CustomerOrders.tsx` (118 l) er kun kundevelger + `CustomerOrdersTab`. Ingen oversikt over kommende/tidligere ordre før kunde er valgt, ingen kalender/tidslinje, ingen hurtighandlinger.
- `CustomerOrdersTab.tsx` 273 l, `CustomerOrderModal.tsx` 1645 l (skjema, kakebilder, vedlegg, AI-forslag i én komponent).
- `useCustomerOrders.ts` 614 l gjør fler-stegs skriving i klienten: `next_order_number` → insert `orders` → insert `order_lines` → ved feil **manuell rollback via `delete`** (linje 341) og `orders.update(prevOrder)` (linje 522). Dette er ikke transaksjonelt; en avbrutt fane kan etterlate halve ordre.
- `(supabase as any).rpc("replace_child_rows", …)` (linje 511) — utypet RPC-kall.

### A6. Antakelser (ikke verifisert)
- At `/me` er hovedårsaken til lav inbound-volum er en sterk, men ikke bevist hypotese; må bekreftes mot Graph-logg og edge-function-logg.
- RLS-status per ticket-tabell er ikke gjennomgått policy for policy i denne runden.
- Lint/typecheck ble ikke kjørt i denne meldingen (kun statiske søk), for å unngå tilstandsendringer.

## B. Rangert feil-/mangelliste

### P0 — blokkerer daglig drift eller gir datafeil
1. Graph-postboks `/me` vs `/users/{mailbox}` og ikke-deterministisk tokenvalg → e-post kan hentes/sendes fra feil konto.
2. Ingen unik indeks som håndhever idempotens på `microsoft_message_id` → duplikate tickets/meldinger ved samtidige webhooks.
3. Ikke-transaksjonell ordreoppretting/-oppdatering i `useCustomerOrders.ts` med manuell rollback.
4. Ingen feiltilstander i UI (0 `isError`) → stille feil ser ut som «tomt».
5. Ingen samtidighetskontroll på ticket-status og matrise-celler → overskriving mellom saksbehandlere.

### P1 — reduserer effektivitet betydelig
6. Dashbordet er ikke et arbeidsbord: fire KPI-er, klientaggregering, ingen køer for godkjenning/frister/nettbutikk/retur/uten tur — selv om `get_delivery_day_status` allerede gir tallene.
7. Tråd-identitet kun via `conversation_id` + emnetag; quoted text og reply-all ikke håndtert.
8. Ingen strukturert AI-forslagslivssyklus (godkjent av / avvist / anvendt).
9. `Leveringskalender.tsx` 2429 linjer, dobbel container, fast 1800px, ingen virtualisering, tre dato-strategier.
10. `select('*')` på `tickets` med `limit(500)` inkl. `body_html` i listevisning.
11. To parallelle ordre↔ticket-koblingsmodeller (`related_order_id` og `ticket_order_links`).

### P2 — teknisk gjeld
12. 14 filer over 600 linjer; `CustomerOrderModal.tsx` og `DeliveryRuleFormDialog.tsx` bør splittes.
13. 175 `any`, verst i pakkseddel-hooks; utypede RPC-kall.
14. 27 komponenter med direkte Supabase-kall utenfor hooks.
15. Navnekollisjon `pages/TicketsInbox.tsx` vs `components/shell/TicketsInbox.tsx`.
16. Død rute `/ordre/avvik` (Placeholder) og foreldreløs `src/ordre/pages/Pakkesystem.tsx` (ruten redirigerer til produksjon).
17. A11y: sticky tabell uten `scope`/`aria-sort` gjennomgått, fokusfeller i store dialoger.

## C. Implementeringsplan i tre leveranser

**Leveranse 1 — Arbeidsbord + feiltilstander (ingen DB-endringer).**
Nytt operativt dashbord bygget på eksisterende hooks/RPC-er (`get_delivery_day_status`, `useOrdersLifecycle`, `useAcceptanceQueueCount`, `website_orders`, `useRefunds`, `order_status_history`). Felles `QueryState`-komponent for laster/feil/tomt som tas i bruk på ordre-, ticket- og kalendersidene. Rydding: fjern død `/ordre/avvik`-rute, omdøp widget til `TicketsInboxWidget`, stram `useTickets` til eksplisitt kolonneliste uten `body_html`. Drift påvirkes ikke — eksisterende sider består.

**Leveranse 2 — E-post- og ticket-hardening.**
Standardiser alle Graph-kall til `/users/{mailbox}`, velg token deterministisk per postboks, legg unik indeks + `on conflict` for idempotens, utvid trådmatching med `internet_message_id`/`In-Reply-To`, sanitize og kollaps quoted text i tråden, innfør optimistisk lås på ticket-oppdatering. Samle AI-forslag i én livssyklus med godkjenn/avvis/anvend og sporing av bruker.

**Leveranse 3 — Kalender og kundeordre.**
Del `Leveringskalender.tsx` i grid-, toolbar- og dialoglag, fjern dobbel container og 1800px-taket, én dato-hjelper (`osloDate`), virtualiser rader. Bygg ny kundeordre-arbeidsflate: kundesøk med nylige kunder, kommende/tidligere ordre, ukes-tidslinje, kopier forrige ordre, hurtigoppretting, avviks- og ticketkoblinger. Flytt ordreskriving til én transaksjonell RPC.

## D. Filer i leveranse 1

Nye:
- `src/ordre/hooks/useOrderDeskBoard.ts` — samler eksisterende hooks til ett arbeidsbord-datasett.
- `src/ordre/components/dashboard/WorkQueueCard.tsx` — generisk kø-kort (tittel, antall, tone, lenke, topp-5 rader).
- `src/ordre/components/dashboard/KpiTile.tsx` — uttrekk av dagens `KpiCard` for gjenbruk.
- `src/components/common/QueryState.tsx` — felles laster/feil/tomt-tilstand.

Endres:
- `src/ordre/pages/Dashboard.tsx` — bygges om til arbeidsbord med køer: til godkjenning, frister som nærmer seg, uten tur/hentested, nettbutikk venter, fastordre ikke kjørt, pakkseddelstatus, retur/tilbakebetaling, nye tickets, nylige endringer.
- `src/ordre/hooks/useTickets.ts` — eksplisitte kolonner i `useTickets`, `useTicketCounts` slås sammen til færre spørringer.
- `src/ordre/hooks/useOrders.ts` — `useDeliveryDayStats` teller med `head/count` i stedet for å hente alle rader.
- `src/ordre/pages/OrdersList.tsx`, `TicketsInbox.tsx`, `Leveringskalender.tsx` — ta i bruk `QueryState`.
- `src/App.tsx` — fjern `/ordre/avvik`-placeholder-ruten.
- Omdøping: `src/ordre/components/shell/TicketsInbox.tsx` → `TicketsInboxWidget.tsx`.

## E. Databaseendringer (først i leveranse 2, bakoverkompatibelt)

Ingen nye tabeller foreslås; eksisterende modell utvides.
1. `create unique index concurrently` på `tickets(microsoft_message_id)` og `ticket_inbound_messages(microsoft_message_id)` — krever dedupe-sjekk først (dagens volum: 73 / 1 rader, lav risiko).
2. `alter table tickets add column if not exists sla_due_at timestamptz, first_response_at timestamptz` — nullable, backfill valgfritt; klientberegning består til feltene er fylt.
3. `alter table ticket_inbound_messages add column if not exists in_reply_to text, references_header text` — nullable, kun brukt av ny trådmatching.
4. Konsolidering av ordre↔ticket: behold `related_order_id` som «primær ordre», la `ticket_order_links` være kanonisk for flere koblinger; `sync_ticket_order_link` utvides slik at begge holdes i synk. Ingen kolonne slettes.
5. Én transaksjonell RPC for ordreoppretting/-oppdatering (leveranse 3), `security definer` med `search_path=public`, som erstatter klient-rollbacken.

RLS-krav for alt av det ovennevnte: nye kolonner arver eksisterende policyer; nye/endrede funksjoner må være `security definer` med eksplisitt entitetssjekk (`current_user_entity_ids()`), og `GRANT EXECUTE` gis kun til `authenticated`. Ingen `anon`-tilgang til ticket- eller ordredata.
