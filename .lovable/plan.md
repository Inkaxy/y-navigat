
# Én regel = frist + produksjonsdag

## Målbilde
I dag må operatøren lage **to regler** for scenariet «Herregårdsbrød bakes onsdag, må bestilles 4 dager før kl 14»:
1. `available_products` (bare onsdag)
2. `order_deadline` (4 dager før, 14:00)

Etter endringen holder det med **én** `order_deadline`-regel som også har ukedager huket av — motoren tolker det da som «gjelder disse ukedagene *og* blokkerer alle andre».

Ingen datamigrering: eksisterende regler oppfører seg akkurat som før (ny bryter er `false` som default).

## Endringer

### 1. DB — én ny kolonne + oppdatert motor
`delivery_rules.enforce_weekdays boolean not null default false`

Utvid `evaluate_delivery_rules` (Postgres):
- For rule_type `order_deadline` **og** `available_tours` **og** `available_products`: hvis `enforce_weekdays = true` og `weekdays` er satt, og leveransedagen ikke er blant `weekdays`, produser samme funn som en `delivery_weekdays`-regel ville gjort (samme `effect`, samme `priority`, kilde-id peker på denne regelen).
- Fristberegningen (`deadline_days_before`/`deadline_time`) er uendret.
- Konflikt-/prioritetslogikken uendret.

### 2. Editor — én ekstra checkbox
I `DeliveryRuleFormDialog.tsx`, i «Tidspunkt (valgfritt)» → «Ukedager»-blokken:

```
[✓] ons  [ ] tor …
[ ] Begrens også leveringsdag til valgte ukedager
     (uten dette: regelen gjelder kun *når* leveransen er på disse dagene, men
     blokkerer ikke andre dager)
```

- Vises kun for `order_deadline`, `available_tours`, `available_products`.
- Krever minst én ukedag valgt.
- Speiles i «Regelen i ord» + `describeRule` (`useDeliveryRules.ts`).

### 3. Live-preview og test-panel
- `usePreviewDeliveryRules` trenger ingen endring — motoren returnerer allerede alle funn.
- Test-panelet viser to funn fra samme regel når begge trigges (frist brutt + feil dag), begge tagget med regelnavnet.

### 4. Mal-galleri — 3 nye maler
Legg til i wizardens mal-galleri (`DeliveryRuleFormDialog.tsx` gallery-seksjon):

| Mal | Type | Forhåndsutfylt |
|---|---|---|
| **Vare med fast produksjonsdag + frist** | `order_deadline` | `enforce_weekdays=true`, tomt vare-felt, deadline 4 dager 14:00 |
| **Kun tirsdags-/torsdags-levering for kundegruppe** | `order_deadline` | `enforce_weekdays=true`, ukedager 2+4, tom kundegruppe, deadline 1 dag 12:00 |
| **Turen kjører kun fredag** | `available_tours` | `enforce_weekdays=true`, fre |

Eksisterende maler beholdes.

### 5. Beholde gamle regler
Ingenting migreres. Kolonnen får `default false`, så alle 20 NB-regler oppfører seg identisk. Operatøren kan gradvis rydde ved å slå sammen manuelt (bruke «Lag kopi» + huke av bryteren + slette den overflødige).

## Filer som endres
- `supabase/migrations/…` (ny) — kolonne + oppdatert `evaluate_delivery_rules`
- `src/ordre/hooks/useDeliveryRules.ts` — type + `describeRule`
- `src/ordre/components/orders/DeliveryRuleFormDialog.tsx` — checkbox + wizard-validering + 3 nye maler
- `src/ordre/lib/evaluateDraftRule.ts` — klient-preview må også respektere `enforce_weekdays` (så live-visning stemmer)

## Ikke i scope
- Full sammenslåing av alle rule_types (avvist av deg)
- Auto-migrering av eksisterende regelpar (avvist av deg)
- Kombinere varer + salgsgrupper i én regel — separat problem, tas ved behov
