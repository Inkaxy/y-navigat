## Mål

Gjøre Leveringsregler-modulen mer brukervennlig og omfattende, basert på vedlagte skjermbilder. Reglene skal håndheves (kunder/operatører kan ikke bryte dem) og kunne fjernes helt — ikke bare deaktiveres.

## Fem regeltyper

| Type | Definerer | Bruk |
|---|---|---|
| `order_deadline` | Antall dager + klokkeslett før leveranse | Ordrefrist (eksisterer) |
| `delivery_weekdays` | Hvilke ukedager leveranse er tillatt | Sperrer datoer på andre ukedager |
| `available_tours` | Hvilke turer som er tilgjengelige | Begrenser turvalg |
| `available_products` | Hvilke varer/salgsgrupper som kan bestilles | Skjuler/sperrer varer |
| `no_delivery` | Stengt fra/til-dato | Total leveransestopp i periode |

Alle typene kan filtreres på (valgfritt): kundegruppe, kunder, ukedager, turer, spesiell leveransedato, salgsgruppe, varer — samt gyldighetsperiode.

## UI

**Skjema (`DeliveryRuleFormDialog`)**

Bytt fra ett-typers skjema til typevelger-kort øverst (slik mockup viser): 5 knapper i en vertikal liste, aktivt valg markert med grønn ramme. Under typevelgeren vises kun feltene som hører til valgt type:

- `order_deadline` → «Antall dager før leveranse» + «før klokken HH:MM»
- `delivery_weekdays` → ukedag-checkboxer (man–søn)
- `available_tours` → turliste-checkboxer
- `available_products` → salgsgruppe-velger + vare-velger
- `no_delivery` → fra/til-dato + gul info-boks «Dette er kun en regel for å stoppe registrering av nye ordre…»

Felles seksjoner under (alle typer):
- «Hvem gjelder regelen for (valgfritt)» — kundegruppe, kunder
- «Tidspunkt (valgfritt)» — ukedager, turer, én spesifikk leveransedato (skjules for `delivery_weekdays`/`available_tours`/`no_delivery` der det er redundant)
- «Varer (valgfritt)» — salgsgruppe, varer (skjules for `available_products`)
- «Navn og gyldighet» — navn, gyldig fra/til
- Sidepanel «Regelen i ord» som oppsummerer regelen i klartekst live

**Listevisning (`DeliveryRules.tsx`)**
- Vis alle regeltyper (ikke disabled select)
- Egen badge-farge per type
- Definerer-kolonne formatert per type
- Sletteknapp utfører hard delete (DELETE) etter bekreftelse — ikke soft delete. Beholder også «deaktiver»-toggle som egen handling.

## Håndheving (blokkerende)

Ny modul `src/ordre/lib/deliveryRuleEnforcement.ts` med funksjon
```ts
enforceRules(input, rules): { blocked: boolean; violations: Violation[] }
```
som returnerer harde brudd (rød) per regeltype.

Integreres i:
- `NewOrder.tsx`: hindrer lagring når `blocked = true`, viser feilmelding per brudd
- `CustomerOrderModal.tsx`: blokkerer «Lagre» + sperrer ukedager/turer/varer i UI når de bryter regler
- `Leveringskalender.tsx`: viser stengte dager fra `no_delivery`

Reglene leses fortsatt via `useOrderRulesContext` som utvides til å returnere alle aktive regler (ikke bare `order_deadline`).

## Database

Migrasjon:
1. Behold `rule_type TEXT` (allerede tekst) — bare nye verdier
2. Gjør `deadline_time`/`deadline_days_before` NULLABLE (kun relevant for `order_deadline`)
3. Legg til nullable kolonner:
   - `blackout_from DATE`, `blackout_until DATE` (for `no_delivery`)
   - `specific_delivery_date DATE` (felles tidspunkt-filter)
   - `customer_group_ids UUID[]`, `product_group_ids UUID[]` (sales group + customer group)
4. CHECK-trigger som validerer at riktige felter er satt per `rule_type`

RLS er allerede på plass — ingen endring der.

## Tekniske detaljer

- Type `DeliveryRuleType` utvides i `useDeliveryRules.ts`
- `formatRuleDefinition(rule)` erstatter `formatDeadlineDefinition` og dekker alle 5 typer
- Sidepanelet bruker en `describeRule(rule, lookups)` helper

## Filer som endres/opprettes

- `supabase/migrations/<ny>.sql` (skjema-utvidelse)
- `src/ordre/hooks/useDeliveryRules.ts` (typer + filtre)
- `src/ordre/hooks/useOrderRulesContext.ts` (returner alle typer)
- `src/ordre/lib/orderRules.ts` (utvid for nye typer)
- `src/ordre/lib/deliveryRuleEnforcement.ts` (ny — blokkerende sjekk)
- `src/ordre/components/orders/DeliveryRuleFormDialog.tsx` (full redesign)
- `src/ordre/pages/DeliveryRules.tsx` (badges + hard delete)
- `src/ordre/pages/NewOrder.tsx` + `src/ordre/components/orders/CustomerOrderModal.tsx` (håndhev brudd)

## Spørsmål før jeg starter

1. Skal **hard sletting** være tilgjengelig, eller kun «deaktiver»? (Mockup viser at de skal kunne fjernes — jeg antar hard delete med bekreftelsesdialog.)
2. Skal håndhevingen være **absolutt blokkerende** også for interne operatører i NewOrder, eller kun for kundeportalen — der operatører får en overstyringsmulighet?
3. Trenger vi virkelig alle 5 typene nå, eller skal jeg starte med de mest kritiske (`no_delivery` + `delivery_weekdays`) og legge til resten etterpå?
