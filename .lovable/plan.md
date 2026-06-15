## Plan

1. **Gjør valgt kakebyggestein til hovedprodukt**
   - Oppdater `public.build_cake_order_line` slik at hovedlinjen velges fra kundens valgte alternativ i et basis-/størrelse-steg.
   - Prioritet:
     1. Valgt alternativ i steg med `suggested_role = 'base'`
     2. Valgt produkt med `products.cake_role = 'base'`
     3. Kun hvis ingen av disse finnes: fallback til kategoriens basisprodukt
   - Dette hindrer at kategoriens basisprodukt `#628` brukes når kunden faktisk har valgt f.eks. `#1791` eller `#1792`.

2. **Sørg for at ordresystemet får samme varenummer**
   - Bekreft at `order_line.product_id`, `order_line.display_number`, `label_payload.product_id` og `label_payload.display_number` alle bruker samme valgte hovedprodukt.
   - `pos_create_cake_order` skal fortsatt bruke verdiene fra `cake_result.order_line`, men vi verifiserer at lagret ordrelinje får korrekt `product_snapshot.display_number`.

3. **Legg inn eksplisitt validering**
   - Hvis et påkrevd basis-/størrelse-steg finnes, men valget ikke peker til et produkt, skal funksjonen gi en tydelig feilmelding i stedet for stille å bruke `#628`.
   - Dette gjør feil konfigurasjon synlig med en gang.

4. **Vis riktig nummer i bekreftelsen**
   - Kontroller frontend-flyten i `CakeBuilder.tsx`: “Varenummer (til produksjon)” skal fortsatt lese fra servervalidert `order_line.display_number`.
   - Hvis nødvendig, legg til en liten frontend-sikring som ikke viser `#628` når et valgt basisprodukt finnes i oppsummeringen.

5. **Test mot dagens Bløtkake-oppsett**
   - Test med valgt `Spesialkake 12-14p (#1792)` og verifiser at bekreftelsen og ordrelinjen viser `#1792`.
   - Test også `#1791` og eventuelle andre kakevarer som er lagt inn som byggeklosser.