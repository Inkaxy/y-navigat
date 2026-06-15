## Mål
Få kakebygger-bestillingen fra kassen til å gå hele veien fra "Brød → Kakebygger → kategori → wizard → Bekreft bestilling" og opprette en faktisk henteordre. I tillegg rette to UX-feil som blokkerer flyten.

## Funn fra koden

1. **Silent submit-fail på «Bekreft bestilling»**
   - `KakebyggerModal.tsx` lytter på `cake-builder/done`, kaller `onCakeComplete?.(result)` synkront og lukker så modalen. `Kasse.tsx` håndterer dette med en `async` callback som kaller `pos_create_cake_order` og viser toast ved feil.
   - Problemet: callbacken kjører som en uventet `Promise` etter at modalen er lukket. Hvis RPC-en kaster, kommer `toast.error`-meldingen ofte ikke opp (eller forsvinner umiddelbart fordi `kioskSupabase`-klienten har en feil), og det er ingen logg igjen for å diagnostisere.
   - I tillegg har `pos_create_cake_order` (migrasjon `20260615110509…`) flere strenge `RAISE EXCEPTION`-paths (mangler `pickup_date`, mangler `category_id`/`price_list_id`, manglende basis-produkt osv.) som blir helt usynlige for operatøren.

2. **Motstridende validering på 0-min steg («Pynt», «Allergi»)**
   - `stepValidation` i `CakeBuilder.tsx` (linje 352–360) returnerer `"Du må velge minst ett alternativ."` så snart `required=true` og `sel.length===0`, selv om steget er konfigurert med `min_selections=0, max_selections=4`. UI viser "Velg 0–4" men footer blokkerer «Neste».

3. **«Starter på Steg 2/8»**
   - I `CakeBuilder.tsx` (linje 778–786) er `headerTotalSteps = steps.length + 3` (customer + N + summary + payment) og `headerStepIndex = stepIndex + 1` på første wizard-steg. Når kiosken sender kunden inn med prefilled customer-meta hoppes "customer"-fasen over, men telleren tar fortsatt med customer-fasen → første reelle steg vises som «2 / N+3».

## Endringer

### A. `src/varer/features/cakeBuilder/CakeBuilder.tsx`
- **Validering (fix 2):** I `stepValidation` for `multi`-steg: skill mellom `required` og effektiv minste-grense. Hvis `currentStep.min_selections === 0` (eksplisitt 0), ikke kast «minst ett alternativ»-feil. Behandle bare `required && (min_selections == null || min_selections > 0)` som «minst 1»-krav.
- **Steg-teller (fix 3):** Når `hasPrefilledCustomer === true`, regn telleren uten customer-fase:
  - `headerTotalSteps = steps.length + 2` (N + summary + payment)
  - `headerStepIndex = isSummary ? steps.length+1 : isPayment ? steps.length+2 : stepIndex+1`-mapping justeres tilsvarende slik at første steg blir «1 / N+2».
- **Diagnostikk (fix 1, klient-side):** Legg til `console.info`-logger ved `handleConfirmStep` og `handleFinalConfirm` for å bekrefte hvilken vei flyten tar når noe feiler.

### B. `src/kiosk/components/KakebyggerModal.tsx`
- **Hardere feilhåndtering (fix 1):** Pakk `onCakeComplete?.(result)`-kallet i en `try { await … } catch (e) { toast.error(…); console.error(…) }` og utsett `onOpenChange(false)` til etter at callbacken faktisk har returnert. Dette gjør at:
  - En kastet RPC-feil blir alltid logget i konsollen og vist som toast.
  - Modalen lukkes ikke før ordren er bekreftet — operatøren kan se feilmeldingen i kontekst.
- **«No-op»-vakt:** Hvis `onCakeComplete` ikke er definert (som i `KeypadGrid`-instansen som ikke videresender callbacken), vis `toast.error("Kakebygger-resultatet ble ikke håndtert — ingen ordre opprettet")` i stedet for stilltielse.

### C. `src/kiosk/components/KeypadGrid.tsx`
- **Fjerne duplikat-modal:** `KeypadGrid` har sin egen `<KakebyggerModal>` uten `onCakeComplete`. Den brukes ikke fra `Kasse.tsx` (Kasse bruker `KeypadArea`/`KioskRender`), men hvis komponenten en dag mountes andre steder vil den droppe ordren stille. Fjern den interne modal-instansen og `kakebyggerOpen`-staten, og endre `handleFunction("kakebygger")` til å vise `toast.error("Kakebygger må åpnes fra kassevisningen")` — eller løft handlingen til en prop-callback `onOpenKakebygger?: () => void`.

### D. Verifisering
Etter endring kjører jeg gjennom flyten i preview: Brød → Kakebygger-tile → Kundeopplysninger → Bløtkake → wizard → Oppsummering → Betaling → Bekreft. Sjekker at:
- Toast «Henteordre #… opprettet» vises.
- Ny rad i `orders` med `source='pos_kakebygger'` (verifiseres via `supabase--read_query`).
- Hvis RPC feiler: konsollen logger feilen og en toast vises før modalen lukkes.

## Tekniske detaljer
- Ingen DB-migrasjon nødvendig — alle feil ligger i frontend-koden og hvordan callback-kjeden håndterer asynkrone feil.
- `pos_create_cake_order` (SECURITY DEFINER) endres ikke i denne PR-en; vi bare gjør feilene synlige slik at vi kan rette neste-steg hvis det viser seg at RPC-en selv kaster.
- Skill mellom «required» og «min_selections» påvirker også summary-stegets `canProceed`-logikk; ingen ny logikk der, bare at `stepValidation` slipper gjennom 0-min-steg.
