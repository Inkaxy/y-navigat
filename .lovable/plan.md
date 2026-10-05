# Allergener fra deklarasjonsteksten – funn og forslag

## Funn (kun lest, ingenting endret)

Alle elementene i skjermbildet finnes:

| Element | Fil |
|---|---|
| «Deklarasjonshjelp», «Bruk standardformat», «Kontroller med AI», «Bruk forslag» | `src/varer/components/declaration/DeclarationAssistantPanel.tsx` (178, 287–295, 369) |
| «Hent allergener fra råvarene», «Inneholder (kommaseparert)», «Kan inneholde spor av (kommaseparert)», «Lagre kladd» | `src/varer/components/recipes/label/DeclarationNutritionSection.tsx` (323–388) |
| Skjematype `Form { ingredientText, contains, mayContain, nutrition }` | `src/varer/components/recipes/label/declarationForm.ts` |
| AI-endepunkt | `supabase/functions/declaration-assistant/index.ts` (589 linjer) |

**AI-endepunktet:** henter Henriks egen OpenAI-nøkkel (kryptert i oppsettet), bare modeller på godkjent liste, kaller `https://api.openai.com/v1/responses` med strengt JSON-skjema `DECLARATION_OUTPUT_SCHEMA` (`_shared/declaration-instructions.ts`): `proposals` (bare `case | spelling | alias | spacing`), `allergen_findings`, `questions`. Tilgang: innlogging, så `has_app_write_access('varer')` eller skriverett på oppskriften (linje 160–182), dagskvote og bruklogg.

**Svaret til klienten:** `suggestion: { markerText, issues, allergenCodes, blocked }`, `before`, `accepted`, `rejected`, `metadata_conflicts`. `allergenCodes` regnes ut deterministisk fra *stjernemerkede* ord i teksten (`_shared/declaration-format.ts:578`), ikke av modellen.

**Skjema og lagring:** lokal `useState<Form>`. «Lagre kladd» oppdaterer `recipes.manual_ingredient_declaration` og `manual_allergen_summary: { contains, may_contain }` direkte (linje 106–120). Feltene er låst når `canWrite` er false.

## Hvorfor allergenfeltene ikke fylles

1. Panelet sender bare teksten videre: `onApply: (markerText: string) => void`. I `onAssistant(text)` settes bare `ingredientText`. `allergenCodes` blir aldri brukt.
2. Modellen er bygd for å rette tekst, ikke for å hente ut allergener. `allergen_findings` brukes bare internt mot registrerte data (`substantiateFindings`, linje 492). Det går ikke ut som noe forslag til feltene.
3. «Kan inneholde spor av» finnes ikke i svaret i det hele tatt. Ingen kode leser setningen «Kan inneholde spor av …» i teksten.
4. «Hent allergener fra råvarene» bruker råvareberegningen, ikke den registrerte teksten.

## Minste nødvendige endring (forslag, ikke godkjent)

Det trengs ikke et nytt AI-kall. Tallene finnes allerede deterministisk:

1. **Ny knapp «Hent allergener fra teksten»** ved siden av «Hent allergener fra råvarene». Den leser `form.ingredientText` lokalt:
   - *stjernemerkede* ord gjøres om til koder med den eksisterende tolkningen som gir `allergenCodes`, og deretter til norske navn med `ALLERGEN_LABEL` → **Inneholder**.
   - Setningen «Kan inneholde spor av …» tolkes med `normalizeAllergenCode` → **Kan inneholde spor av**.
   - Uleselige ord vises som «ikke tolket». De legges aldri stille inn.
2. **Etter «Bruk forslag»/«Bruk standardformat»:** tilby samme utfylling, ikke automatisk. Utvid `onApply` til `(markerText, allergenCodes)`.
3. Bekreftelsesdialog hvis feltene allerede har innhold (eksisterende `Pending`-mønster). Ingenting lagres før «Lagre kladd». Godkjente deklarasjoner berøres ikke.
4. Tester: stjernemerking → Inneholder, sporsetning → Kan inneholde, ukjente ord avvist, ingen overskriving uten bekreftelse.

Valgfritt senere: la AI foreslå umerkede allergenord (f.eks. «hvetemel» uten stjerner). Det krever endring i skjema/edge og betalte OpenAI-kall. Da trengs Henriks eksplisitte godkjenning og en nøkkel.

## Tekniske detaljer
- Bare kode i nettleseren. Ingen database-, edge- eller deployendring i trinn 1–4.
- Tolkningen må speile `_shared/declaration-format.ts`. Gjenbruk speilet i `src/` hvis det finnes, ellers en liten delt hjelper med speilingstest, som `allergenMirror.test.ts`.
