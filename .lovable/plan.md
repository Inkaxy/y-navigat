# UX-audit: Ticket / Innboks i Ordre-modulen

Kun analyse — ingen kodeendringer foreslått implementert her.

Grunnlag: gjennomgang av faktisk kode i `TicketsInbox.tsx` (801 linjer), `TicketDetail.tsx` (1274 linjer), `TicketActionBar`, `OrderLinkCard`, `LinkOrderSearch`, `CreateOrderFromTicketButton`, `LinkCustomerDialog`, `TicketComposerActions`, `ChangeIntentCard`. Preview-innlogging var ikke tilgjengelig i dette miljøet (prosjektet bruker ekstern Supabase-auth), så vurderingen er gjort på den rendrede strukturen i koden, ikke på levende skjermbilder.

## De 15 viktigste UX-problemene (rangert)

1. **Ingen split-view — hver sak koster full sidenavigasjon.** Innboksen er en ren liste; å lese en sak betyr rutebytte til `/ordre/ticket/:id`, og tilbake via «Tilbake til innboksen». Køposisjon, scroll, søk og filtre må gjenoppbygges mentalt hver gang. For et ordrekontor som skal gjennom 30–80 e-poster om morgenen er dette den største enkeltkostnaden.
2. **Ingen tastaturnavigasjon i arbeidsflyten.** Ingen j/k-navigasjon, ingen `e` (løs), `a` (tildel), `r` (svar), ingen Cmd+Enter-send i composeren, ingen «neste sak» etter løsning. Alt krever mus. `Send`-knappen har heller ingen hurtigtast.
3. **Venstremenyen har 16+ køer uten prioritering.** Køer, intensjonskøer, «Mine», arkivstatuser og team-køer ligger visuelt likestilt i én smal kolonne. En saksbehandler trenger reelt 3–4 innganger (Mine, Uten ansvarlig, Over frist, Alle åpne); resten er filtre, ikke køer.
4. **Ingen bulk-handlinger og ingen avkryssing.** Tildeling, statusendring, søppelmerking og team-flytting må gjøres én og én, og kun inne på detaljsiden. Rutinemessig opprydding (spam, kvitteringer, autosvar) blir uforholdsmessig dyrt.
5. **Handlinger mangler helt i listen.** Hver rad er kun en lenke; det finnes ingen hover-handlinger («Ta selv», «Løs», «Søppel», «Utsett»). Selv en triviell sak krever minimum 3 klikk + 2 sidelastinger.
6. **AI-tillit kommuniseres inkonsekvent.** Konfidens vises som prosentchip i listen (grønn/gul/rød terskel), men i sidefeltet er samme tall alltid grønn ramme uansett verdi. Intensjonsbadgen vises like «hardt» ved 45 % som ved 95 %, uten at det står hva analysen faktisk bygger på. Det gir enten overtillit eller vilkårlig mistillit.
7. **AI-utkast erstatter innholdet i skrivefeltet uten forvarsel eller angremulighet.** `onAiDraft` setter `setText(...)` direkte over et eventuelt påbegynt svar. Ingen diff, ingen «behold mitt utkast», ingen angre.
8. **Kundeidentifisering er skjult nederst i høyre kolonne.** «Ikke i kunderegisteret» — den viktigste risikoopplysningen på siden — ligger under ordrekortet, i liten tekst. Toppen viser bare rå avsenderadresse. Ved ukjent avsender bør identiteten være det første, ikke det tredje.
9. **To parallelle veier til ordre skaper forvirring.** «Koble til ordre» (søk), «AI-forslag», «Opprett kundeordre fra e-posten» og «Bytt ordre» ligger i samme kort med lik visuell vekt, uten et tydelig «gjelder dette en eksisterende ordre eller en ny?»-veivalg. `related_order_id` og `ticket_order_links` gir dessuten et «Primær»-begrep som aldri forklares i UI-et.
10. **Ordreopprettelse fra ticket taper kontekst.** Flyten er popover → kundesøk → stor `CustomerOrderModal` som dekker e-posten. Saksbehandleren kan ikke lese kundens ønske mens hun fyller ut ordren, og må huske dato, klokkeslett og kaketekst.
11. **Statusmodellen er overbelastet.** Status (5 verdier), prioritet, `awaiting_internal`, `awaiting_external`, «venter på kunde» (utledet), SLA-nedtelling og «(standardfrist)» kan vises som opptil 7 badges samtidig i topplinjen. Det er ingen visuell rangering mellom «hva er sant» og «hva må jeg gjøre».
12. **Tidslinjen blander samtale og revisjonslogg.** Alle `ticket_events` er flettet kronologisk inn i tråden bak én av/på-bryter. På en sak med mange statusendringer drukner den faktiske e-postutvekslingen. Systemhendelser hører hjemme som kollapset gruppering eller egen fane, ikke som likestilte innslag.
13. **Detaljsiden har praktisk talt ingen feilhåndtering.** Kun `isLoading || !ticket` → spinner. En feilet `useTicket` gir evig «Laster henvendelse …». Sidefeltets spørringer (kunde, ordre, hendelser, vedlegg) har verken feil- eller tomtilstand — de forsvinner bare stille. Dette bryter med `QueryState`-mønsteret som innboksen faktisk bruker.
14. **Handlingsraden er en vegg av selects.** Fire nedtrekk (status, prioritet, ansvarlig, team) + «Ta selv» + primærknapp + «Flere handlinger» ligger i toppen med samme vekt. Videresending og eierskapsoverføring er samtidig gjemt bak et popover — de brukes oftere enn team-nedtrekket de konkurrerer med.
15. **Innboksens skala og ytelse er ikke løst i UI-et.** Alle åpne saker hentes komplett og filtreres/sorteres i klienten; arkivet kuttes ved 200 rader uten at brukeren får vite det, og søket treffer kun nedlastede rader. Søket er dessuten ikke debounced og har ingen indikasjon på at det bare dekker gjeldende kø. På sikt gir dette både treg liste og «saken finnes ikke»-opplevelser.

### Mindre funn (verdt å ta i samme runde)
- Ikoner er emoji (🛒 ✏️ 🚫 ⚠️ ❓ ✉️ 💸) i et ellers Lucide-basert designsystem — bryter NBHub-stilen og skalerer dårlig i mørk modus.
- Køene bruker `bg-[hsl(var(--brand-bronze))] text-white` med hardkodet `text-white` i tellerbadge, mot prosjektets token-regel.
- Lightbox mangler Escape-lukking, fokusfelle og `role="dialog"`.
- `AttachmentThumb` henter signert URL per vedlegg uten feil-visning; feiler den, vises en tom ramme.
- Tallet på tellerbadgen for «Uten ordre-kobling» ekskluderer `question`, men etiketten sier ikke det.
- Ulest markeres kun med oransje venstrekant på cream-bakgrunn — svak kontrast og ingen fet skrift.

## Forslag til målarkitektur

### 1. Trepanels arbeidsflate (erstatter liste → side-navigasjon)
```text
┌────────────┬──────────────────────────┬───────────────┐
│ Køer       │ Saksliste (virtuell)     │ Sak (peek)    │
│ Mine 12    │ [ ] Kiwi Teie   over frist│ Tråd          │
│ Uten ansv. │ [ ] Rema 1000   2t igjen  │ Composer      │
│ Over frist │ ...                       │ Kontekst      │
│ Alle åpne  │                           │               │
│ ─ filtre ─ │                           │               │
└────────────┴──────────────────────────┴───────────────┘
```
- Venstre reduseres til 4 faste køer + «Filtre»-panel (intensjon, team, prioritet, arkiv) som chips over listen.
- Midten får avkryssing, hover-handlinger og virtualisert liste; `?queue=` beholdes, `?ticket=` legges til så peek er delbar.
- Høyre er samme komponent som dagens detaljside — full side (`/ordre/ticket/:id`) beholdes for dyplenking og mobil.

### 2. Sakens indre struktur: én kolonne samtale, én kolonne beslutning
- Toppen: kundeidentitet først (navn + kundenr. eller tydelig «Ukjent avsender» med to knapper), deretter emne, deretter maks tre statusbadges (status, ventetilstand, frist).
- Beslutningskolonnen får fast rekkefølge: **Ordre → AI → Kunde-historikk → Detaljer**, der AI-kortet alltid oppgir grunnlag og usikkerhet.
- Systemhendelser flyttes ut av tråden til et kollapset «Historikk»-panel med antall.

### 3. Én ordre-beslutning, ikke fire knapper
Ordre-kortet stiller ett spørsmål når ingen ordre er koblet: *Gjelder dette en eksisterende ordre?*
- Ja → AI-kandidater øverst (med begrunnelse og konfidens), deretter søk.
- Nei → «Opprett ordre fra e-posten», som åpner en **sidepanel-ordre** (ikke fullskjerm-modal) slik at e-posten forblir synlig, med AI-forhåndsutfylte felt merket per felt.

### 4. AI som forslag, aldri som fakta
- Ett felles konfidens-språk: Høy / Middels / Lav med samme farge overalt, prosent kun som tooltip.
- Under lav konfidens vises intensjon som «AI foreslår: Endring (lav sikkerhet)» med «Bekreft / Endre».
- AI-utkast settes inn i et **eget forslagsfelt** over composeren med «Bruk», «Bruk og rediger», «Forkast» — aldri overskrive brukerens tekst.

### 5. Tastatur- og hastighetslag
`j/k` navigasjon, `Enter` åpne, `e` løs + hopp til neste, `a` tildel meg, `r` svar, `n` notat, `l` koble ordre, `Cmd/Ctrl+Enter` send, `?` hurtigtast-oversikt. Bulk: `x` velg, deretter samme handlinger på utvalget.

### 6. Tilstands-disiplin
Alle spørringer i detaljvisningen gjennom `QueryState`/`QueryErrorState` med avgrenset feilflate per kort (samme mønster som innboksens refusjons-KPI), tomtekster på norsk, skjelett i stedet for full-side spinner, og eksplisitt «Viser 200 nyeste — søk for eldre» der arkivet er kuttet.

### 7. Serverside-liste
Kø, filtre, søk og sortering flyttes til Supabase (paginert + `count`) med debounced søk, slik at innboksen skalerer og søket dekker hele arkivet, ikke bare det som er lastet ned.

## Foreslått rekkefølge om dette skal bygges
1. Tastatur + hover-handlinger + bulk i eksisterende liste (høy effekt, lav risiko).
2. Feil-/tom-tilstander i detaljvisningen.
3. AI-tillit og AI-utkast som ikke overskriver.
4. Split-view / peek-panel.
5. Kø-forenkling og ordre-beslutningsflyt.
6. Serverside-liste og virtualisering.
