## Mål
Få datablad-opplasting til å fungere. Rotårsak: edge-funksjonene er ikke deployet (Supabase returnerer 404 på OPTIONS for `extract-datasheet`), og klienten krasjer på `data.error` når `data` er `null`.

## Steg

1. **Deploy fire edge-funksjoner** til Supabase:
   - `extract-datasheet`
   - `match-datasheet-to-raw-material`
   - `apply-datasheet-update`
   - `suggest-raw-material-allergens`

2. **Robust invoke-feilhåndtering** i klient-koden — destrukturér `{ data, error }`, kast `error.message` først, deretter `data?.error`, ellers vis generisk melding. Unngår "Cannot read properties of null":
   - `src/ravarer/pages/DatabladBulk.tsx` (extract, match, apply)
   - `src/ravarer/components/tabs/DatasheetSection.tsx` (samme tre kall)

3. **Verifiser etter deploy**: be brukeren laste opp en testfil; les `extract-datasheet`-loggene for å bekrefte at AI-kallet fungerer og at matching returnerer kandidater. Hvis Gemini ikke takler PDF som `image_url`, håndteres det som egen oppfølging.
