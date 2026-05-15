## Funn

Jeg fant tre sannsynlige årsaker til at du ikke ser forskjell:

1. **Stripene starter på nytt for hver hovedvaregruppe**
   - I både `ProductionPlanTable` og `CorrectionPlanTable` beregnes zebra slik:
     - finn siste hovedgruppe-start
     - sett rad 1 i hver gruppe til hvit
     - sett rad 2 i samme gruppe til grå
   - Hvis mange hovedgrupper har én linje, eller gruppene ofte starter på nytt, blir nesten alle linjer hvite.
   - Dette forklarer hvorfor det ikke synes i displayet.

2. **Utskrift bruker samme `data-zebra`-verdi**
   - Print-CSS farger bare rader med `data-zebra="1"`.
   - Når mange/alle produktlinjer får `data-zebra="0"`, blir også utskriften hvit.

3. **Print-valget “Grå bakgrunn på annenhver linje” er ikke koblet til selve utskriften**
   - Valget finnes i dialogen (`alternateRowGray`), men det sendes ikke videre til tabellen/CSS.
   - Det betyr at innstillingen ikke faktisk styrer om radstriping brukes.

## Plan

1. **Endre zebra-beregningen**
   - Bruk produktlinjens faktiske indeks direkte: `idx % 2`.
   - Ikke restart stripingen per hovedvaregruppe.
   - Gruppeoverskrifter i print skal ikke telles som produktlinjer.

2. **Gjør skjermvisningen tydelig**
   - Behold cellenivå-farging på `td`, siden det overstyrer tabellens `bg-card`.
   - Sett radene eksplisitt til:
     - hvit for `data-zebra="0"`
     - tydelig lysegrå for `data-zebra="1"`

3. **Gjør utskrift tydelig**
   - Overstyr print-regelen som setter alle celler til transparent.
   - Legg inn begge print-regler etter standard print-cellene:
     - `data-zebra="0"` = hvit
     - `data-zebra="1"` = lysegrå
   - Bruk `print-color-adjust: exact` videre.

4. **Koble utskriftsvalget riktig**
   - La “Grå bakgrunn på annenhver linje” faktisk styre om striping skal være aktiv i print.
   - Skjermvisningen kan fortsatt alltid vise zebra-striping, siden det er ønsket i displayet.

## Resultat

Etter implementering vil annenhver produktlinje være konsekvent hvit/lysegrå på tvers av hele produksjonslisten, både i display og utskrift — uavhengig av hovedvaregruppe.