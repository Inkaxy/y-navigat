Plan:

1. Gjør interaksjonen testbar i preview
   - Hvis preview krever innlogging, be deg logge inn først før jeg kan gjøre en ekte browser-test.
   - Bruke eksisterende rute `/pos-styring/tastatur/3ba6a181-1173-4e70-ba29-f632eb817d04` og teste både flytting av rute og resize-håndtak.

2. Fiks sannsynlig årsak i `TastaturEditor.tsx`
   - Endre pointer-listeners fra elementbundne `pointermove/pointerup` til `window`/`document`-listeners mens draoperasjonen pågår, slik at flytt/resize fortsatt registreres selv når pekeren havner over andre grid-celler eller utenfor selve ruta.
   - Sørge for at resize-håndtaket stopper tile-drag helt, men fortsatt selv mottar pointer-events.
   - Sikre at klikk fortsatt åpner redigering, mens faktisk drag bare flytter ruta.

3. Forbedre visuell feedback under bruk
   - La ruta følge musepekeren under drag.
   - La resize beregne ny bredde/høyde mot grid-celler uten å trigge vanlig flytting.
   - Beholde kollisjonssjekk og grensekontroll slik at ruter ikke kan overlappe eller havne utenfor gridet.

4. Verifiser etter endring
   - Test drag/drop i browser-preview hvis innlogging/session er tilgjengelig.
   - Test resize-håndtak i browser-preview.
   - Sjekk console/network for feil etter operasjonene.
   - Hvis browser fortsatt møter login-skjerm, verifiser kodebanen og be deg logge inn i preview for en endelig interaktiv test.