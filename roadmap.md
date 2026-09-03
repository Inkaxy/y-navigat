# Roadmap — Ordre-modulen

## Leveranse 1 (ferdig)
- [x] Arbeidsbord på `/ordre/dashbord` (KPI-er + prioriterte arbeidskøer)
- [x] `useOrderDeskBoard` + `OrderDeskKpi`, `WorkQueueCard`, `DeskSectionState`
- [x] Omdøp dashbord-widget til `TicketsInboxWidget`, semantiske lenkerader, trygge feilmeldinger
- [x] Lettere ticket-queries (eksplisitte kolonner, færre nettverkskall i `useTicketCounts`)
- [x] Felles `QueryState` (`src/components/common/QueryState.tsx`) med feil-ID, «Prøv igjen»,
      skjelett og tomtilstand — feil vinner alltid over «ingen treff»
- [x] Feiltilstander med «Prøv igjen»: dashbord, innboks-widget, innboks-side, ordreliste
      (desktop + mobil) og leveringskalender-matrisen
- [x] Innboks-side: ekte lenkerader (tastatur, midtklikk, «åpne i ny fane») i stedet for
      `div role="button"`; KPI-er viser «–» når datasettet feilet
- [x] Deterministisk aggregering: `useStatusCounts` og `useDeliveryDayStats` paginerer via
      `fetchAllRows`; `useActionQueueCounts` bruker eksakte count-spørringer
- [x] Leveringskalender: full bredde (full-bleed shell) + responsiv førstekolonne
- [x] Navigasjon: «Innboks» i submeny, fjernet død `/ordre/avvik`-placeholder

## Leveranse 1 — kvalitetssikring (ferdig)
- [x] `/ordre/avvik` gjenopprettet som redirect til `/ordre/dashbord?focus=avvik`; dashbordet
      viser `DeskFocusNotice` med veier videre (godkjenningskø, innboks, uten tur)
- [x] `OrderDeskHeader`: norsk dato + «sist oppdatert» fra `dataUpdatedAt` og egen Oppdater-knapp
      (formattere isolert i `src/ordre/lib/deskHeaderFormat.ts`); AppBanner beholder «Ny ordre»
- [x] Feillogging flyttet ut av render (`QueryState`/`DeskSectionState` logger i `useEffect`,
      stabil feil-ID per unik feil, faktisk error-objekt) — dekket av
      `src/test/deskSectionState.test.tsx` og `src/test/queryState.test.tsx`
- [x] Eksplisitte feilflater i `TicketsInbox` (inkl. refusjoner), `OrdersList`, `CustomerOrders`,
      `CustomerOrdersTab` og `Leveringskalender`
- [x] Arbeidskøer delt i navngitte grupper («Ordre til godkjenning» / «E-post som krever handling»)
      med egne lenker; `AutomationRunsCard` med ekte fastordre-, nettbutikk- og pakkseddeldata
- [x] KPI «Ansvar e-post» viser både «Mine» og «Uten ansvarlig»
- [x] Leveringskalender: sticky verktøylinje (verifisert på 1440/1280/390), felles
      `FIRST_COL_WIDTH` (240 / 280 lg / 320 xl) og én horisontal scroll-container rundt matrisen
- [x] Manglende designtokens lagt til i `tailwind.config.ts` (`text-caption/body/title`, `px-page`)
      — var brukt ~110 steder uten definisjon
- [x] Responsivt: `min-w-0` på kortene (ingen horisontal overflow på 390px), KPI-rad 4 kolonner
      fra `lg` og 8 fra `2xl`, innboksens køliste i to kolonner på mobil, avsender + tidspunkt
      på egen linje i ticket-radene når metadatakolonnen skjules
- [x] Kvalitet: ubrukte typer (`DeskSection<T>`) fjernet, `refetchAll` avhenger av eksplisitte
      refetch-funksjoner, `TicketsInboxWidget` med stretched-link uten nøstet interaktiv HTML,
      109 tester grønne, lint rent på berørte filer, typecheck + build OK


## Leveranse 2 (klar til start)
- E-post/ticket-hardening: `/users/{mailbox}` overalt, deterministisk tokenvalg, idempotens-indeks,
  trådmatching på `internet_message_id`, sanitization/quoted text, optimistisk lås, AI-forslagslivssyklus
- Ta i bruk `QueryState` på resten av Ordre-flatene (kundeordre, turer, pakksedler, kakebilder)
- Fjern gjenstående `text-*`-hardkoding som nå kan bruke de nye typografitokenene


## Leveranse 3 (ikke startet)
- Del opp `Leveringskalender.tsx`, virtualisering, én dato-hjelper
- Ny kundeordre-arbeidsflate + transaksjonell ordre-RPC
