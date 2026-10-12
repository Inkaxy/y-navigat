# Ventende forslag

Filer her er forslag til uavhengig gjennomgang og ligger utenfor `supabase/migrations`
fordi den mappen kjøres av verktøyet. Root kjører eksakt godkjent fil, aldri «alle ventende».

| Fil | Status |
|---|---|
| `20261012_negotiation_item_preservation.PENDING.sql` | **ERSTATTET — KJØR ALDRI.** Opprinnelig forslag var mangelfullt (bl.a. hjelpefunksjonens ACL og manglende varig utstedelsesmarkør). Den korrigerte, gjennomgåtte versjonen ble anvendt live 2026-10-12 ~05:49 UTC og er speilet i `supabase/live-mirror/negotiation_item_preservation_reviewed.sql`. Filen beholdes bare som historisk bevis. |
| `20261012_varetelling_foundation.PENDING.sql` | **TIL GJENNOMGANG, IKKE KJØRT.** Revisjon 2 (erstatter aldri-kjørt revisjon 1 i samme fil). Kjør bare etter roots godkjenning av eksakt fil. |
| `20261012_varetelling_foundation.test.sql` | Lokal PGlite-test (`node scripts/test-varetelling-sql.mjs`), 111 kontroller, seriell — ikke parallell samtidighet. |
| `20261012_negotiation_item_preservation.test.sql` | Historisk isolert enkeltøkt-test skrevet mot det erstattede forslaget. Beholdt som bevis; dekker ikke `rfq_issued_at`. Samtidighet i to økter er ikke verifisert. |

Edge `generate-rfq-credentials` er allerede utrullet live (v141, kilde lik b845). Skal ikke rulles ut på nytt fra denne mappen.
