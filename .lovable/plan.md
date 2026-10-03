# Read-only audit: hvorfor kjente varer gir nye oppgaver

Ingen kode, data, matching eller godkjenning er endret. Tallene gjelder fakturaer som ikke er avstemt (608 av 624). Del A er observert. Del B er forslag.

## A. Observerte fakta

### 1. Import og tolkning (ASKO 330702353)
- Fakturaene kommer fra Tripletex: 617 Tripletex og 7 PDF-opplastinger. Linjene finnes ikke som strukturerte data. `tripletex-import-invoice-lines/index.ts:146-194` laster ned PDF-en, og deretter tolker en AI-modell den (`extract-invoice-from-pdf/index.ts:23-49`). Alle 691 Tripletex-fakturaer mangler `ehf_payload`.
- Hvis AI-en ikke fyller ut pakningsfeltene, tolkes de fra varenavnet («36X90G»). Se `tripletex-import-invoice-lines/index.ts:170-179`.
- Lagrede verdier:
  - ALI: 1 eske × 541,03, linjesum 8 115,45. Pakningen er tolket som 36 × 90 g. Koblingen er manuell.
  - Oatly: 6 eske × 23,69, linjesum 1 279,26. Pakningen er 1 l, antall per eske er tomt. Koblingen er manuell.
- **Konklusjon:** Mengde og enhetspris kommer fra AI-ens tolkning av PDF-en, ikke fra kilden. Da regnestykket ikke går opp på noen av linjene, er minst ett av feltene feiltolket. Hvilket felt det er, kan ikke avgjøres uten PDF-en. PDF-en ligger lagret, men jeg har ikke åpnet den. Jeg har ikke rettet noe ut fra regnestykket.

### 2. Hvorfor kjente varer får nye oppgaver
Antall åpne linjer per årsak (en linje kan ha flere årsaker):
- `no_automatic_basis`: 305 linjer alene, og rundt 70 til sammen med andre årsaker. Dette er den største kilden.
  - Motoren godtar bare avtale eller startpris som grunnlag (`match-invoice-lines/index.ts:119`). Uten et slikt grunnlag får alle automatisk koblede linjer årsaken (`:226`, `:727`), også når prisen er innenfor toleransen.
  - 134 av disse linjene har sikker kobling og **bekreftet leverandørpakning**. Bare 20 av 370 leverandørkoblinger har avtalepris.
  - Dette er en bevisst regel, ikke usikkerhet om varen. I praksis gjelder den likevel «kjent vare, kjent pakning» som ble kjøpt for samme pris som sist.
- `unmatched`: 181 linjer. Dette er ekte usikkerhet.
- `unknown_package_size`: 140 manuelt koblede linjer pluss 48 sikre automatiske. Bare 6 av de manuelle har en bekreftet pakning hos leverandøren.
  - Bare 38 av 370 leverandørkoblinger har bekreftet pakning.
  - Når noen bekrefter en pakning på én linje, blir den altså sjelden lagret som varig leverandørkunnskap. Neste faktura spør derfor på nytt.
- Prisavvik (`price_variance`, `price_increase`, `price_drop`): omtrent 200 linjer. Disse er delvis ekte avvik. Feiltolkede mengder som ALI kan også gi falske avvik.
- `sku_collision` 5, `extraction_unresolved` 2 og `low_confidence` 2 er ekte usikkerhet.
- **Ikke-råvarer:** 243 linjer er merket som ikke-råvare. 16 varetekster er merket flere ganger på tvers av fakturaer, men det finnes bare 3 lagrede mønstre for å kjenne dem igjen.
  - Det å huske valget er frivillig (`NotARawMaterialDialog.tsx:44-53`). Mønsteret lagres ikke på samme sted som selve markeringen, og en feil ved lagring blir ikke sjekket.
  - Motoren leser mønstrene (`match-invoice-lines/index.ts:234`). Læringen virker altså bare når noen har valgt å huske.

### 3. «Fullfør» er kostprisføring, ikke økonomisk godkjenning
- `reconcile-invoice/index.ts` kaller `rm_reconcile_invoice`. Den sjekker tilgang, flagg, leverandør, at valutaen er NOK og status, og fører deretter prishistorikk per linje.
- Funksjonen inneholder ingenting om betaling, attestering eller Tripletex.
- **Alt eller ingenting:** Hvis én eneste linje er uavklart, stopper hele fakturaen. Det gjelder også linjer med `requires_review`, linjer uten råvare og linjer med ugyldig pris (se funksjonen og `validate.ts:76-123`). Linjer som allerede er sikre, får derfor ikke ført kostprisen sin før alle andre linjer er løst.
- Status for faktura og for kostpris er samme felt (`invoices.status`). Statusen settes av motoren (`match-invoice-lines/index.ts:771-784`), og avvik på fakturanivå setter hele fakturaen til «trenger gjennomgang».

## B. Forslag til løsning (ikke bygget)
1. **Rå kildedata:** Lagre AI-ens tolkning uendret, sammen med tillit per felt og henvisning til PDF-en. Når mengde × pris ikke gir linjesummen, blir det en egen sak om tolkning, ikke en pakningsoppgave. Vi retter aldri mengden automatisk.
2. **Varig kunnskap om leverandørvarer:** Lagre kunnskapen per leverandør og varenummer i de eksisterende leverandørkoblingene: råvare, pakningssignatur, hvem som bekreftet og når, og versjon. Når noen bekrefter en pakning, skrives den til koblingen, ikke bare til linjen. Avvik fra den bekreftede signaturen gjør at saken åpnes igjen.
3. **Automatisk gjenbruk:** Motoren gjenbruker bekreftet vare og pakning uten å spørre. For pris trengs en eksplisitt regel som brukeren godkjenner, for eksempel «forrige bekreftede kjøpspris er gyldig grunnlag innen toleransen». Uten en slik regel forblir `no_automatic_basis` den største kilden til oppgaver.
4. **Løs en sak én gang:** Grupper åpne problemer på leverandør, varenummer og årsak. Når én sak løses, gjelder løsningen bare linjer med samme grunnlag. Massekoblingen med forhåndsvisning og «snapshot/apply» finnes allerede og kan gjenbrukes. Det gjelder også ikke-råvarer: å huske valget blir standard, og mønsteret lagres sammen med markeringen.
5. **Egne statuser for faktura og kostpris:** Kostprisen føres per linje så snart linjen er sikker (delvis føring). Fakturastatusen sier bare om tolkningen er fullstendig og summene stemmer. Økonomisk godkjenning og attestering skjer fortsatt i Tripletex. Ingen innkjøps- eller mottaksmodul.

## Tekniske detaljer
- Krever databaseendring: en kolonne for versjon og signatur på leverandørkoblingen, og en funksjon for delvis føring per linje. Ingen nye tabeller uten egen godkjenning.
- Bør verifiseres før vi bygger: åpne ASKO-PDF-en for å finne hvilket felt som er feiltolket, og stikkprøve 10 linjer med bare `no_automatic_basis` for å bekrefte at prisen er stabil.
