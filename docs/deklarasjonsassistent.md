# Deklarasjonsassistent

Hjelp til skrivemåte og kontrollpunkter i ingredienslister i Varer.
Assistenten **lagrer ikke**, **godkjenner ikke** og **er ingen garanti for at en etikett er lovlig**.
Den foreslår, mennesket bestemmer.

## Hvor finner jeg den?

- Oppsett: **Varer → Innstillinger → Deklarasjonsassistent** (`/varer/innstillinger/deklarasjonsassistent`).
  Bare plattformadministrator ser og kan endre oppsettet.
- Bruk: under feltet for manuell ingrediensdeklarasjon på en **oppskrift** og på en **vare**.

## Sette den opp

1. Lag en API-nøkkel hos OpenAI (platform.openai.com).
2. Lim den inn i feltet «OpenAI API-nøkkel» og lagre. Nøkkelen lagres kryptert på serveren
   og vises aldri igjen — heller ikke for administrator.
3. Velg modell og en daglig grense for antall kontroller.

Merk:

- Bruk av API-en faktureres av OpenAI og er noe helt annet enn et ChatGPT-abonnement.
- Nøkkelen i seg selv kan brukes til hva som helst hos OpenAI. Det er NBhub-serveren som
  låser den til deklarasjonskontroll — endepunkt, modell og instruksjoner er faste,
  og klienten kan ikke sende egen prompt, egen modell eller egen adresse.
- Serveren må ha `AI_CONFIG_ENCRYPTION_KEY`. Mangler den, sier oppsettssiden fra og
  assistenten holdes avslått i stedet for å lagre nøkkelen usikkert.
- Lar du nøkkelfeltet stå tomt når du lagrer, beholdes nøkkelen som allerede virker.
  Et mislykket bytte ødelegger heller ikke det som virker — byttet skjer i én operasjon.
- Fakturatolkingen i Råvarer har sitt eget oppsett og påvirkes ikke.

## Slik virker den

1. **Alltid, uten AI:** en regelstyrt motor viser hvordan teksten ser ut i NBhubs standardform
   (kjente ingrediensord i små bokstaver, allergenordet i fet skrift) og lister kontrollpunkter.
   Knappen «Bruk standardformat» bruker bare denne, og virker også når AI er avslått.
2. **«Kontroller med AI»:** teksten sendes til et fast serverendepunkt som selv henter
   allergendata fra råvarene. Modellen får bare levere avgrensede forslag med nøyaktig
   kildeposisjon.
3. **Deterministisk kontroll:** serveren kontrollerer hvert forslag uten AI. Endring av
   ingredienser, rekkefølge, tall, prosent eller E-numre avvises alltid. Alt som ikke er en
   tillatt skrivemåtejustering blir gjort om til et åpent spørsmål.
4. **«Bruk forslag»** legger resultatet inn i det **ulagrede** utkastet. Er teksten endret
   etter kontrollen, blokkeres knappen til kontrollen kjøres på nytt.

## Faste regler modellen ikke kan overstyre

- Ingen ingredienser legges til eller fjernes, ingen rekkefølge endres.
- Tall, mengder, prosent og E-numre er låst.
- Næringsinnhold regnes eller endres aldri.
- Kilde til E322, stivelse, gluten og nøtter blir aldri diktet opp — ukjent kilde forblir et spørsmål.
- «Kan inneholde spor av» legges aldri til av modellen.
- Lagrede allergendata erstattes ikke; avvik meldes som funn.
- Stilnotater fra administrator ligger alltid under disse reglene.

## Faglig grunnlag (kontrollert 13.09.2026)

- Mattilsynet: «Slik skal allergenene merkes» — forordning (EU) 1169/2011 art. 21 og vedlegg II.
- Kommisjonens kunngjøring 2017/C 428/01, pkt. 9 og 17.
- Mattilsynet: «Merkingens utførelse og plassering» — skriftstørrelse måles som x-høyde,
  ikke i punkt. Systemet påstår derfor aldri at en gitt punktstørrelse er i orden.

## Referansesett

`src/varer/lib/__fixtures__/declarationCases.ts` inneholder fasiteksemplene
(store bokstaver, mengder og E-numre, «mel»/«nøtter»/E322, spelt, melkesyre/kokosmelk,
raffinert soyaolje, gjentatte allergener, sulfitt, idempotens).
Endres instruksjonsversjonen, skal disse fortsatt gi samme deterministiske resultat.

## Hva assistenten IKKE avgjør (herdet 2026-09)

- **Malt, maltekstrakt og semule** får aldri antatt kornslag. De blir et åpent spørsmål.
  Navngitt korn («byggmalt», «durumsemule») gjenkjennes fortsatt.
- **Spelt/durum** utløser bare hvete-påminnelsen når hveten hører til samme ingrediens.
- **Helraffinert soyaolje og sulfitt under grenseverdi** er unntak som må bekreftes faglig.
  Uten bekreftet grunnlag sperres automatisk innsetting — verken formatering eller AI
  kan avgjøre dem.
- **Helt fet ingrediensliste** regnes ikke som gyldig allergenutheving.
- Modellens eget «bekreftet»-stempel gjelder ikke. Et funn står som bekreftet bare når både
  koden og begrunnelsen gjenfinnes i de registrerte råvaredataene serveren faktisk hentet.
  Råvaredata som ikke er gjennomgått, merkes som nettopp det.

## Test tilkobling

Knappen «Test tilkobling» på innstillingssiden sender **én liten, oppdiktet ingrediensliste**
gjennom samme endepunkt, modell og kontroll som en vanlig kjøring. Ingen data om varer,
oppskrifter eller kunder sendes. Det er et ekte, betalt kall på egen nøkkel, og det teller på
dagens grense. «Nøkkel lagret» og «Test bestått» er to forskjellige ting — statusfeltet skiller
dem.

## Grenser og kvote

- Dagens teller følger **Europa/Oslo-døgn**, ikke UTC.
- Daglig grense er 1–500 og kontrolleres på serveren.
- Lagring av nøkkel, modell, grense og husregler skjer i én låst operasjon per bruksområde.
  Feiler noe, står hele det forrige oppsettet urørt.

## Kjente begrensninger

- `ai_usage_log` har ingen kolonne for instruksjonsversjon. Versjonen logges derfor i
  serverloggen og vises på innstillingssiden, ikke i bruksloggen.
- Ingen betalte kall er kjørt i utviklingen. Alt er verifisert med enhetstester og
  etterlignede svar; den faktiske modellkvaliteten er ikke målt.
- Assistenten er ingen juridisk kontroll av etiketten.
