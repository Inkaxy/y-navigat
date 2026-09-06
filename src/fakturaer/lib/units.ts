// DENNE FILEN ER BYTE-IDENTISK MED supabase/functions/_shared/units.ts.
// Endres den ene, må den andre endres likt — en vitest sammenligner filene.
// Felles enhets-håndtering for fakturalinjer og databladet.
// Mål: oversette norske/EHF-koder til kanoniske enheter, og hente pakke-størrelse
// fra fritekst-beskrivelser.

export type CanonicalUnit =
  | "g" | "kg" | "ml" | "cl" | "dl" | "l"
  | "stk"
  | "eske" | "pakke" | "sekk" | "flaske" | "rull" | "spann" | "kanne" | "boks" | "brett"
  | "pall" | "palleboks" | "konteiner" | "glass" | "beger" | "tube" | "bunt" | "par" | "kolli" | "bulk";

const BASE_UNITS = new Set<CanonicalUnit>(["g", "kg", "ml", "cl", "dl", "l", "stk"]);

const PACKAGE_UNITS = new Set<CanonicalUnit>([
  "eske", "pakke", "sekk", "flaske", "rull", "spann", "kanne", "boks", "brett",
  "pall", "palleboks", "konteiner", "glass", "beger", "tube", "bunt", "par", "kolli", "bulk",
]);

/** Kanoniske pakke-enheter, i visningsrekkefølge — brukes av nedtrekkene i Råvarer. */
export const CANONICAL_PACKAGE_UNITS: CanonicalUnit[] = [
  "sekk", "eske", "pakke", "spann", "boks", "flaske", "kanne", "glass", "beger",
  "tube", "brett", "rull", "bunt", "par", "kolli", "pall", "palleboks", "konteiner", "bulk",
];

/** Kanoniske baseenheter, i visningsrekkefølge. */
export const CANONICAL_BASE_UNITS: CanonicalUnit[] = ["kg", "g", "l", "dl", "cl", "ml", "stk"];

const UNIT_ALIASES: Record<string, CanonicalUnit> = {
  // stk-familie
  stk: "stk", styk: "stk", st: "stk", stk_: "stk", pcs: "stk", pc: "stk", piece: "stk",
  pieces: "stk", ea: "stk", each: "stk", h87: "stk", c62: "stk", nar: "stk",
  // masse
  g: "g", gr: "g", gram: "g", grm: "g",
  kg: "kg", kilo: "kg", kgm: "kg", kilogram: "kg",
  // volum
  ml: "ml", mlt: "ml", milliliter: "ml",
  cl: "cl", clt: "cl", centiliter: "cl",
  dl: "dl", dlt: "dl", desiliter: "dl", deciliter: "dl",
  l: "l", lt: "l", ltr: "l", liter: "l", litre: "l",
  // pakke-familier
  esk: "eske", eske: "eske", ks: "eske", ksk: "eske", krt: "eske", krg: "eske",
  kart: "eske", kartong: "eske", bx: "eske", box: "eske", carton: "eske", ct: "eske",
  pk: "pakke", pak: "pakke", pakke: "pakke", pack: "pakke",
  pos: "sekk", pose: "sekk", poser: "sekk", sk: "sekk", sekk: "sekk", sekker: "sekk",
  bag: "sekk", bags: "sekk", sack: "sekk", sacks: "sekk",
  fl: "flaske", btl: "flaske", flaske: "flaske", bottle: "flaske",
  rl: "rull", rull: "rull", roll: "rull",
  spn: "spann", spann: "spann",
  kanne: "kanne",
  boks: "boks", can: "boks",
  brett: "brett", tray: "brett",
  // enheter som faktisk forekommer i fakturagrunnlaget vårt
  pall: "pall", pallet: "pall", plt: "pall",
  palleboks: "palleboks", pallebox: "palleboks",
  konteiner: "konteiner", container: "konteiner", cont: "konteiner",
  glass: "glass", gl: "glass",
  beger: "beger", beg: "beger",
  tube: "tube", tb: "tube",
  bunt: "bunt", bundle: "bunt",
  par: "par", pair: "par",
  kolli: "kolli", coli: "kolli",
  bulk: "bulk",
};

/** Normaliser en rå enhetskode til kanonisk form (lowercase). Returnerer null hvis ukjent. */
export function normalizeUnit(raw: string | null | undefined): CanonicalUnit | null {
  if (!raw) return null;
  const k = String(raw).trim().toLowerCase().replace(/\.$/, "");
  if (!k) return null;
  return UNIT_ALIASES[k] ?? null;
}

export function isBaseUnit(u: string | null | undefined): boolean {
  if (!u) return false;
  return BASE_UNITS.has(u as CanonicalUnit);
}

export function isPackageUnit(u: string | null | undefined): boolean {
  if (!u) return false;
  return PACKAGE_UNITS.has(u as CanonicalUnit);
}

/** Konverteringsfaktor mellom to base-enheter. Returnerer null for ukjent eller pakke-enheter. */
export function toBaseFactor(
  from: string | null | undefined,
  to: string | null | undefined,
): number | null {
  const f = normalizeUnit(from);
  const t = normalizeUnit(to);
  // Kun kanoniske enheter gir en faktor. En identitets-snarvei på ukjente strenger
  // ville stille gitt faktor 1 for f.eks. base_unit = 'sekk'.
  if (!f || !t) return null;
  if (f === t) return 1;
  // mass
  const mass: Record<string, number> = { g: 1, kg: 1000 };
  // volume
  const vol: Record<string, number> = { ml: 1, cl: 10, dl: 100, l: 1000 };
  if (f in mass && t in mass) return mass[f] / mass[t];
  if (f in vol && t in vol) return vol[f] / vol[t];
  return null;
}

export interface PackageInfo {
  /**
   * Størrelse per sub-enhet i base-enhet (f.eks. 10 for "10l", 90 for "36X90G").
   * Total pakningsstørrelse = size * count.
   */
  size: number;
  /** Base-enhet pakken er uttrykt i (kg/g/l/ml/dl/cl/stk). */
  unit: CanonicalUnit;
  /** Antall sub-pakker (f.eks. 36 for "36X90G", 12 for "12x500ml"). 1 hvis ikke spesifisert. */
  count: number;
  /** Kilden som ble matchet, for diagnostikk. */
  matched: string;
}

const SIZE_UNIT_PATTERN = "kg|kilo|gram|grm|gr|g|ml|mlt|cl|dl|liter|litre|ltr|lt|l";
const NUM_PATTERN = String.raw`\d+(?:[.,]\d+)?`;
const FRAC_PATTERN = String.raw`\d+\s*\/\s*\d+`;
const SIZE_PATTERN = `(?:${FRAC_PATTERN}|${NUM_PATTERN})`;

/** Ord som beskriver emballasje, ikke innhold — fjernes før navnesammenligning. */
const PACKAGE_WORDS = [
  "krt", "kartong", "kart", "ks", "ksk", "esk", "eske", "esker", "pk", "pak", "pakke", "pakker",
  "pose", "poser", "sekk", "sekker", "spann", "boks", "bokser", "brett", "flaske", "flasker",
  "rull", "beger", "tube", "bunt", "kolli", "pall", "stk", "emb", "kolli",
];

/** Tolk ett størrelses-token. Håndterer brøk og norsk tusenskille («1.000 kg»). */
function parseSizeToken(raw: string, unitRaw: string): number | null {
  const frac = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const n = Number(frac[1]);
    const d = Number(frac[2]);
    return d ? n / d : null;
  }
  const u = normalizeUnit(unitRaw);
  // Norsk tusenskille: nøyaktig tre siffer etter punktum, ingen komma, masse-enhet.
  // «0.500 kg» er et desimaltall (et halvt kilo), ikke 500 — tall som starter med
  // «0.» unntas derfor.
  if (/^\d{1,3}\.\d{3}$/.test(raw.trim()) && !/^0\./.test(raw.trim()) && (u === "kg" || u === "g")) {
    return Number(raw.trim().replace(".", ""));
  }
  return toNumber(raw);
}

/** Størrelsen omregnet til en felles skala, slik at flere treff kan sammenlignes. */
function magnitude(size: number, unit: CanonicalUnit): number {
  const toG = toBaseFactor(unit, "g");
  if (toG != null) return size * toG;
  const toMl = toBaseFactor(unit, "ml");
  if (toMl != null) return size * toMl;
  return size;
}

/**
 * Trekk ut den PAKNINGSDEFINERENDE størrelsen fra en norsk fakturabeskrivelse.
 * `size` er størrelsen PER sub-enhet og `count` er antall sub-enheter;
 * total pakning = size × count.
 *
 * Eksempler:
 *   "10l"                 -> { size: 10,   unit: "l",  count: 1 }
 *   "36X90G"              -> { size: 90,   unit: "g",  count: 36 }
 *   "1kg x 10"            -> { size: 1,    unit: "kg", count: 10 }
 *   "500G X 12"           -> { size: 500,  unit: "g",  count: 12 }
 *   "6 x 1/2 kg"          -> { size: 0.5,  unit: "kg", count: 6 }
 *   "10 stk à 500 g"      -> { size: 500,  unit: "g",  count: 10 }
 *   "OST 10 KG EMB 500 G" -> { size: 10,   unit: "kg", count: 1 }
 *   "MEL 1.000 KG"        -> { size: 1000, unit: "kg", count: 1 }
 */
export function parsePackageFromDescription(desc: string | null | undefined): PackageInfo | null {
  if (!desc) return null;
  const text = String(desc).replace(/\s+/g, " ").trim();
  if (!text) return null;

  const build = (
    countRaw: string | null,
    sizeRaw: string,
    unitRaw: string,
    matched: string,
  ): PackageInfo | null => {
    const size = parseSizeToken(sizeRaw, unitRaw);
    const unit = normalizeUnit(unitRaw);
    const count = countRaw != null ? toNumber(countRaw) : 1;
    if (!size || size <= 0 || !unit || !count || count <= 0) return null;
    return { size, unit, count, matched };
  };

  // 1) «10 stk à 500 g», «10 stk x 500 g», «6 pk à 1 kg»
  const stkRe = new RegExp(
    String.raw`(${NUM_PATTERN})\s*(?:stk|pk|pcs)\.?\s*(?:[x×*]|à|a)?\s*(${SIZE_PATTERN})\s*(${SIZE_UNIT_PATTERN})\b`,
    "i",
  );
  const stkM = text.match(stkRe);
  if (stkM) {
    const r = build(stkM[1], stkM[2], stkM[3], stkM[0]);
    if (r) return r;
  }

  // 2) «36X90G», «12 x 500 ML», «10 x 1 kg», «6 x 1/2 kg»
  const mulRe = new RegExp(
    String.raw`(${NUM_PATTERN})\s*(?:[x×*]|à)\s*(${SIZE_PATTERN})\s*(${SIZE_UNIT_PATTERN})\b`,
    "i",
  );
  const mulM = text.match(mulRe);
  if (mulM) {
    const r = build(mulM[1], mulM[2], mulM[3], mulM[0]);
    if (r) return r;
  }

  // 3) «1kg x 10», «500G X 12» — størrelsen først, antallet etter.
  const revRe = new RegExp(
    String.raw`(${SIZE_PATTERN})\s*(${SIZE_UNIT_PATTERN})\s*[x×*]\s*(${NUM_PATTERN})\b`,
    "i",
  );
  const revM = text.match(revRe);
  if (revM) {
    const r = build(revM[3], revM[1], revM[2], revM[0]);
    if (r) return r;
  }

  // 4) Brøk alene: «1/4l», «1/2 kg»
  const fracRe = new RegExp(String.raw`\b(${FRAC_PATTERN})\s*(${SIZE_UNIT_PATTERN})\b`, "i");
  const fracM = text.match(fracRe);
  if (fracM) {
    const r = build(null, fracM[1], fracM[2], fracM[0]);
    if (r) return r;
  }

  // 5) Enkle størrelser: velg den STØRSTE — den beskriver pakningen, mens en
  //    mindre størrelse som regel er innerpakningen («OST 10 KG EMB 500 G»).
  const singleRe = new RegExp(String.raw`(${NUM_PATTERN})\s*(${SIZE_UNIT_PATTERN})\b`, "gi");
  let best: PackageInfo | null = null;
  let bestMag = -1;
  let cur: RegExpExecArray | null;
  while ((cur = singleRe.exec(text)) !== null) {
    const r = build(null, cur[1], cur[2], cur[0]);
    if (!r) continue;
    const mag = magnitude(r.size, r.unit);
    if (mag > bestMag) {
      bestMag = mag;
      best = r;
    }
  }
  return best;
}

/**
 * Fjern pakningsinformasjon fra en beskrivelse, slik at bare varenavnet står
 * igjen («HVETEMEL 10X1KG KRT» → «hvetemel»). Brukes av matchingen når navnet
 * skal sammenlignes uten at emballasjen forstyrrer.
 */
export function stripPackageTokens(desc: string | null | undefined): string {
  if (!desc) return "";
  let s = String(desc).toLowerCase();
  s = s.replace(
    new RegExp(String.raw`(${NUM_PATTERN})\s*(?:[x×*]|à)\s*(${SIZE_PATTERN})\s*(?:${SIZE_UNIT_PATTERN})\b`, "gi"),
    " ",
  );
  s = s.replace(
    new RegExp(String.raw`(${SIZE_PATTERN})\s*(?:${SIZE_UNIT_PATTERN})\s*[x×*]\s*(${NUM_PATTERN})\b`, "gi"),
    " ",
  );
  s = s.replace(new RegExp(String.raw`(${SIZE_PATTERN})\s*(?:${SIZE_UNIT_PATTERN})\b`, "gi"), " ");
  s = s.replace(new RegExp(String.raw`\b(${NUM_PATTERN})\s*[x×*]\s*`, "gi"), " ");
  for (const w of PACKAGE_WORDS) {
    s = s.replace(new RegExp(String.raw`\b${w}\b\.?`, "gi"), " ");
  }
  return s.replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function toNumber(s: string): number | null {
  if (s == null) return null;
  const cleaned = String(s).replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/* ============================================================================
 * KOSTPRISMOTOREN
 * ----------------------------------------------------------------------------
 * Én regel, brukt overalt:
 *
 *     kostpris per baseenhet = linjens beløp ÷ mengden omregnet til baseenhet
 *
 * `unit_price` brukes ALDRI som prisgrunnlag — kun som kontrollverdi. Beløpet
 * (`total_amount`) er alltid pengene som faktisk betales.
 *
 * Mengden i baseenhet bestemmes av FAKTURAENHETEN, ikke av pakningsstørrelsen:
 *   - Fakturaenheten er samme dimensjon som basisenheten → ren enhetsomregning.
 *     Pakningsstørrelsen skal da IKKE brukes.
 *   - Fakturaenheten er en pakning (sekk/eske/pall …) eller krysser dimensjon
 *     (f.eks. «stk» mot basisenhet kg) → gang med innholdet per pakning.
 * ==========================================================================*/

/** Hvor pakningsinformasjonen ble hentet fra. */
export type PackageSource =
  | "rms_confirmed"
  | "rms_package"
  | "line"
  | "description"
  | "raw_material";

export type CostBasis = "fakturaenhet" | "pakning";

export interface PackageResolution {
  /** Antall baseenheter i én pakning (f.eks. 25 når basisenhet er kg og pakningen er en 25 kg sekk). */
  baseUnitsPerPackage: number;
  source: PackageSource;
  /** Enheten pakningen er uttrykt i på kilden, for forklaringen. */
  packageUnitLabel: string | null;
  /**
   * Satt når en UBEKREFTET leverandørpakning er uenig med beskrivelsen og
   * beskrivelsen vant. Brukes til å senke tilliten og forklare valget.
   */
  disagreement?: {
    supplierUnits: number;
    supplierUnitLabel: string | null;
    descriptionUnits: number;
  } | null;
  /** Satt når leverandørens `package_size = 1` med pakke-enhet ble forkastet som «ikke satt». */
  ignoredSupplierOne?: boolean;
  /**
   * Satt når pakningen IKKE kan avgjøres maskinelt og et menneske må inn:
   * bekreftet «1 pakning» uten innhold, eller uenighet mellom kilder.
   */
  unresolved?: { reason: string } | null;
}


export interface CostCandidate {
  basis: CostBasis;
  baseQuantity: number;
  pricePerBaseUnit: number;
  baseUnitsPerPackage: number | null;
  packageCount: number | null;
  source: PackageSource | null;
  explanation: string;
}

export interface CostChecks {
  /** beløp ≈ quantity × unit_price → unit_price er per fakturaenhet. */
  arithmeticPerInvoiceUnit: boolean;
  /** beløp ≈ quantity × innhold per pakning × unit_price → antall i pakninger, pris per baseenhet. */
  arithmeticPerBaseUnit: boolean;
  /** baseQuantity ÷ innhold per pakning går opp i et helt tall. */
  wholePackages: boolean;
  /** Resultatet ligger nær kjent historikk. */
  matchesHistory: boolean | null;
  /** Resultatet ligger nær historikk × eller ÷ innhold per pakning — tegn på feil kandidat. */
  historyOffByPackage: boolean;
}

export interface ResolveLineCostResult extends CostCandidate {
  /** Beløpet som ble brukt som prisgrunnlag. */
  amount: number | null;
  amountSource: "total_amount" | "quantity_x_unit_price" | null;
  confidence: number;
  confidenceLevel: "high" | "medium" | "low";
  checks: CostChecks;
  /** Forkastede tolkninger, slik at brukeren kan velge om. */
  alternatives: CostCandidate[];
  /** Satt når motoren ikke kan avgjøre. Da er alle tallene 0/NaN-frie, men ugyldige. */
  needsInput: "package_size" | "amount" | "base_unit" | null;
  /** Norsk begrunnelse — kan vises rått i grensesnittet. */
  reason: string | null;
}

export interface ResolveLineCostInput {
  quantity: number | null | undefined;
  unit: string | null | undefined;
  unitPrice?: number | null;
  totalAmount?: number | null;
  /** Linjens pakningsfelter. `packageSize` er PER sub-enhet. */
  packageSize?: number | null;
  packageUnit?: string | null;
  countPerPackage?: number | null;
  description?: string | null;
  /** Varens basisenhet (kg/l/stk …). */
  baseUnit: string | null | undefined;
  /** Kjent pakning fra leverandørkoblingen (raw_material_suppliers). */
  supplierPackage?: {
    baseUnitsPerPackage?: number | null;
    packageSize?: number | null;
    packageUnit?: string | null;
    packageConfirmedAt?: string | null;
  } | null;
  /** Kjent pakning på varen selv (raw_materials). */
  rawMaterialPackage?: {
    baseUnitsPerPackage?: number | null;
    packageSize?: number | null;
    packageUnit?: string | null;
  } | null;
  /** Historisk pris per baseenhet — brukes kun som rimelighetssjekk. */
  knownPricePerBaseUnit?: number | null;
}

const PLURALS: Record<string, string> = {
  sekk: "sekker",
  eske: "esker",
  pakke: "pakker",
  flaske: "flasker",
  rull: "ruller",
  spann: "spann",
  kanne: "kanner",
  boks: "bokser",
  brett: "brett",
  pall: "paller",
  palleboks: "palleboks",
  konteiner: "konteinere",
  glass: "glass",
  beger: "begre",
  tube: "tuber",
  bunt: "bunter",
  par: "par",
  kolli: "kolli",
  bulk: "bulk",
  stk: "stk",
};

function plural(unit: string | null, count: number): string {
  if (!unit) return "pakninger";
  if (count === 1) return unit;
  return PLURALS[unit] ?? unit;
}

/**
 * Tolk et tall brukeren har skrevet. Godtar både komma og punktum som
 * desimalskilletegn, og mellomrom som tusenskille. Returnerer null når
 * inndata er tom eller ikke lar seg tolke — ALDRI NaN.
 */
export function parseDecimal(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const cleaned = input.replace(/\s|\u00a0/g, "").replace(",", ".");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Norsk tallformat uten unødvendige desimaler. */
export function fmtNum(n: number, maxDigits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: maxDigits }).format(n);
}

function nearlyEqual(a: number, b: number, tolPct = 1.5): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (b === 0) return Math.abs(a) < 1e-9;
  return Math.abs((a - b) / b) * 100 <= tolPct;
}

function isWhole(n: number, tol = 0.02): boolean {
  if (!Number.isFinite(n) || n <= 0) return false;
  return Math.abs(n - Math.round(n)) <= tol;
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Total pakningsstørrelse fra en fakturalinje, uttrykt i pakningsenheten.
 * `invoice_lines.package_size` er PER sub-enhet — den må ganges med
 * `count_per_package` for å bli TOTAL, slik `raw_material_suppliers.package_size`
 * leses. Brukes av både match-skuffen og masse-godkjenningen.
 */
export function deriveLinePackage(line: {
  package_size?: number | null;
  package_unit?: string | null;
  count_per_package?: number | null;
  description?: string | null;
}): { size: number; unit: CanonicalUnit; source: "line" | "description" } | null {
  const size = toNum(line.package_size);
  const unit = normalizeUnit(line.package_unit);
  if (size && size > 0 && unit && isBaseUnit(unit)) {
    const cnt = toNum(line.count_per_package);
    const mult = cnt && cnt > 0 ? cnt : 1;
    return { size: size * mult, unit, source: "line" };
  }
  const parsed = parsePackageFromDescription(line.description);
  if (parsed) return { size: parsed.size * (parsed.count || 1), unit: parsed.unit, source: "description" };
  return null;
}

/** Innhold per pakning i baseenheter, hentet i prioritert rekkefølge. */
export function resolvePackageContent(input: ResolveLineCostInput): PackageResolution | null {
  const base = normalizeUnit(input.baseUnit) ?? (input.baseUnit ?? "").toLowerCase();
  if (!base) return null;

  const fromSizeUnit = (
    size: number | null,
    unit: string | null | undefined,
    source: PackageSource,
  ): PackageResolution | null => {
    if (!size || size <= 0) return null;
    const u = normalizeUnit(unit) ?? (unit ?? "").toLowerCase();
    if (!u) return null;
    const f = toBaseFactor(u, base);
    if (f == null) return null;
    return { baseUnitsPerPackage: size * f, source, packageUnitLabel: u };
  };

  const sp = input.supplierPackage;
  const spUnitRaw = sp?.packageUnit ?? null;
  const spUnit = normalizeUnit(spUnitRaw) ?? (spUnitRaw ? String(spUnitRaw).toLowerCase() : null);
  const spSize = toNum(sp?.packageSize);
  const confirmed = toNum(sp?.baseUnitsPerPackage);
  const isConfirmed = !!sp?.packageConfirmedAt;

  // Beskrivelsen tolkes alltid — den brukes både som fallback og som kontroll
  // mot en ubekreftet leverandørpakning.
  const parsed = parsePackageFromDescription(input.description);
  const fromDesc = parsed
    ? fromSizeUnit(parsed.size * (parsed.count || 1), parsed.unit, "description")
    : null;

  // Når basisenheten er «stk», er innholdet ANTALLET sub-enheter i pakningen —
  // ikke kilo eller liter. «10 x 1 kg» i en kartong er 10 stk.
  const piecesPerPackage = (count: number | null, source: PackageSource): PackageResolution | null => {
    if (base !== "stk") return null;
    if (!count || count <= 0) return null;
    return { baseUnitsPerPackage: count, source, packageUnitLabel: "stk" };
  };
  const descPieces = piecesPerPackage(parsed?.count ?? null, "description");
  const linePieces = piecesPerPackage(toNum(input.countPerPackage), "line");

  // 1) Bekreftet av bruker på leverandørkoblingen — høyest tillit, alltid vinner.
  if (isConfirmed) {
    if (confirmed && confirmed > 0) {
      return { baseUnitsPerPackage: confirmed, source: "rms_confirmed", packageUnitLabel: spUnit };
    }
    if (spSize && spSize > 0) {
      const r = fromSizeUnit(spSize, spUnitRaw, "rms_confirmed");
      if (r) return r;
      // Bekreftet «1 sekk» uten innhold per pakning sier ingenting om hvor mange
      // baseenheter sekken rommer — det må et menneske fylle inn.
      if (spSize === 1 && isPackageUnit(spUnit)) {
        return {
          baseUnitsPerPackage: 0,
          source: "rms_confirmed",
          packageUnitLabel: spUnit,
          unresolved: {
            reason:
              `Leverandørkoblingen er bekreftet med 1 ${spUnit} per pakning, men uten innhold per pakning. ` +
              `Fyll inn hvor mange ${base} én ${spUnit} inneholder.`,
          },
        };
      }
      // Bekreftet størrelse oppgitt i en pakke-enhet: da er tallet innholdet i baseenheter.
      return { baseUnitsPerPackage: spSize, source: "rms_confirmed", packageUnitLabel: spUnit };
    }
  }

  // Regel 1: en UBEKREFTET `package_size = 1` med pakke-enhet er en selvmotsigelse
  // («én sekk er aldri ett kilo») — en gammel standardverdi, ikke data.
  const bogusOne = !isConfirmed && spSize === 1 && isPackageUnit(spUnit);

  // 2) Leverandørkoblingens pakningsstørrelse.
  let fromRms: PackageResolution | null = bogusOne
    ? null
    : fromSizeUnit(spSize, spUnitRaw, "rms_package");
  if (!bogusOne && !fromRms && confirmed && confirmed > 0) {
    fromRms = { baseUnitsPerPackage: confirmed, source: "rms_package", packageUnitLabel: spUnit };
  }

  // Regel 2: ubekreftet leverandørpakning som er uenig med varenavnet med mer enn
  // en faktor 1,5. Da vet vi ikke hvilken som stemmer — et menneske må avgjøre.
  if (fromRms && fromDesc) {
    const a = fromRms.baseUnitsPerPackage;
    const b = fromDesc.baseUnitsPerPackage;
    if (a > 0 && b > 0 && Math.max(a / b, b / a) > 1.5) {
      return {
        ...fromDesc,
        disagreement: { supplierUnits: a, supplierUnitLabel: fromRms.packageUnitLabel, descriptionUnits: b },
        unresolved: {
          reason:
            `Leverandørkoblingen sier ${fmtNum(a)} ${fromRms.packageUnitLabel ?? base} per pakning, ` +
            `men varenavnet sier ${fmtNum(b)} ${base}. Bekreft pakningen før prisen kan brukes.`,
        },
      };
    }
  }
  if (fromRms) return fromRms;

  // 3) Linjens egne felter (package_size × count_per_package).
  const lineSize = toNum(input.packageSize);
  if (lineSize && lineSize > 0) {
    const cnt = toNum(input.countPerPackage);
    const mult = cnt && cnt > 0 ? cnt : 1;
    const r = fromSizeUnit(lineSize * mult, input.packageUnit, "line");
    if (r) return bogusOne ? { ...r, ignoredSupplierOne: true } : r;
  }
  if (linePieces) return bogusOne ? { ...linePieces, ignoredSupplierOne: true } : linePieces;

  // 4) Tolket fra beskrivelsen.
  if (fromDesc) return bogusOne ? { ...fromDesc, ignoredSupplierOne: true } : fromDesc;
  if (descPieces) return bogusOne ? { ...descPieces, ignoredSupplierOne: true } : descPieces;

  // 5) Varens egen pakning.
  const rmp = input.rawMaterialPackage;
  const rmUnits = toNum(rmp?.baseUnitsPerPackage);
  if (rmUnits && rmUnits > 0) {
    return {
      baseUnitsPerPackage: rmUnits,
      source: "raw_material",
      packageUnitLabel: normalizeUnit(rmp?.packageUnit) ?? rmp?.packageUnit ?? null,
    };
  }
  const fromRm = fromSizeUnit(toNum(rmp?.packageSize), rmp?.packageUnit, "raw_material");
  if (fromRm) return fromRm;

  return null;
}

function emptyResult(needsInput: ResolveLineCostResult["needsInput"], reason: string, checks: CostChecks): ResolveLineCostResult {
  return {
    basis: "fakturaenhet",
    baseQuantity: 0,
    pricePerBaseUnit: 0,
    baseUnitsPerPackage: null,
    packageCount: null,
    source: null,
    explanation: reason,
    amount: null,
    amountSource: null,
    confidence: 0,
    confidenceLevel: "low",
    checks,
    alternatives: [],
    needsInput,
    reason,
  };
}

/**
 * Beregn kostpris per baseenhet for en fakturalinje.
 * Dette er den ENESTE kostprisberegningen i systemet — ingen andre steder
 * skal dele `unit_price` på noe som helst.
 */
export function resolveLineCost(input: ResolveLineCostInput): ResolveLineCostResult {
  const checks: CostChecks = {
    arithmeticPerInvoiceUnit: false,
    arithmeticPerBaseUnit: false,
    wholePackages: false,
    matchesHistory: null,
    historyOffByPackage: false,
  };

  const quantity = toNum(input.quantity);
  const base = normalizeUnit(input.baseUnit) ?? (input.baseUnit ?? "").toLowerCase();
  if (!base) {
    return emptyResult("base_unit", "Varen mangler basisenhet, så kostprisen kan ikke regnes ut.", checks);
  }
  if (!quantity || quantity <= 0) {
    return emptyResult("amount", "Fakturalinjen mangler mengde, så kostprisen kan ikke regnes ut.", checks);
  }

  const unitPrice = toNum(input.unitPrice);
  const total = toNum(input.totalAmount);

  // 1) Beløp
  let amount: number | null = null;
  let amountSource: ResolveLineCostResult["amountSource"] = null;
  let amountPenalty = 0;
  if (total != null && total !== 0) {
    amount = total; // behold fortegn — negativt beløp = kreditnota
    amountSource = "total_amount";
  } else if (unitPrice != null) {
    amount = quantity * unitPrice;
    amountSource = "quantity_x_unit_price";
    amountPenalty = 0.2;
  }
  if (amount == null || amount === 0) {
    return emptyResult("amount", "Fakturalinjen mangler beløp, så kostprisen kan ikke regnes ut.", checks);
  }

  const invoiceUnit = normalizeUnit(input.unit);
  const pkg = resolvePackageContent(input);
  const bupp = pkg?.unresolved ? null : (pkg?.baseUnitsPerPackage ?? null);

  // 2) Kandidater
  const candidates: CostCandidate[] = [];

  // A — fakturaenhet: gyldig når enheten er en baseenhet i samme dimensjon.
  const directFactor = invoiceUnit && isBaseUnit(invoiceUnit) ? toBaseFactor(invoiceUnit, base) : null;

  // Uavklart pakning: når fakturaenheten ikke kan regnes direkte om til
  // basisenheten, må et menneske inn — vi gjetter aldri.
  if (pkg?.unresolved && (directFactor == null || directFactor <= 0)) {
    return emptyResult("package_size", pkg.unresolved.reason, checks);
  }

  if (directFactor != null && directFactor > 0) {
    const baseQty = quantity * directFactor;
    const price = amount / baseQty;
    const perUnit = amount / quantity;
    candidates.push({
      basis: "fakturaenhet",
      baseQuantity: baseQty,
      pricePerBaseUnit: price,
      baseUnitsPerPackage: bupp,
      packageCount: bupp && bupp > 0 ? baseQty / bupp : null,
      source: null,
      explanation:
        `${fmtNum(quantity)} ${invoiceUnit} à ${fmtNum(perUnit)} kr = ${fmtNum(amount)} kr` +
        ` → ${fmtNum(price, 4)} kr/${base}`,
    });
  }

  // B — pakning: gyldig når vi kjenner innholdet per pakning.
  if (bupp && bupp > 0) {
    const baseQty = quantity * bupp;
    const price = amount / baseQty;
    const label = plural(invoiceUnit && !isBaseUnit(invoiceUnit) ? invoiceUnit : (pkg?.packageUnitLabel && !isBaseUnit(pkg.packageUnitLabel) ? pkg.packageUnitLabel : "pakning"), quantity);
    candidates.push({
      basis: "pakning",
      baseQuantity: baseQty,
      pricePerBaseUnit: price,
      baseUnitsPerPackage: bupp,
      packageCount: quantity,
      source: pkg!.source,
      explanation:
        `${fmtNum(quantity)} ${label} × ${fmtNum(bupp)} ${base} = ${fmtNum(baseQty)} ${base}` +
        ` → ${fmtNum(price, 4)} kr/${base}`,
    });
  }

  if (candidates.length === 0) {
    const unitTxt = invoiceUnit ?? (input.unit ?? "ukjent enhet");
    return emptyResult(
      "package_size",
      `Fakturaen er i ${unitTxt}. Hvor mange ${base} er én ${unitTxt}? Uten innholdet per pakning kan ikke kostprisen regnes ut.`,
      checks,
    );
  }

  const candA = candidates.find((c) => c.basis === "fakturaenhet") ?? null;
  const candB = candidates.find((c) => c.basis === "pakning") ?? null;

  // 3) Kontroller
  if (unitPrice != null) {
    checks.arithmeticPerInvoiceUnit = nearlyEqual(quantity * unitPrice, amount);
    if (bupp && bupp > 0) {
      checks.arithmeticPerBaseUnit = nearlyEqual(quantity * bupp * unitPrice, amount);
    }
  }

  // 4) Velg kandidat
  let chosen: CostCandidate = candA ?? candB!;
  let swapNote: string | null = null;

  const crossesDimension = !invoiceUnit || !isBaseUnit(invoiceUnit) || directFactor == null;
  if (crossesDimension && candB) chosen = candB;

  // Sterkt bevis for pakning: antallet er i pakninger og unit_price er per baseenhet.
  if (candB && checks.arithmeticPerBaseUnit && !checks.arithmeticPerInvoiceUnit && chosen !== candB) {
    chosen = candB;
    swapNote = "Antallet er i pakninger mens enhetsprisen er per baseenhet — regnestykket på fakturaen bekrefter det.";
  }

  // Historikk avgjør ved tvil.
  const known = toNum(input.knownPricePerBaseUnit);
  if (known && known > 0) {
    const rel = (p: number) => Math.abs(p - known) / known;
    checks.matchesHistory = rel(chosen.pricePerBaseUnit) <= 0.35;
    if (!checks.matchesHistory) {
      const other = chosen === candA ? candB : candA;
      if (bupp && bupp > 0) {
        const off =
          nearlyEqual(chosen.pricePerBaseUnit, known * bupp, 35) ||
          nearlyEqual(chosen.pricePerBaseUnit, known / bupp, 35);
        checks.historyOffByPackage = off;
      }
      if (other && rel(other.pricePerBaseUnit) < rel(chosen.pricePerBaseUnit) && rel(other.pricePerBaseUnit) <= 0.35) {
        swapNote =
          `Historikken ligger på ${fmtNum(known, 4)} kr/${base}. Den andre tolkningen treffer den, så den er valgt.`;
        chosen = other;
        checks.matchesHistory = true;
        checks.historyOffByPackage = true;
      }
    }
  }

  if (chosen.baseUnitsPerPackage && chosen.baseUnitsPerPackage > 0) {
    checks.wholePackages = isWhole(chosen.baseQuantity / chosen.baseUnitsPerPackage);
  }

  // 5) Tillit
  let confidence = 0.6;
  if (chosen.basis === "fakturaenhet" && checks.arithmeticPerInvoiceUnit) confidence = 0.95;
  else if (chosen.basis === "pakning" && checks.arithmeticPerBaseUnit) confidence = 0.95;
  else if (chosen.basis === "pakning" && chosen.source === "rms_confirmed") confidence = 0.9;
  else if (chosen.basis === "pakning" && checks.arithmeticPerInvoiceUnit) confidence = 0.8;
  else if (chosen.basis === "fakturaenhet" && !candB) confidence = 0.85;

  if (chosen.basis === "pakning" && chosen.source === "description") confidence -= 0.1;
  if (checks.matchesHistory === true) confidence = Math.min(1, confidence + 0.05);
  if (checks.matchesHistory === false) confidence -= 0.3;
  if (chosen.baseUnitsPerPackage && !checks.wholePackages && chosen.basis === "fakturaenhet") confidence -= 0.05;

  // Uenighet mellom en ubekreftet leverandørpakning og varenavnet: beskrivelsen
  // ble brukt, men resultatet må bekreftes av et menneske.
  let packageNote: string | null = null;
  if (pkg?.disagreement && chosen.basis === "pakning") {
    const d = pkg.disagreement;
    packageNote =
      `Leverandørkoblingen sier ${fmtNum(d.supplierUnits)} ${d.supplierUnitLabel ?? base} per pakning, ` +
      `men varenavnet sier ${fmtNum(d.descriptionUnits)} ${base} — bruker ${fmtNum(d.descriptionUnits)} ${base}. Bekreft pakningen.`;
    confidence = Math.min(confidence, 0.7);
  } else if (pkg?.ignoredSupplierOne && chosen.basis === "pakning") {
    packageNote =
      `Leverandørkoblingen står oppført med 1 ${pkg.packageUnitLabel ?? "pakning"} per pakning, som ikke kan stemme — ` +
      `bruker ${fmtNum(chosen.baseUnitsPerPackage ?? 0)} ${base} fra varenavnet. Bekreft pakningen.`;
    confidence = Math.min(confidence, 0.7);
  }

  confidence = Math.max(0, Math.min(1, confidence - amountPenalty));

  const alternatives = candidates.filter((c) => c !== chosen);
  let explanation = chosen.explanation;

  if (chosen.basis === "fakturaenhet" && chosen.baseUnitsPerPackage && checks.wholePackages) {
    const count = Math.round(chosen.baseQuantity / chosen.baseUnitsPerPackage);
    explanation += ` (= ${count} ${plural(pkg?.packageUnitLabel && !isBaseUnit(pkg.packageUnitLabel) ? pkg.packageUnitLabel : "pakning", count)})`;
  }
  if (packageNote) explanation += ` ${packageNote}`;
  if (swapNote) explanation += ` ${swapNote}`;

  return {
    ...chosen,
    explanation,
    amount,
    amountSource,
    confidence,
    confidenceLevel: confidence >= 0.8 ? "high" : confidence >= 0.55 ? "medium" : "low",
    checks,
    alternatives,
    needsInput: null,
    reason: packageNote ?? swapNote,

  };
}
