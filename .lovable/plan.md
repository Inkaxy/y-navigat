# Slett demo-data

Rydder vekk alle "[DEMO]"-kunder og tilhørende data fra databasen.

## Hva som identifiseres som demo

Kunder hvor `display_name` starter med `[DEMO]` eller `organization_number` starter med `[DEMO]`:

| Kundenr | Navn |
|--|--|
| 20001 | [DEMO] Rema 1000 Tønsberg |
| 20002 | [DEMO] Kiwi Nøtterøy |
| 20003 | [DEMO] Restaurant Lille Måken |
| 20004 | [DEMO] Restaurant Grand |
| 20005 | [DEMO] Bjørndalen barnehage |
| 20006 | [DEMO] Slottsfjell Hotell |
| 20007 | [DEMO] Kafé Sentrum |

## Tilknyttede data som forsvinner

| Tabell | Antall | Hvordan |
|--|--|--|
| `customers` | 7 | Eksplisitt slettet |
| `orders` | 22 | Eksplisitt slettet (FK NO ACTION fra orders → customers) |
| `order_lines` | (cascade) | ON DELETE CASCADE fra orders |
| `order_status_history` | (cascade) | ON DELETE CASCADE fra orders |
| `delivery_notes` | 7 | Eksplisitt slettet — alle 7 tilhører demo-kunder (verifisert) |
| `delivery_note_lines` | 14 | ON DELETE CASCADE fra delivery_notes |
| `recurring_order_schedules` | 1 | ON DELETE CASCADE fra customers |
| `special_prices` | 3 | ON DELETE CASCADE fra customers |
| `customer_portal_accounts` | 1 | ON DELETE CASCADE fra customers |
| `pos_customers.source_customer_id` | (set null) | Settes til NULL automatisk |

Ingen tickets er koblet til disse ordrene. Ingen andre kunder peker til demo som faktura-mottaker.

## Slettings-rekkefølge (én migrasjon)

1. `delete from delivery_notes where customer_id in (demo_ids)` → river med seg `delivery_note_lines`
2. `delete from orders where customer_id in (demo_ids)` → river med seg `order_lines`, `order_status_history`
3. `delete from customers where id in (demo_ids)` → river med seg `recurring_order_schedules`, `special_prices`, `customer_portal_accounts`

WHERE-klausul: `display_name like '[DEMO]%' or organization_number like '[DEMO]%'`.

## Etter sletting

- Bruker som står på `/kunder/kundeliste/cf30f54b-…` (Slottsfjell Hotell) blir kastet til 404 — det er forventet.
- Du må refreshe Dashbord/lister.

## Bekreftelse

Trykk **Implementer** for å kjøre migrasjonen. Sletting er **ikke reversibel** — bekreft at det er greit at alle 7 kunder + 22 ordrer + 7 pakksedler fjernes permanent.
