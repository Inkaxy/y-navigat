# Plan: Ombygging av faktura-, råvare- og priskontrollflyten (demo C)

Planmodus. Ingen kode, SQL eller data endres i denne runden. Punkter merket «verifiseres» er ikke lest i live-databasen ennå, og de kontrolleres som første steg i fasen der de brukes.

## 1. Funksjonsgjennomgang (docs/ravarer-funksjonsmapping.json, 313 funksjoner i 36 områder)

| Område (antall) | Målbilde |
|---|---|
| Navigasjon, tilgang og felles (12) | Uendret. Topbar og NavBar røres ikke. |
| Fakturaer: I dag / Beslutninger / Råvarespørsmål (14) | Endres. Spørsmålene flyttes inn under linjen i fakturavisningen (bilde 02). Gamle URL-er videresendes. |
| Til behandling / innboks (13) | Endres. Blir fakturalisten med eldste først (fane=arbeid finnes i dag). |
| Linjeoppgave og MatchDrawer (18) | Beholdes som motor via `useLineMatchForm`/`acceptMatch`. Svarknappene i linjen åpner samme logikk. MatchDrawer forblir reserve for «flere valg». |
| Ny råvare (4) | Uendret dialog. Ny forhåndsvalgt variant: «opprett som emballasje». |
| Varekoblinger / varekort (14) | Uendret. Varekort-ruter består og lenkes fra linjene. |
| Fakturadetalj (15) | Endres. Blir høyre panel i bilde 02. Originalvisning, gjenlesing og «Rett fakturalinje» består. |
| Fakturaliste (4) | Endres i formen: venstre liste. Filtrene trenger/klar/avstemt/alle beholdes. |
| Godkjenning / Fakturaoversikt (5) | Beholdes uendret. Fakturaer godkjennes både i NBhub (priskontroll) og i Tripletex. |
| Leverandørsaker, flagg og kreditnota (5) | Beholdes. «Spør leverandøren» blir et vennlig utkast med `case_kind=price_inquiry`. Over avtale blir et kreditnotaforslag (`documented_claim`). |
| Import (3), Registrer linjer (1) | Uendret. Ligger under «Importer faktura». |
| Reberegn kostpriser (7) | Beholdes. Brukes i tillegg som motor bak «Rett pris», «Rett pakning» og forhåndsvisningen. |
| Vareminne-funksjoner (2) | Beholdes. «Bekreftet pakning brukes videre» blir en regel med bryter. |
| Innstillinger (18) | Beholdes. Bilde 06 legger regelsetninger ved siden av, og bryterne skriver til de samme `invoice_match_settings`. |
| Vareliste (23) | Uendret. Panelet utvides med «Brukes til» og «Alle priser». |
| Råvarekort, 5 områder (39) | Uendret. «Pris»-seksjonen får samme prishistorikk-liste som panelet. |
| Lager, Varemottak, Varetelling (27) | Uendret. Pant som følgevare må avstemmes mot varemottak (se risiko). |
| Pakninger (6) | Endres lett. Retting med «gjelder fra dato» og forhåndsvisning bygger på `rm_correct_raw_material_type_unit` og varianter. |
| Deklarasjonsnavn, Matvaretabellen, Koble Matvaretabellen, Datablad (33) | Uendret. |
| Leverandører, Leverandørkort, Avtaler (19) | Uendret. Avtalepris blir kilde til spørsmålet «over avtalepris». |
| Forhandlinger (23) | Uendret. |
| Kryssmodul-funksjoner (8) | Må virke. Lønnsomhet, priser og oppskrifter leses i fase c og d. |

**Kollisjoner og punkter som må avklares**
- **Godkjenning (besluttet 13.11.2026):** intern godkjenning i NBhub beholdes som selve priskontrollen; fanen og «Ferdig»-regelen (`nextInvoiceStep`) endres ikke.
- **Pant.** I dag kan pant havne under «Ikke råvare» eller `auto_exclude_line_kinds`. Kravet er at pant aldri utelates. Da trengs egen linjetype og egen kostpost.
- **«Ingenting låst etter godkjenning».** Dette kolliderer med dagens lås på linjer med aktiv `invoice_line_cost_postings`. Forslaget er at låsen består for vanlig ny matching, og at retting går gjennom en ny, eksplisitt og loggført vei som fører kost om fra en dato. Låsen fjernes ikke.
- **«Eldste først uten lås».** Det stemmer med dagens prisreferanse (forrige kjøp før fakturadato). Retting av en eldre pris kan likevel endre referansen for nyere, allerede godkjente linjer. Disse må få nytt spørsmål, ikke endres stille.
- **Påslag:** 1,2 prosent, justerbart per prisgruppe/prisliste og per handelsvare.

## 2. Kartlegging per skjermbilde

**01 Oversikt.** Gjenbruker `useWorkSummary`/`workRpc` (Trenger deg), `useMarginAlerts` (Under marginmålet) og prishistorikk (`priceHistoryFetch`). Nytt: telleren «Gjort uten deg siste døgn», som krever at automatiske handlinger kan telles (verifiseres om dagens revisjonslogg gir dette). Nytt: kroner per måned siste 12 måneder, som skal regnes på serveren.

**02 Fakturaer.** `FakturaArbeid` (fane=arbeid, `useFakturaListe`, `FakturaWorkspaceView`) er riktig grunnmur: én faktura om gangen, eldste først og fersk kvittering. Arbeidsbord/`rm_work_items` grupperer per varekort, mens bilde 02 er per fakturalinje. Arbeidsbordet beholdes som `visning=klassisk`/reserve. Den nye linjevisningen bygges inn i FakturaWorkspaceView. Hver linje får status «Automatisk» eller ett spørsmål, avledet fra eksisterende kilder: `useInvoicePriceSafety`, `lineInsight`/`lineReadIssues`, `rm_infer_package`, `rm_price_reference` og ekskluderinger. Svarknappene kaller dagens skriveveier: `acceptMatch`, `rm_set_invoice_exclusion`, `rm_correct_invoice_line`, `rm_supplier_claim_preview`, `supplier_case_queue_draft_to_henrik` og «Ny råvare». Nytt: «Neste: …», en sikkerhetsgrad med begrunnelse per linje, kronevirkning (bare via `workEffect`, server-verifisert) og regelen «alltid hopp over».

**03 Varer.** DataTable, filterkort og RawMaterialPeek gjenbrukes. «Brukes til» leser oppskriftsbruk og emballasjebruk, og bryteren «Selges videre» bruker dagens handelsvarebryter («Selges som»; kolonnen verifiseres). «Alle priser» gjenbruker `priceHistoryFetch`/`priceProvenance` (låste snapshot-felt). «Rett pris» per kjøp er nytt (se DB).

**04 Priser › Handelsvarer.** MatrixView (481 linjer) har rad × prisliste, celleredigering, ulagret-stripe og `set_prices`. Den kan gjenbrukes ved å gi den en ny rad-kilde (handelsvarer) og en celle-renderer med påslag og «Sperr». Visningen legges som fjerde valg i dagens visningsvelger (`view=handelsvarer`). Ny kode trengs for standardpåslag per prisliste, overstyring og sperre (lagres utenfor prislisten, se DB). Salgsprisen skrives bare via `set_prices` ved Lagre.

**05 Lønnsomhet.** `useProductMargins`/`product_margins`, `computeRecipeCost`, `profitability_sheet` og `price_rounds`/`price_round_lines`/`price_round_letters` gjenbrukes. Emballasje-linjer: `recipe_packaging_lines`/`product_package_items`/`product_cost` (antatt tomme, verifiseres). Nytt: «før → nå», «Må opp», «Hva om» og nedlastbar dokumentasjon av innsatsfaktorer.

**06 Innstillinger.** `TieredPriceSettings`/`invoice_match_settings` og `auto_exclude_line_kinds` (`useMatchTolerances`) gjenbrukes. Nytt: regler for «alltid hopp over» per leverandørvare, standard påslag og morgen-e-post.

## 3. Menyendringer

Topbar, SubAppNav/NavBar, ikoner og farger endres ikke. Eneste tillegg er nye `links` i dagens lister med samme NavItem-type:
- Varer › Priser-nedtrekket: «Handelsvarer» → `/varer/priser?view=handelsvarer` (legges også til i `matches`).
- Råvarer: ingen nye menyelementer. «Fakturaer», «Varer», «Oversikt» og «Innstillinger» finnes. Skal Godkjenning bort, gjøres det som egen beslutning.

## 4. Databaseendringer (forslag, alt som PENDING-SQL med check-fil)

1. **Rett pris på ett kjøp:** RPC `rm_correct_purchase_price(line_id, ny_pris, grunn, op_id, expected_updated_at)`. Den har forhåndsvisning med `dry_run` og fører kost om fra den datoen via `rm_apply_derived_cost_price`. Snapshot beholdes som revisjon og overskrives ikke.
2. **Pakning gjelder fra dato:** utvidelse av pakningsvariant med `valid_from`, og en RPC for forhåndsvisning og omregning.
3. **Hopp over alltid:** tabell `rm_line_skip_rules` (selskap, leverandør, item_key eller linjetype, opprettet_av) som `match-invoice-lines` leser.
4. **Pant:** linjetype `deposit` og kobling `deposit_parent_line_id` på fakturalinjen, holdt utenfor varekost og mva-fri. Verifiseres mot dagens linjetyper.
5. **Vennlig prisforespørsel:** ingen ny tabell, bare en ny tekstmal for `price_inquiry`. Verifiseres.
6. **Handelsvarer:** `price_list_markup_defaults` (prisliste, påslag, null = ingen påslag for «10 TILBUD» og «Utsalg») og `resale_price_overrides` (vare, prisliste, påslag eller sperret). Koblingen handelsvare → vare verifiseres mot dagens felt.
7. **Emballasje i kalkyle:** sannsynligvis ingen nye tabeller, men skriverett og RLS på `recipe_packaging_lines`/`product_package_items` verifiseres. Margin-RPC må utvides til å ta med emballasje.
8. **Prisgrunnlag:** RPC som returnerer innsatsfaktorer med endring i en periode, varer som rammes, og Brutto og DG2 før og nå.
9. **Oversikt:** RPC-er for «gjort automatisk siste døgn» og «kroner per måned».
10. **Oppdatert kø:** en planlagt jobb (pg_cron eller edge med cron-secret) som kjører `rm_rematch_invoices` på åpne fakturaer, eldste først, i begrensede bolker, pluss en trigger som kølegger når pris, pakning eller avtale endres.

Tabeller (3 og 6) foreslås bare. De opprettes ikke før Henrik sier ja.

## 5. Faseplan

Rekkefølgen følger ditt forslag, med to justeringer:
- **(0) Avklaring og lesing (ingen endring).** Live-definisjoner, tomme tabeller, handelsvarefelt og prisreferanse leses.
- **(a) Varer: prishistorikk og «Rett pris».** Starter med skrivebeskyttet «Alle priser» og avviksmerke, som kan tas i bruk uten databaseendring. «Rett pris» kommer i a2 etter pending-SQL 1.
- **(b) Fakturaer: linjevisning.** b1: spørsmål og «Automatisk» bygd på dagens skriveveier, med arbeidsbordet som reserve. b2: hopp over alltid (SQL 3). b3: pant (SQL 4). b4: vennlig forespørsel. Rett pakning i linjen bruker SQL 2.
- **(c) Handelsvarer.** Kan bygges parallelt med b, fordi den bare berører Varer-appen.
- **(d) Emballasje og Lønnsomhet/prisgrunnlag.** Venter på svar om Brutto/DG2.
- **(e) Oversikt, regler og automatisk kø.** Utfordring: den automatiske køen (SQL 10) bør komme tidlig i b. Ellers viser linjevisningen utdaterte forslag på gamle fakturaer.

Hver fase legges bak egen `visning`/`view`-parameter eller en ny fane, så dagens flyt står ved siden av til den er godkjent.

## 6. Risiko

- **Ytelse:** kronevirkning og margin per linje må regnes i bolker på serveren, i samme stil som `useInvoicePriceSafety`. Ikke ett kall per linje.
- **Tilgang:** alle svarknapper krever `has_ravarer_invoice_access(...,'write')`. «Rett pris» i etterkant bør kreve approve/admin. Handelsvarepåslag følger Varer-rettighetene for prisskriving.
- **Midt i arbeid:** kladder, ukjente utfall (kostreberegning, avtaler, mottak) og varetelling ligger i fanehukommelse. Ved utrulling består de gamle URL-ene, og ingen nøkler endres. Retting tilbake i tid kan endre margin og prisforslag mens noen har en ulagret prisrunde åpen. Prisrunden må derfor vise «grunnlaget er endret».
- **Kost:** retting fra dato skal aldri gjenta en bekreftet føring. Opp-id og delkvitteringer brukes som i dag.

## 7. Henriks beslutninger (13.11.2026)

1. Intern godkjenning i NBhub beholdes i tillegg til Tripletex. Fanen Godkjenning og «Ferdig»-regelen endres ikke. Databaseendring 11 er strøket.
2. Bare Henrik og de med godkjenningstilgang (approve/admin) kan rette en godkjent pris i ettertid.
3. Grensen for avviksmerket i historikken blir en justerbar innstilling (databaseendring senere). I a1 brukes dagens toleranse for varens kategori.
4. Retting av en eldre pris endrer bare det ene kjøpet. Nyere godkjente kjøp røres ikke og får ikke nytt spørsmål.
5. Standard påslag er 1,2 prosent, justerbart per prisgruppe/prisliste og per handelsvare.
6. «Siden» står som standard 12 måneder tilbake, uten nedre grense.

## Status
- Fase 0 og a1 (bare lesing) er bygget. a2 («Rett pris») venter på godkjenning av databaseendring 1.

EHF, EPD og antall emballasje per vare planlegges, men bygges ikke.
