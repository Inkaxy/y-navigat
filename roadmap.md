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
- [x] Tester: `src/test/queryState.test.tsx` + `orderDesk.test.ts` (94 tester grønne)

## Leveranse 2 (klar til start)
- E-post/ticket-hardening: `/users/{mailbox}` overalt, deterministisk tokenvalg, idempotens-indeks,
  trådmatching på `internet_message_id`, sanitization/quoted text, optimistisk lås, AI-forslagslivssyklus
- Ta i bruk `QueryState` på resten av Ordre-flatene (kundeordre, turer, pakksedler, kakebilder)

## Leveranse 3 (ikke startet)
- Del opp `Leveringskalender.tsx`, virtualisering, én dato-hjelper
- Ny kundeordre-arbeidsflate + transaksjonell ordre-RPC
