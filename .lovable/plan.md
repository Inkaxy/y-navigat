
## Mål

Én sannhet for leveringsregler i alle ordreflater. NBHub ser konsekvenser live og kan overstyre med begrunnelse. Portalen kan aldri overstyre — får vennlig veiledning med gyldige alternativer.

## 1. Ny hook: `usePreviewDeliveryRules`

Fil: `src/ordre/hooks/usePreviewDeliveryRules.ts`

- Input: `{ legal_entity_id, customer_id, delivery_date, delivery_tour_id, product_ids, ordered_at?, existing_order_id? }`
- Henter automatisk `customer_group_ids` (fra `customer_group_members`) og `product_group_ids` (fra `product_sales_groups`) — dette mangler i dag, så gruppe-scopede regler treffer aldri.
- Kaller `supabase.rpc('evaluate_delivery_rules', ...)` med alle 9 argumentene.
- 300ms debounce på input-endringer, TanStack Query med kort staleTime.
- Returnerer: `{ blocks, warns, infos, isLoading, canSave }` (canSave = ingen blocks).

## 2. Live-visning i skjemaene

Ny presentasjonskomponent: `src/ordre/components/rules/DeliveryRulesFeedback.tsx`

- Rød boks per block med regelnavn + melding + prioritet.
- Gul boks per warn.
- Diskret grå notis per info.

Wires inn i:
- `src/ordre/pages/NewOrder.tsx`
- `src/ordre/components/CustomerOrderModal.tsx`
- `src/ordre/components/TourOrderDialog.tsx`

Lagre-knapp disables når `canSave === false` og bruker ikke har overstyring aktivert.

## 3. Overstyringsdialog (kun NBHub)

Ny komponent: `src/ordre/components/rules/OverrideRuleDialog.tsx` — layout matcher venstre kort i skjermbildet:

```text
┌─ Leveringsregel blokkerer ordren ────────┐
│ Ordre til <kunde> · levering <dato>      │
│ ┌─ rød regelblokk (navn + prioritet) ──┐ │
│ │ regelmelding i klartekst             │ │
│ └──────────────────────────────────────┘ │
│ [grønn badge: Du har ordrekontor-tilgang]│
│ BEGRUNNELSE FOR OVERSTYRING (PÅKREVD)    │
│ [ textarea ]                             │
│ 🔒 Overstyringen logges i revisjons…    │
│               [Avbryt] [Overstyr og lagre]│
└──────────────────────────────────────────┘
```

- Trigges av knappen «Overstyr …» som kun vises når:
  - `usePermissions().hasWriteAccess('ordre') === true`
  - `blocks.length > 0`
- Tekstfelt er påkrevd (min. 10 tegn).
- Ved bekreft: setter `rule_override_reason` på ordre-payloaden og trigger vanlig lagring. Trigger på DB-siden gjør resten (logger til `audit_log`).

Brukere uten `has_app_write_access('ordre')` ser bare rødboksene og en forklaring («Ordren kan ikke lagres — kontakt ordrekontoret ved behov»).

## 4. Kundeportalen — vennlig veiledning

Denne appen bruker allerede `portal_create_customer_order`. Endringene her er UI i selve portalen (`kundeportal.nbhub.no`, egen repo — ikke rørt her), men vi eksponerer det som trengs:

- Sørger for at `evaluate_delivery_rules` fungerer med portal-brukerens `auth.uid()` (SECURITY DEFINER er allerede satt).
- Legger en plan-notat i `.lovable/plan.md` for portal-agenten som beskriver: kall `evaluate_delivery_rules` for de neste 14 dagene, filtrer bort dager med block-treff, vis 3 første gyldige som chips (matcher høyre kort i skjermbildet), pluss «kontakt bakeriet»-kort med telefonnummer fra `legal_entities`.

I NBHub selv: ingen endring i portalflaten — kun sikre at `portal_create_customer_order` returnerer strukturert blokk-info (allerede på plass via `check_violation`-exception + `_notify_ordre_team`).

## 5. Opprydding

- Slett `src/ordre/lib/deliveryRuleEnforcement.ts` (motoren er nå i DB).
- I `src/ordre/lib/orderRules.ts`: fjern deadline-duplikatet (`checkOrderDeadline`, evt. `resolveDeadline`), behold `lead_time_days`-, allergi- og åpningstids-sjekkene.
- `src/ordre/components/OrderDeadlineWarning.tsx`: fjern død kode (`passed`, `passedFinal` som ikke leses noe sted) — komponenten erstattes uansett av `DeliveryRulesFeedback` for deadline-visning, men beholdes for legacy lister til alt er migrert.
- Erstatt `useOrderDeadlineCheck`-kall med den nye hook-en.
- I ordrelisten (`src/ordre/pages/OrdersList.tsx` og `CustomerOrdersTab.tsx`): les `orders.rule_flags` (jsonb) og vis liten ⚠️-indikator med tooltip på ordrer som har lagrede warns eller er lagret med `rule_override_reason IS NOT NULL`.

## Tekniske detaljer

- Hook returnerer også `groupsLoading` slik at UI kan vise skeleton mens `customer_group_ids`/`product_group_ids` hentes.
- `evaluate_delivery_rules` kalles fra klient — SECURITY DEFINER, ingen ekstra grants nødvendig.
- Overstyringsdialog: `<AlertDialog>` fra shadcn med custom body, farger fra semantic tokens (`destructive`, `warning`, `success`), matcher cream/bronze designsystemet.
- Alle skjemaer sender `rule_override_reason` i samme insert/update — DB-triggeren gjør resten (auth-sjekk + audit_log).
- Ordreliste-indikator: lite ikon `AlertTriangle` fra lucide, farge `text-amber-600`, tooltip lister regelnavnene fra `rule_flags`.

## Filer som endres/opprettes

Nye:
- `src/ordre/hooks/usePreviewDeliveryRules.ts`
- `src/ordre/components/rules/DeliveryRulesFeedback.tsx`
- `src/ordre/components/rules/OverrideRuleDialog.tsx`

Endres:
- `src/ordre/pages/NewOrder.tsx`
- `src/ordre/components/CustomerOrderModal.tsx`
- `src/ordre/components/TourOrderDialog.tsx`
- `src/ordre/lib/orderRules.ts`
- `src/ordre/components/OrderDeadlineWarning.tsx`
- `src/ordre/pages/OrdersList.tsx` og `src/kunder/components/CustomerOrdersTab.tsx`
- `src/ordre/hooks/useOrderDeadlineCheck.ts` (fjernes eller re-implementeres som wrapper)

Slettes:
- `src/ordre/lib/deliveryRuleEnforcement.ts`
