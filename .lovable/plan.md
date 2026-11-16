# Plan: Variant B – «beslutninger, ikke fakturaer» (16.11.2026)

Erstatter demo C (arkivert i `.lovable/plan/demo-c-2026-11-13.md`). Henrik vil ha hele variant B, fase for fase, uten stopp for spørsmål. Antakelser skrives i rapporten.

## Målbilde
Hovedflaten i Råvarer er en kø av beslutninger. Systemet gjør alt det er sikkert på; resten samles til ett spørsmål per sak (vare/leverandør), og ett svar løser alle linjer og fakturaer med samme vare. Fakturaer blir arkiv og bevis.

## Plassering (besluttet)
- Topbar og SubAppNav/NavBar beholder dagens design og komponenter. Nye innganger er nye elementer i dagens lister.
- Råvarer: «Beslutninger» (teller, foran Varer), «Prislinje», «Automatikk». Oversikt, Varer, Fakturaer, Leverandører, Lager og Innstillinger (tannhjul) består.
- Varer-appen: «Handelsvarer» som ny visning under Priser (ved siden av Tabell/Enkel/Retur, lenke i Priser-nedtrekket) og «Prisgrunnlag» under Lønnsomhet. Innpris kommer fra Råvarer og kan ikke endres i Varer.
- Dagens designsystem og felleskomponenter, ingen nye farger. Ingen funksjon fjernes (`docs/ravarer-funksjonsmapping.json` er fasit). Dagens Fakturaer-flate består.

## Beslutninger fra Henrik
- Eldste først er ren sortering; ingenting låses bak eldre fakturaer («Venter bak denne» brukes ikke).
- Fakturaer godkjennes i NBhub og Tripletex; Godkjenning-fanen og «Ferdig»-regelen endres ikke.
- «Spør leverandøren»: vennlig forespørsel, utkast til Henrik, aldri automatisk til leverandør.
- Pant er følgevare: følger varen, utenfor kost, mva-fri, aldri utelatt.
- Paller, miljøvederlag, frakt og gebyr kan hoppes over, én gang eller alltid.
- Feil forslag til pris per kg/pakning rettes der spørsmålet stilles, med forhåndsvisning.
- Ingenting låst etter godkjenning: pris på ett kjøp og pakning kan rettes i ettertid av approve/admin; bare det ene kjøpet endres; loggføres.
- Avviksgrense i prishistorikken er justerbar; «siden» = 12 måneder som standard.
- Innkjøpsvare kan brukes i oppskrift, emballasje og videresalg; kostpris i oppskrift/kalkyle, påslag bare ved videresalg.
- Påslag 1,2 som standard per prisgruppe, justerbart per prisliste og handelsvare; sperre per prisliste; ingen påslag i «10 TILBUD» og «Utsalg»; ny innpris gir forslag, prisliste endres først ved lagring.
- Margin vises alltid som Brutto og DG2. Emballasje i kalkyle teller i begge (innstilling, standard på).
- EHF og EPD bygges ikke.

## Faser
0. Haster: sidelesing av lange fakturaer (Drammen Papir 9041438168) lagres alltid; aldri «ingen lesbare linjer» når sider ble lest; mange sider leses side for side direkte.
1. Beslutninger (B1) i Råvarer med alle spørsmålstyper: pris, over avtale (kreditnotaforslag), ukjent vare, pakning, sjekk pakning, pant, ikke en vare/hopp over, videresalg, emballasje, kan ikke leses, råvare ikke klar.
2. Prislinje (B4) med «Alle priser» (fase a1), «Rett pris» per kjøp og «Endre godkjent pakning».
3. Automatikk (B7): regelsetninger med bryter, logg over det som er gjort uten bruker, grenser for nøkkelråvarer, hopp-over-regler, pant som følgevare, automatisk oppdatering av køen, forhåndsvisning av morgen-e-post.
4. Handelsvarer (B5) i Varer-appen.
5. Prisgrunnlag (B6) med emballasje i kalkyle i Varer-appen.
6. Fakturaer som arkiv med lesekilde og lesekvalitet per leverandør; ny Oversikt som peker til Beslutninger.

## Tekniske rammer
- Beslutninger bygger på `rm_work_items` (sortering `oldest` = eldste åpne fakturadato) og dagens skriveveier via eksisterende paneler (VarekortPanel/FakturasakPanel: acceptMatch, rm_supplier_item_accept_price, rm_set_invoice_exclusion, rm_correct_invoice_line, saksutkast). Spørsmålstype avledes i ren klientlogikk til en PENDING-funksjon gir servertypen.
- Databaseendringer: én PENDING-SQL + check-fil per fase i `supabase/pending/`, md5-bundet til live-definisjon når eksisterende funksjoner endres. Root kjører mellom rundene. Koden virker som før uten SQL-en; nye flater viser hva som venter.
- Ingen gjenlesing/rematch/jobber, ingen nøkler eller AI-oppsett, ingen publisering. Tester for all ren logikk per fase.
