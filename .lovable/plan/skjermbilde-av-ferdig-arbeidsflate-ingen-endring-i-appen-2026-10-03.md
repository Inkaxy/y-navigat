# Skjermbilde av ferdig arbeidsflate (ingen endring i appen)

## Resultat av lesekontrollen
- Forhåndsvisningen kjører. Forsiden svarer normalt og viser innloggingssiden i nettleseren.
- Det finnes ingen bygge- eller kjørefeil i loggene. Den eneste gamle feilen (manglende fakturaoverskrift) er løst.
- Konsollen viser bare kjente utviklingsadvarsler («Function components cannot be given refs»). De gjør ikke skjermen blank.
- Konklusjon: den hvite rammen sitter i Lovable-editoren, ikke i appen. Det trengs ingen omstart av serveren. Prøv å lukke og åpne prosjektfanen igjen, eller bruk den direkte forhåndsvisningslenken.

## Forslag hvis du godkjenner
Den innloggede siden kan ikke åpnes av meg, fordi innloggingen er ekstern. For å gi deg et faktisk skjermbilde:
1. Oppdatere bare utviklingstestsiden (ikke en del av appen) slik at ALI-linjen bruker en råvare i stk, akkurat som i ekte data. Ingen databasekall, ingen lagring.
2. Ta skjermbilder på 1440 px og 390 px av:
   - ALI-pakning: «Hvor mange stk inneholder én eske?», 36 stk, regnestykket.
   - Ugyldig antall (sperret knapp med forklaring).
   - Prisavvik med «Kontroller pakningen», «Endre råvare» og «Rett avtalepris».
3. Legge bildene i Filer slik at du kan vise dem til brukeren.

## Teknisk
- Kun `src/dev/InvoiceTaskPreview.tsx` endres (fast eksempeldata). Den bygges ikke inn i appen.
- Ingen endring av innlogging, regler, data eller publisering.
