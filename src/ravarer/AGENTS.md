# Råvarer — arkitekturregler

- Oppskrift-PDF regner linjekost via `pdfLineCost` (verifisert status kreves) og viser ingen total/per stk når noe mangler. Why: manglende pris ble summert som 0 kr og ga full sum.
- Råvare-DataTable aktiverer desktop-rad, mobilkort og tastatur gjennom én `activate` (velg via `onActiveChange`, så åpne). Why: mobilkort ignorerte `onActiveChange`, så trykk i arbeidslistene gjorde ingenting.
- Gyldig kostgrunnlag per fakturalinje (`eligibleLineIdsFrom`) utledes fra de flettede historikkradene, og prisprojeksjonen regnes som ukjent mens den hentes på nytt. Why: separat ID-kobling og bufret svar under oppfrisking ga «Gyldig» på feil linje eller etter nytt hold.
- Foreldreløse datablad slettes bare med én betinget DELETE (utvalg + selskap + `raw_material_id is null`) som returnerer faktisk slettede ID-er, etter eksplisitt bekreftelse. Why: les-så-slett kunne slette et blad som ble koblet i mellomtiden.
- Matvaretabellen-kobling går gjennom `useNutritionLinkFlow`: kildesjekk per økt, og `force=true` bare for et eksplisitt bekreftet mål/matvare-par. Why: bekreftelsen lovet overskriving men sendte force=false, og «bruk eksisterende» hoppet over kildesjekken.
