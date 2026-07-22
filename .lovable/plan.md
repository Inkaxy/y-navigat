Steg 1 av omleggingen: kun **SQL-fundamentet** + rydding av deadline-drift. Ingen trigger, ingen UI-endringer — appen fortsetter å bruke dagens motorer inntil steg 2.

## Leveranse

**Én migrasjon** som gjør alt følgende i riktig rekkefølge:

### 1. Schema-endringer på `delivery_rules`

```sql
ALTER TABLE public.delivery_rules
  ADD COLUMN effect text NOT NULL DEFAULT 'block'
    CHECK (effect IN ('block','warn','info')),
  ADD COLUMN priority int NOT NULL DEFAULT 0,
  ADD COLUMN allowed_product_ids uuid[],
  ADD COLUMN allowed_product_group_ids uuid[];
```

### 2. Datamigrasjon (idempotent, i samme migrasjon)

- `UPDATE delivery_rules SET effect='warn' WHERE rule_type='order_deadline'` (resten forblir `'block'` fra default).
- For `rule_type='available_products'`: kopier `product_ids → allowed_product_ids` og `product_group_ids → allowed_product_group_ids`, deretter sett de opprinnelige kolonnene til `NULL` (så de får entydig scope-betydning framover).
- **Ingen** DROP av `product_ids`/`product_group_ids` — de beholder nå kun scope-betydning for alle regeltyper.

### 3. Ny funksjon `public.evaluate_delivery_rules`

```sql
CREATE OR REPLACE FUNCTION public.evaluate_delivery_rules(
  p_legal_entity_id uuid,
  p_customer_id uuid,
  p_customer_group_ids uuid[],
  p_delivery_date date,
  p_delivery_tour_id uuid,
  p_product_ids uuid[],
  p_product_group_ids uuid[],
  p_ordered_at timestamptz DEFAULT now(),
  p_existing_order_id uuid DEFAULT NULL
) RETURNS TABLE(
  rule_id uuid,
  rule_name text,
  rule_type text,
  effect text,
  priority int,
  matched boolean,
  message text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions
```

**Ansvar:**
- Filtrerer aktive regler på `legal_entity_id`, `valid_from/valid_until`, `specific_delivery_date`, kunde-scope (`customer_ids`), kundegruppe-scope (`customer_group_ids`), ukedag-scope (`weekdays` — kun når `rule_type != 'delivery_weekdays'`), tur-scope (`tour_filter` — kun når `rule_type != 'available_tours'`), vare-/varegruppe-scope (`product_ids`/`product_group_ids` — kun når `rule_type != 'available_products'`). Portert 1:1 fra dagens `deliveryRuleEnforcement.ts`.
- Evaluerer alle 6 typer inkludert **`delivery_pauses`** (tabellen finnes allerede — joines inn som virtuelle regler med `effect='block'`, `rule_type='delivery_pause'`).
- `order_deadline`: beregner deadline som `((p_delivery_date - deadline_days_before) + deadline_time) AT TIME ZONE 'Europe/Oslo'` og sammenligner mot `p_ordered_at`. `matched=true` når fristen er passert.
- `available_products`: bruker nye `allowed_product_ids` + `allowed_product_group_ids`. `matched=true` når minst én vare i `p_product_ids` faller utenfor tillatt-listen.
- `p_existing_order_id`: reservert for framtidig bruk (ekskludere egen ordre ved re-evaluering) — tas som parameter nå så signaturen er stabil for steg 2.

**Prioritets-/effekt-oppløsning:**
- Grupperer treff (`matched=true`) per `rule_type`. Innen hver gruppe: høyeste `priority` vinner. `effect='info'` med høyere prioritet «demper» lavere-prioritets treff av samme type (returneres med `matched=false`, beholdes for audit).
- Returnerer **alle** rader (også ikke-matchede treff som ble demput) med korrekt `matched`-flagg — caller kan filtrere selv.

### 4. Deadline-drift ryddet

- `DROP FUNCTION IF EXISTS public.check_order_deadline_violations(...)` (alle overloads).
- Erstattes av tynn RPC `public.check_order_deadline_violations_v2(...)` med samme returkolonner (`rule_id, rule_name, deadline_timestamp, is_passed, minutes_over`) implementert som SELECT over `evaluate_delivery_rules(...)` filtrert på `rule_type='order_deadline'`. **Grunn**: `useOrderDeadlineCheck` fortsetter å virke uendret i steg 1; oppdateres i steg 2.
- `GRANT EXECUTE ... TO authenticated, service_role` på begge nye funksjoner.

### 5. Sommertid-test (kjøres i migrasjonen som `DO $$ ... ASSERT ... $$`)

Seedes én `order_deadline`-regel `deadline_time='10:00', deadline_days_before=1`, med `valid_from='2026-03-01'`. Verifiserer:

| Scenario | p_delivery_date | p_ordered_at (UTC) | Forventet matched |
|---|---|---|---|
| Før DST-hopp (vintertid, UTC+1) | 2026-03-28 (lør) | 2026-03-27 09:01Z (=10:01 Oslo) | `true` |
| Før DST-hopp, akkurat i tide | 2026-03-28 | 2026-03-27 08:59Z (=09:59 Oslo) | `false` |
| Etter DST-hopp (sommertid, UTC+2) | 2026-03-30 (man) | 2026-03-29 08:01Z (=10:01 Oslo) | `true` |
| Etter DST-hopp, akkurat i tide | 2026-03-30 | 2026-03-29 07:59Z (=09:59 Oslo) | `false` |

Migrasjonen ruller tilbake hvis en assert feiler.

## Hva som IKKE gjøres i dette steget

- Ingen trigger på `orders`.
- Ingen endringer i `CustomerOrderModal`, `TourOrderDialog`, fastordre-generator, portal-RPC.
- Ingen sletting av `deliveryRuleEnforcement.ts` eller `useOrderDeadlineCheck`.
- Ingen admin-UI-endringer for de nye kolonnene `effect`/`priority`/`allowed_*` (kommer i eget steg).

Etter denne migrasjonen finnes den nye motoren side om side med den gamle, men er ikke i bruk enda. Steg 2 kobler den på.

## Åpne avklaringer

1. **`delivery_pauses`**: skal disse også få `effect`/`priority`-kolonner, eller er de alltid `block/priority=0`? Anbefaling: alltid `block`, ingen kolonner nå — kan legges til senere om behov.
2. **Info-som-unntak**: en `info`-regel med høyere prioritet demper matchende `block`/`warn` av **samme rule_type**. Skal den også kunne dempe **på tvers** av typer (f.eks. info-regel opphever både no_delivery og weekdays for jul)? Anbefaling: kun samme type nå — enklere å resonnere om, og din formulering sa «samme type».
