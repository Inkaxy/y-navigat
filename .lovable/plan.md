# Realtime-kanaler scopet til legal entity

## Mål
Lukke "cross-entity realtime leak"-funnet ved å gjøre to ting samtidig:
1. Prefiksere alle realtime-kanal-topics med `<legal_entity_id>:` (UUID).
2. Stramme `realtime.messages` SELECT/INSERT-policiene til kun å tillate topics der prefikset matcher en LE brukeren har aktiv stilling i.

Endringene må gå sammen i én leveranse — ellers brytes realtime i appen.

## Hooks som må endres (9 stk)

| Fil | Nytt topic-mønster | LE-kilde |
|---|---|---|
| `src/ordre/hooks/useOrderDetail.ts` | `${legalEntityId}:order:${orderId}` | henter `orders.legal_entity_id` før subscribe |
| `src/ordre/hooks/useTicketPresence.ts` | `${legalEntityId}:ticket-presence:${ticketId}` | henter `tickets.legal_entity_id` |
| `src/varer/features/cakeBuilder/useWizardConfig.ts` | `${legalEntityId}:cake-builder:${categoryId}:${priceListId}` | henter `cake_categories.legal_entity_id` |
| `src/produksjon/features/etiketter/useProductLabelProfiles.ts` | `${legalEntityId}:product-label-profiles:${hash}` | tar `legalEntityId` som ny prop fra caller |
| `src/produksjon/features/etiketter/useLabelRealtime.ts` | `${legalEntityId}:labels:${date}` | har allerede `filter.legalEntityId` |
| `src/produksjon/features/etiketter/useLabelPrintJobs.ts` | `${legalEntityId}:label-jobs:${deptId}` | tar `legalEntityId` som ny prop |
| `src/produksjon/features/utskriftsprofiler/useLabelPrintProfiles.ts` | `${legalEntityId}:label-print-profiles:${uuid}` | har allerede |
| `src/produksjon/features/pakkeomrader/usePackingAreas.ts` | `${legalEntityId}:packing-areas` | har allerede |
| `src/produksjon/features/oversikt/useDepartmentLabelStats.ts` | `${legalEntityId}:oversikt` | har allerede |

For hooks som ikke har `legalEntityId` i scope i dag (`useOrderDetail`, `useTicketPresence`, `useWizardConfig`), må vi enten:
- Hente LE som del av eksisterende SELECT (anbefalt, ingen ekstra round-trip), ELLER
- Ta `legalEntityId` som prop og overlate ansvaret til parent.

For `useProductLabelProfiles` og `useLabelPrintJobs` legger vi til `legalEntityId` som påkrevd parameter.

## Database-migrasjon

```sql
-- Helper: sjekk om bruker har aktiv stilling i en LE
CREATE OR REPLACE FUNCTION public.user_has_legal_entity_access(_le uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_positions up
    WHERE up.user_id = auth.uid()
      AND up.legal_entity_id = _le
      AND up.valid_from <= CURRENT_DATE
      AND (up.valid_to IS NULL OR up.valid_to >= CURRENT_DATE)
  )
$$;

-- Drop gamle policies
DROP POLICY IF EXISTS realtime_messages_select_employees ON realtime.messages;
DROP POLICY IF EXISTS realtime_messages_insert_employees ON realtime.messages;

-- Nye policies: topic må starte med <uuid>: og bruker må ha LE-tilgang
CREATE POLICY realtime_messages_select_le_scoped ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    topic ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:'
    AND public.user_has_legal_entity_access(substring(topic from 1 for 36)::uuid)
  );

CREATE POLICY realtime_messages_insert_le_scoped ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    topic ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:'
    AND public.user_has_legal_entity_access(substring(topic from 1 for 36)::uuid)
  );
```

## Rekkefølge ved deploy

For å unngå bruksavbrudd i prod:

1. **Steg 1 — kode først:** rename alle 9 `.channel(...)`-kall til nytt mønster. Deploy. På dette tidspunktet aksepterer policy fortsatt alt, så ingenting brytes.
2. **Steg 2 — verifiser:** sjekk i preview at hver realtime-feature fortsatt fungerer (ordre-detalj, ticket-presence, cake builder, etiketter, utskriftsprofiler, pakkeområder, oversikt).
3. **Steg 3 — stram policy:** kjør migrasjonen som dropper gamle policies og oppretter LE-scopede.
4. **Steg 4 — re-scan:** kjør security scan, marker funnet som fikset.

## Risiko

- Hvis vi glemmer en `.channel(...)`-bruk eller en tredjepart (edge function) som broadcaster på et topic uten UUID-prefiks, vil de stille slutte å motta events. Mitigering: full rg-sjekk + manuell QA-runde i steg 2.
- `realtime.messages`-tabellen er Supabase-managed; vi endrer kun policies, ikke struktur.
- Migrasjonen er reversibel — gamle policies kan gjenopprettes hvis noe bryter.

## Leveranse
Steg 1 og 3 i samme PR, men med intern verifisering mellom dem (jeg tester preview før jeg kjører migrasjonen).
