# Utgåtte filer – KJØR ALDRI

| Fil | Hvorfor |
|---|---|
| `20261117_automatikk_cron.DATAENDRING.sql` | Timesjobben for `rm_automation_tick` trengs ikke; versjon D har ikke automatikk som krever cron. |
| `20261012_negotiation_item_preservation.PENDING.sql` / `.test.sql` | Erstattet. Den gjennomgåtte versjonen ble kjørt 12.10.2026 og ligger i `supabase/live-mirror/negotiation_item_preservation_reviewed.sql`. |

Delvis utgått, men ligger fortsatt i `supabase/pending/` fordi resten trengs: `20261117_automatikk.PENDING.sql`
(tabellen `rm_key_material_limits` – nøkkelråvaregrenser – er erstattet av egen prisgrense per vare). Se `docs/ravarer-drift.md`.
