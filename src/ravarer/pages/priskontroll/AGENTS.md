# Priskontroll
- Kronevirkning i arbeidslisten vises bare via `workEffect` (`src/ravarer/lib/workEffect.ts`): kun server-verifisert `effect_status` gir beløp, manglende felt = ukjent. Why: bruttobeløp fra feillest historikk ble vist som besparelse.
- Sumkontroll regnes som gjort bare for `SUM_CHECKED_STATUSES` (`ok`/`overridden`) i `invoiceSteps.ts`. Why: `not_checked`/`no_lines` ble tolket som kontrollert.
