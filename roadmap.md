# Roadmap — Ordre-modulen

## Leveranse 1 (pågår)
- [x] Arbeidsbord på `/ordre/dashbord` (KPI-er + prioriterte arbeidskøer)
- [x] `useOrderDeskBoard` + `OrderDeskKpi`, `WorkQueueCard`, `DeskSectionState`
- [x] Omdøp dashbord-widget til `TicketsInboxWidget`, semantiske lenkerader, trygge feilmeldinger
- [x] Lettere ticket-queries (eksplisitte kolonner, færre nettverkskall i `useTicketCounts`)
- [x] Feiltilstander med «Prøv igjen»: dashbord og innboks-widget
- [ ] Feiltilstander: ordreliste, kundeordre, leveringskalender (Leveranse 2)
- [x] Leveringskalender: full bredde (full-bleed shell) + responsiv førstekolonne
- [x] Navigasjon: «Innboks» i submeny, fjernet død `/ordre/avvik`-placeholder

## Leveranse 2 (ikke startet)
- E-post/ticket-hardening: `/users/{mailbox}` overalt, deterministisk tokenvalg, idempotens-indeks,
  trådmatching på `internet_message_id`, sanitization/quoted text, optimistisk lås, AI-forslagslivssyklus

## Leveranse 3 (ikke startet)
- Del opp `Leveringskalender.tsx`, virtualisering, én dato-hjelper
- Ny kundeordre-arbeidsflate + transaksjonell ordre-RPC
