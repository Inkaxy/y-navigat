# Datorekkefølge i priskontroll — live 13. okt. 2026 (ikke kjør på nytt)

Kjørt via migrasjonsverktøyet (supabase/migrations). md5(pg_get_functiondef) etter utrulling:

| Objekt | md5 |
|---|---|
| `rm_price_reference` (forrige kjøp via `_rm_cost_candidates`, strengt før fakturadato, aldri egen faktura, samme dato ulik pris → `conflict`/`flere_kjop_samme_dato_ulik_pris`) | `922032742678314b275e12c6fe0a2ec7` |
| `_rm_cost_candidates` (tie-break samme dato: `price desc` før `created_at`) | `5a28cc1e868271452552b30ad1d8ea57` |
| `rm_work_items` (`p_sort='oldest'`, felt `first_open_date`) | `2de78dc9cff593e7d6ead7a46cf017db` |
| `_rm_retain_price_acceptance` + trigger `zz_rm_retain_price_acceptance` på `invoice_lines` | `35d0e2bd23aff1c85459c4299db189d9` |

Regresjon: `supabase/tests/price_date_order_regression.sql` (ruller alltid tilbake).
