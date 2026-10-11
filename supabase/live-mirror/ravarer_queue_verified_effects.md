# ravarer_queue_verified_effects — live (ikke kjør på nytt)

Dokumentasjon av køkontrakten som allerede er live. Lest med `pg_get_functiondef`
11. okt. 2026 (16:05 UTC). Ingen SQL i denne filen skal kjøres; den beskriver kontrakten
klienten leser.

| Funksjon | Returnerer | md5(pg_get_functiondef) |
|---|---|---|
| `public.rm_work_items(p_legal_entity_id uuid, p_group text='alle', p_search text=null, p_supplier_id uuid=null, p_sort text='impact', p_limit int=50, p_offset int=0)` | jsonb | `6ff7e159e9ed1d9ea8ec3dd497b0a4f4` |
| `public._rm_queue_line_read_issue(p_line_id uuid, p_invoice_read_issue boolean=true)` | text | `94f53096094ab574e493181d83a6671e` |
| `public._rm_queue_line_effect(p_line_id uuid, boolean)` | numeric | `c8f934c20a808cdf8838e2a7a3663a1c` |
| `public.rm_invoice_has_read_issues(uuid)` | boolean | `c54122a5fd7d981053fc5a878e1ab7c2` |

## Felt per element (`items[]`)

`effect_status` (`verified_price_effect` | `unknown` | `not_price_effect`), `effect_label`,
`impact_nok` (bare satt når verified), `read_integrity` (`checked` | `needs_review` | `unknown`),
`read_integrity_flags text[]`, `unknown_effect_lines`, `amount_kind`
(`parsed_line_amount` | `parsed_invoice_total`), **`action_required`**.

### `action_required`

Varekort (første treff):
1. flagg `credit_note` → `review_credit_note`
2. flagg `non_nok_currency` → `review_currency`
3. flagg `price_observation_held` → `confirm_price_basis`
4. flagg i (`invoice_sum_not_verified`, `invoice_read_unverified`, `line_arithmetic_unverified`, `invalid_quantity`) → `review_reading`
5. andre lesehull (manglende kobling, pakning, …) → `complete_link_or_package`
6. prisavvik med linjer uten sikker virkning → `confirm_price_basis`
7. prisavvik → `review_price`
8. ellers → `complete_link_or_package`

Faktura: kreditnota → `review_credit_note`; ikke NOK → `review_currency`; ellers `review_invoice`.
Fakturabeløp er alltid `not_price_effect`.

### Linjeregel (`_rm_queue_line_read_issue`, rekkefølge)

held → missing_link → invalid_tenant_link → credit_note → non_nok_currency → cancelled_invoice →
invoice_read_unverified (flagget eller lesevarsel) → line_arithmetic_unverified
(beløp/pris ≤ 0 eller pris×grunnmengde ≠ sum, toleranse max(0,05; 1 %)) →
invoice_sum_not_verified (`lines_sum_status <> 'ok'`) → line_needs_review → invalid_quantity →
package_not_confirmed / package_snapshot_* → base_quantity_conflicts.

Klientens speil: `src/fakturaer/lib/financialPresentation.ts` (`linePriceGate`). Holdt-tabellen
er ikke lesbar for klienten; arbeidsflaten leser holdt-status fra `rm_work_items` per leverandørvare.
