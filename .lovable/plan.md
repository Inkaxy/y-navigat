## Problem

Fakturalinjer leser inn mengde og enhet upresist. Eksempler fra databasen:

| Beskrivelse | qty | unit | reell mengde |
|---|---|---|---|
| TINE Helmelk 10l bib | 2 | STK | 20 L |
| ALI ORIGINAL FINMALT 36X90G | 1 | ESK | 3 240 g |
| LEMONADE CLOUDY 1L MONIN | 6 | FL | 6 L |
| EVERGOOD ESPRESSO HELE BØNNER | 6 | POS | ? |

Konsekvenser i dag:
- `price_per_base_unit` blir feil → varians-flagg slår feil ut.
- Innkjøps-statistikk (kg/L 12 mnd) blir feil for varer solgt i pakker.
- Forhandlings-baseline blir feil.

Roten:
1. AI-prompten beskriver ikke norsk enhetstaksonomi → returnerer rå koder fra fakturaen.
2. `toBaseFactor` i `match-invoice-lines` kjenner kun `g/kg/ml/l`. Alt annet (STK, ESK, PK, POS, FL, BX, BTL, KRT, KRG, SK, …) gir `null` → ingen konvertering.
3. Pakke-størrelse fra beskrivelse (`10l`, `36X90G`, `2 kg`) brukes ikke som multiplikator.

## Løsning (3 mindre, fokuserte endringer)

### 1. Felles enhets-bibliotek
Ny fil `supabase/functions/_shared/units.ts`:

- `normalizeUnit(raw)` → kanonisk form. Mapper norske/engelske varianter til:
  - Stk-familie: `STK`, `PCS`, `EA`, `H87`, `STYK` → `stk`
  - Masse: `G`, `GRAM` → `g`; `KG`, `KGM` → `kg`
  - Volum: `ML`, `MLT` → `ml`; `L`, `LTR`, `LITER` → `l`; `CL` → `cl`; `DL` → `dl`
  - Pakke-enheter (ikke base): `ESK`, `KRT`, `KRG`, `BX`, `KARTONG` → `eske`; `PK`, `PAKKE` → `pakke`; `POS`, `SK`, `SEKK`, `BAG` → `sekk`; `FL`, `BTL`, `FLASKE` → `flaske`; `RL`, `RULL` → `rull`; `SPN`, `SPANN` → `spann`
- `toBaseFactor(from, to)` → utvidet med dl/cl, og returnerer `null` for pakke-enheter (de skal multipliseres med `package_size`, ikke konverteres).
- `parsePackageFromDescription(desc)` → trekker ut størrelse fra beskrivelser:
  - `10l`, `2 kg`, `500ml`, `1/4l` → `{ size, unit }`
  - `36X90G`, `12x500ml`, `6 X 1L` → `{ size: 36*90, unit: 'g', count: 36 }` (også nyttig for stk-multiplikator)
- Alt enhets-aware via Intl-uavhengige regex (norsk locale-tegn taklet).

### 2. Bedre AI-prompt
I `extract-invoice-from-pdf` legges det til eksplisitt veiledning:

- Liste over forventede enhetskoder + at enheten skal returneres normalisert (kg/g/l/ml/dl/stk/eske/…) i stedet for rå fakturakode.
- Hvis beskrivelsen inneholder pakke-størrelse (`10l`, `36X90G`), inkluder også `package_size` og `package_unit` per linje.
- Tre korte few-shot-eksempler i prompten.

Output-skjema utvides med to valgfrie felt per linje:
```
package_size?: number | null
package_unit?: string | null
```

### 3. Match- og pris-pipeline
I `match-invoice-lines`:

- Ved beregning av `price_per_base_unit`:
  - Normaliser `line.unit` med `normalizeUnit`.
  - Hvis enheten er base-enhet (kg/g/l/ml/stk) → bruk `toBaseFactor` (uendret oppførsel).
  - Hvis enheten er pakke-enhet (eske/sekk/flaske/…) → bruk `package_size` fra (a) AI-feltet, (b) `parsePackageFromDescription`, eller (c) `raw_material_suppliers.package_size`. Da blir `price_per_base_unit = unit_price / (package_size * count_in_package)`.
- Lagre normalisert enhet tilbake i `invoice_lines.unit` (overskriv rå kode) slik at UI viser konsistent.
- Hvis ingen kilde gir pakke-størrelse for en pakke-enhet → flagg linjen `requires_review = true` med `review_reason = 'unknown_package_size'`.

### 4. Backfill-knapp (valgfritt, men billig)
Eksisterende handling «Match på nytt» dekker dette — ingen ny UI, men noter til bruker at gamle linjer kan re-matches.

## Filer som endres

- `supabase/functions/_shared/units.ts` (ny)
- `supabase/functions/extract-invoice-from-pdf/index.ts` (prompt + post-prosess)
- `supabase/functions/match-invoice-lines/index.ts` (bruk units.ts)
- `supabase/functions/import-ehf-invoice/index.ts` (normaliser EHF `unitCode` ved insert)

Ingen DB-endringer trengs — `unit` og `quantity` finnes allerede på `invoice_lines`, og `package_size`/`package_unit` finnes på `raw_material_suppliers`.

## Tekniske detaljer

```text
quantity * normalizedFactor(unit, base_unit, package_size?) = base_amount
unit_price / normalizedFactor(unit, base_unit, package_size?) = price_per_base_unit
```

Eksempler etter fix:

| Linje | qty | unit (norm) | base | base_amount | price_per_base |
|---|---|---|---|---|---|
| 10l Helmelk × 2 STK | 2 | stk (pkg=10 l) | l | 20 l | 188.41/10 = 18.84/l |
| 36×90g Ali × 1 ESK | 1 | eske (pkg=3240 g) | kg | 3.24 kg | 596.49/3.24 = 184.10/kg |
| Vaniljekrem 2 kg × 96 KG* | 96 | kg | kg | 96 kg | 41.43/kg |

*Her er fakturaen tvetydig (KG men prisen tilsier stk × 2kg). Slike beholdes som de er; AI flagger lav `field_confidence` og brukeren gjennomgår.

## Test

Etter deploy, kjør «Match på nytt» på 5–10 nylige fakturaer og verifiser at:
- `unit` på linjene er kanonisk lowercase.
- `price_per_base_unit` reflekterer pakke-multiplikasjon.
- `requires_review='unknown_package_size'` på linjer der vi ikke klarte å utlede pakke.
