# 1-kjor-na – én fil venter på Henriks ja

`01_nullstill_koen.sql` – legger til det appen trenger for «Nullstill køen» under Fra faktura. **Ikke kjørt.**

`02_ehf_bryter.sql` – kjørt 19.11 og flyttet til `kjort/`.
Filen starter ingen kjøring og endrer ingen fakturalinjer, kostpriser eller innstillinger. Kjøringen startes av
Henrik i appen etterpå. Kontroll: `../kontroll/20261124_nullstill_koen.check.sql` (FØR og ETTER).
00–07 ble kjørt 18.11.2026 og ligger i `../kjort/`. Se `../LES-MEG.md`.
