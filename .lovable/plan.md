Jeg fant sannsynlig hovedfeil: koden henter «siste snapshot» før den lagrer nytt snapshot, men den henter uten å filtrere på samme utskriftskriterier. Det betyr at korreksjonslisten kan sammenligne mot en snapshot fra annen mal/tur/kriterier, og fordi snapshot-items bare lagres på `product_id`, blir grunnlaget feil for aggregerte produksjonsgrupper. I tillegg skjules print-DOM-en med `hidden print:block`, som kan være ustabilt sammen med global print-CSS og browserens print-capture.

Plan:

1. Stramme inn snapshot-oppslag
   - Endre `fetchLatestSnapshotItems` til å finne forrige snapshot for samme dato, selskap, liste-type og relevante kriterier.
   - Matche på `criteria_copy`/turer slik at en utskrift ikke bruker snapshot fra en annen filtrering som sammenligningsgrunnlag.

2. Gjøre snapshot-nøkkel lik tabellrad-nøkkel
   - Slutte å lagre/sammenligne kun per `product_id` når produksjonsplanen kan være aggregert per produksjonsgruppe/hovedgruppe.
   - Bruke en stabil `row_key` basert på valgt aggregering og tur/summering, slik at korreksjon sammenligner nøyaktig samme type rad som vises i utskriften.
   - Dette krever en liten databaseendring: legge til `row_key` på `production_plan_snapshot_items` og indeks for `snapshot_id + row_key`.

3. Gjøre utskrift av korreksjon deterministisk
   - Lage print-jobben med eksplisitte sider: normale kopier + eventuell korreksjonsside.
   - Sørge for at korreksjonssiden alltid er i DOM før `window.print()` åpnes, uten å stole på `hidden print:block` alene.
   - Beholde dagens toast, men gjøre meldingen tydelig hvis forrige snapshot finnes, mangler eller ikke matcher kriteriene.

4. Kontrollere med ekte data
   - Verifisere at nylige snapshots faktisk lagres med varer.
   - Teste logikken mot dagens lagrede snapshots: første utskrift gir bare produksjonsliste, andre utskrift med endring gir ekstra korreksjonsside med +/-.

Teknisk berørte filer:
- `src/produksjon/features/produksjonsplan/hooks/useProductionPlanSnapshots.ts`
- `src/produksjon/pages/ProduksjonsplanPage.tsx`
- `src/produksjon/features/produksjonsplan/components/CorrectionPlanTable.tsx`
- Supabase-migration for `production_plan_snapshot_items.row_key`