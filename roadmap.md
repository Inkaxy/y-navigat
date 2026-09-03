# Roadmap — Ordre-modulen

## Leveranse 1 (pågår)
- [x] Arbeidsbord på `/ordre/dashbord` (KPI-er + prioriterte arbeidskøer)
- [x] `useOrderDeskBoard` + `OrderDeskKpi`, `WorkQueueCard`, `DeskSectionState`
- [x] Omdøp dashbord-widget til `TicketsInboxWidget`, semantiske lenkerader, trygge feilmeldinger
- [x] Lettere ticket-queries (eksplisitte kolonner, færre nettverkskall i `useTicketCounts`)
- [x] Feiltilstander med «Prøv igjen»: dashbord, innboks, ordreliste, kundeordre, leveringskalender
- [x] Leveringskalender: full bredde, responsiv førstekolonne, sticky kompakt toppbar
- [x] Navigasjon: «Innboks», bakoverkompatibel `/ordre/avvik`

## Leveranse 2 (ikke startet)
- E-post/ticket-hardening: `/users/{mailbox}` overalt, deterministisk tokenvalg, idempotens-indeks,
  trådmatching på `internet_message_id`, sanitization/quoted text, optimistisk lås, AI-forslagslivssyklus

## Leveranse 3 (ikke startet)
- Del opp `Leveringskalender.tsx`, virtualisering, én dato-hjelper
- Ny kundeordre-arbeidsflate + transaksjonell ordre-RPC
