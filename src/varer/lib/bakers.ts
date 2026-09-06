/**
 * Bakerfaglig beregningsmotor — bakerprosent, hydrering og deigtemperatur.
 * Rene funksjoner, ingen side-effekter.
 */

export type PartType =
  | "dough"
  | "preferment"
  | "soaker"
  | "filling"
  | "topping"
  | "finish"
  | "other";

export const PART_TYPE_OPTIONS: { value: PartType; label: string }[] = [
  { value: "dough", label: "Deig" },
  { value: "preferment", label: "Fordeig" },
  { value: "soaker", label: "Bløtlegging / skoldning" },
  { value: "filling", label: "Fyll" },
  { value: "topping", label: "Topping" },
  { value: "finish", label: "Etterarbeid" },
  { value: "other", label: "Annet" },
];

export const PREFERMENT_KIND_OPTIONS = [
  { value: "fordeig", label: "Fordeig" },
  { value: "poolish", label: "Poolish" },
  { value: "biga", label: "Biga" },
  { value: "surdeig", label: "Surdeig" },
  { value: "levain", label: "Levain" },
  { value: "autolyse", label: "Autolyse" },
  { value: "skoldning", label: "Skoldning" },
] as const;
export type PrefermentKind = (typeof PREFERMENT_KIND_OPTIONS)[number]["value"];

export type StepType =
  | "autolyse" | "mix" | "bulk" | "fold" | "divide" | "preshape" | "rest"
  | "shape" | "proof" | "retard" | "score" | "bake" | "steam" | "cool"
  | "finish" | "other";

export const STEP_TYPE_OPTIONS: { value: StepType; label: string }[] = [
  { value: "autolyse", label: "Autolyse" },
  { value: "mix", label: "Elting" },
  { value: "bulk", label: "Bulkheving" },
  { value: "fold", label: "Bretting" },
  { value: "divide", label: "Deling" },
  { value: "preshape", label: "Forming" },
  { value: "rest", label: "Hvile" },
  { value: "shape", label: "Utbaking" },
  { value: "proof", label: "Rasking" },
  { value: "retard", label: "Kaldheving" },
  { value: "score", label: "Snitting" },
  { value: "bake", label: "Steking" },
  { value: "steam", label: "Damp" },
  { value: "cool", label: "Avkjøling" },
  { value: "finish", label: "Etterarbeid" },
  { value: "other", label: "Annet" },
];

export const STEP_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  STEP_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

export const RECIPE_STATUS_OPTIONS = [
  { value: "draft", label: "Utkast" },
  { value: "active", label: "Aktiv" },
  { value: "archived", label: "Arkivert" },
] as const;
export const RECIPE_STATUS_LABEL: Record<string, string> = {
  draft: "Utkast",
  active: "Aktiv",
  archived: "Arkivert",
};

/** Standardkjede for brød. */
export const BREAD_DEFAULT_STEPS: { step_type: StepType; title: string }[] = [
  { step_type: "autolyse", title: "Autolyse" },
  { step_type: "mix", title: "Elting" },
  { step_type: "bulk", title: "Bulkheving" },
  { step_type: "fold", title: "Bretting" },
  { step_type: "divide", title: "Deling" },
  { step_type: "preshape", title: "Forming" },
  { step_type: "proof", title: "Rasking" },
  { step_type: "bake", title: "Steking" },
  { step_type: "cool", title: "Avkjøling" },
];

// ===== Enheter =====

/** Kanoniske enheter oppskriftslinjer kan bruke. */
export type RecipeUnit = "g" | "kg" | "ml" | "cl" | "dl" | "l" | "stk";

const RECIPE_UNIT_ALIASES: Record<string, RecipeUnit> = {
  g: "g", gr: "g", gram: "g", grm: "g",
  kg: "kg", kilo: "kg", kilogram: "kg",
  ml: "ml", milliliter: "ml",
  cl: "cl", centiliter: "cl",
  dl: "dl", desiliter: "dl", deciliter: "dl",
  l: "l", lt: "l", ltr: "l", liter: "l", litre: "l",
  stk: "stk", st: "stk", stykk: "stk", pcs: "stk", pc: "stk",
};

/** Normaliserer en enhetstekst. Returnerer null for ukjente enheter. */
export function normalizeRecipeUnit(unit: string | null | undefined): RecipeUnit | null {
  if (!unit) return null;
  const k = String(unit).trim().toLowerCase().replace(/\.$/, "");
  return RECIPE_UNIT_ALIASES[k] ?? null;
}

const ML_PER_UNIT: Record<string, number> = { ml: 1, cl: 10, dl: 100, l: 1000 };

export interface GramsResult {
  grams: number;
  /** Usann når vekten er anslått eller ukjent — da er beregningen ufullstendig. */
  exact: boolean;
  /** Forklaring som kan vises i grensesnittet når `exact` er usann. */
  reason?: string;
}

export interface ConvertOptions {
  /** Tetthet i g/ml, når den er kjent for råvaren. */
  densityGPerMl?: number | null;
  /** Vekt per stykk i gram, når den er kjent. */
  pieceWeightG?: number | null;
}

/**
 * Regner en mengde om til gram.
 * Volum uten kjent tetthet og «stk» uten stykkvekt gir aldri en stille nullvekt —
 * resultatet merkes som ufullstendig med en forklaring.
 */
export function convertToGrams(
  quantity: number | string,
  unit: string,
  opts: ConvertOptions = {},
): GramsResult {
  const q = Number(quantity) || 0;
  const u = normalizeRecipeUnit(unit);
  if (!u) return { grams: 0, exact: false, reason: `Ukjent enhet «${unit}»` };
  if (u === "g") return { grams: q, exact: true };
  if (u === "kg") return { grams: q * 1000, exact: true };
  if (u === "stk") {
    const w = Number(opts.pieceWeightG) || 0;
    if (w > 0) return { grams: q * w, exact: true };
    return { grams: 0, exact: false, reason: "Mangler vekt per stykk" };
  }
  const ml = q * ML_PER_UNIT[u];
  const d = Number(opts.densityGPerMl) || 0;
  if (d > 0) return { grams: ml * d, exact: true };
  // Vi regner videre med vann-tetthet så beregningen ikke kollapser til null,
  // men markerer den som anslått.
  return { grams: ml, exact: false, reason: "Tetthet mangler — regnet som vann (1 g/ml)" };
}

/** Konverterer en linjemengde til gram. Ufullstendige omregninger fanges av `convertToGrams`. */
export function toGrams(quantity: number | string, unit: string, opts: ConvertOptions = {}): number {
  return convertToGrams(quantity, unit, opts).grams;
}

export function fromGrams(grams: number, unit: string, opts: ConvertOptions = {}): number {
  const u = normalizeRecipeUnit(unit);
  if (!u) return grams;
  if (u === "kg") return grams / 1000;
  if (u === "g") return grams;
  if (u === "stk") {
    const w = Number(opts.pieceWeightG) || 0;
    return w > 0 ? grams / w : 0;
  }
  const d = Number(opts.densityGPerMl) || 1;
  return grams / d / ML_PER_UNIT[u];
}

/** Omregning for en oppskriftslinje, med råvarens tetthet/stykkvekt når den finnes. */
export function lineToGrams(line: BakersLine): GramsResult {
  return convertToGrams(line.quantity, line.unit, {
    densityGPerMl: line._rm?.density_g_per_ml ?? null,
    pieceWeightG: line._rm?.weight_per_piece_g ?? null,
  });
}

// ===== Klassifisering =====

export interface BakersRawMaterial {
  id: string;
  name: string;
  category?: string | null;
  grain_classification?: string | null;
  water_content_pct?: number | null;
  current_cost_price?: number | null;
  is_composite?: boolean | null;
  /** Satt når råvaren er en grunnoppskrift/halvfabrikat produsert av en oppskrift. */
  produced_by_recipe_id?: string | null;
  /** Tetthet i g/ml, når den er registrert. Brukes for volumenheter. */
  density_g_per_ml?: number | null;
  /** Vekt per stykk i gram, når den er registrert. Brukes for «stk». */
  weight_per_piece_g?: number | null;
}


export interface BakersLine {
  id: string;
  recipe_part_id: string;
  raw_material_id: string | null;
  sub_product_id?: string | null;
  ingredient_name?: string | null;
  quantity: number | string;
  unit: string;
  bakers_percent?: number | string | null;
  is_flour_override?: boolean | null;
  water_content_pct_override?: number | string | null;
  entry_mode?: string;
  _rm?: BakersRawMaterial | null;
  /** Låst bakerprosent for visning — brukes i skalert visning så prosenten aldri flytter seg. */
  _displayPercent?: number | null;
}

/** Alt korn unntatt `not_grain` teller som mel. Linjeoverstyring vinner. */
export function isFlourLine(line: BakersLine): boolean {
  if (line.is_flour_override != null) return !!line.is_flour_override;
  const g = line._rm?.grain_classification;
  return !!g && g !== "not_grain";
}

/** Vanninnhold i prosent for linjen (override → råvare → navnegjetning). */
export function waterPctForLine(line: BakersLine): number {
  if (line.water_content_pct_override != null && line.water_content_pct_override !== "") {
    return Number(line.water_content_pct_override) || 0;
  }
  const rm = line._rm;
  if (rm?.water_content_pct != null) return Number(rm.water_content_pct) || 0;
  const name = (rm?.name ?? line.ingredient_name ?? "").toLowerCase();
  if (/\bvann\b|water/.test(name)) return 100;
  return 0;
}

const SALT_RE = /\bsalt\b/i;
const LEAVEN_RE = /gj(æ|ae)r|surdeig|levain|yeast|poolish|biga/i;

function lineName(line: BakersLine): string {
  return line._rm?.name ?? line.ingredient_name ?? "";
}

export function isSaltLine(line: BakersLine): boolean {
  return SALT_RE.test(lineName(line));
}

export function isLeavenLine(line: BakersLine): boolean {
  return LEAVEN_RE.test(lineName(line));
}

// ===== Samlede beregninger =====

export interface BakersTotals {
  totalFlourG: number;
  totalWaterG: number;
  totalDoughG: number;
  hydrationPct: number;
  saltPct: number;
  leavenPct: number;
  unitCount: number | null;
  doughPerUnitG: number | null;
  /** Linjer som ikke kunne regnes om nøyaktig — beregningen er da ufullstendig. */
  warnings: string[];
  incomplete: boolean;
}

export function computeTotals(lines: BakersLine[], unitWeightGrams?: number | null): BakersTotals {
  let totalFlourG = 0;
  let totalWaterG = 0;
  let totalDoughG = 0;
  let saltG = 0;
  let leavenG = 0;

  const warnings: string[] = [];
  for (const l of lines) {
    const conv = lineToGrams(l);
    const g = conv.grams;
    if (!conv.exact) {
      warnings.push(`${l.ingredient_name ?? l._rm?.name ?? "Ukjent råvare"}: ${conv.reason ?? "ufullstendig omregning"}`);
    }
    totalDoughG += g;
    if (isFlourLine(l)) totalFlourG += g;
    totalWaterG += (g * waterPctForLine(l)) / 100;
    if (isSaltLine(l)) saltG += g;
    if (isLeavenLine(l)) leavenG += g;
  }

  const pct = (v: number) => (totalFlourG > 0 ? (v / totalFlourG) * 100 : 0);
  const uw = Number(unitWeightGrams) || 0;

  return {
    totalFlourG,
    totalWaterG,
    totalDoughG,
    hydrationPct: pct(totalWaterG),
    saltPct: pct(saltG),
    leavenPct: pct(leavenG),
    unitCount: uw > 0 ? Math.floor(totalDoughG / uw) : null,
    doughPerUnitG: uw > 0 ? uw : null,
    warnings,
    incomplete: warnings.length > 0,
  };
}

/** Oppsummering for én del (typisk fordeig). */
export function computePartSummary(partLines: BakersLine[], totalFlourG: number) {
  let flourG = 0;
  let waterG = 0;
  let totalG = 0;
  for (const l of partLines) {
    const g = lineToGrams(l).grams;
    totalG += g;
    if (isFlourLine(l)) flourG += g;
    waterG += (g * waterPctForLine(l)) / 100;
  }
  return {
    flourG,
    waterG,
    totalG,
    hydrationPct: flourG > 0 ? (waterG / flourG) * 100 : 0,
    prefermentedFlourPct: totalFlourG > 0 ? (flourG / totalFlourG) * 100 : 0,
  };
}

/** Bakerprosent for én linje gitt samlet melvekt. */
export function bakersPercentFor(line: BakersLine, totalFlourG: number): number {
  if (totalFlourG <= 0) return 0;
  return (lineToGrams(line).grams / totalFlourG) * 100;
}

/** Gram fra bakerprosent. */
export function gramsFromPercent(percent: number, totalFlourG: number): number {
  return (Number(percent) || 0) * totalFlourG / 100;
}

// ===== Deigtemperatur =====

export interface DoughTempInput {
  targetDoughTemp: number;
  roomTemp: number;
  flourTemp: number;
  frictionFactor: number;
  prefermentTemp?: number | null;
}

export interface DoughTempResult {
  factors: number;
  waterTemp: number;
  feasible: boolean;
  message: string;
}

export function calcWaterTemp(input: DoughTempInput): DoughTempResult {
  const hasPreferment = input.prefermentTemp != null && !Number.isNaN(Number(input.prefermentTemp));
  const factors = hasPreferment ? 4 : 3;
  const sum =
    (Number(input.roomTemp) || 0) +
    (Number(input.flourTemp) || 0) +
    (Number(input.frictionFactor) || 0) +
    (hasPreferment ? Number(input.prefermentTemp) : 0);
  const waterTemp = (Number(input.targetDoughTemp) || 0) * factors - sum;
  const feasible = waterTemp >= 0 && waterTemp <= 60;
  const message = feasible
    ? `Bruk vann på ${waterTemp.toFixed(1)} °C for å treffe ${Number(input.targetDoughTemp).toFixed(1)} °C deigtemperatur.`
    : waterTemp < 0
      ? "Vanntemperaturen blir under 0 °C — ikke praktisk oppnåelig. Bruk isvann og senk romtemperaturen, eller juster ønsket deigtemperatur."
      : "Vanntemperaturen blir over 60 °C — ikke praktisk oppnåelig. Varm opp melet eller rommet, eller juster ønsket deigtemperatur.";
  return { factors, waterTemp, feasible, message };
}

// ===== Skalering =====

/**
 * Avrunder til noe en baker faktisk kan veie.
 * > 1000 g → nærmeste 10 g · 100–1000 g → nærmeste 5 g
 * < 100 g → nærmeste 1 g · < 10 g → én desimal
 */
export function roundBakerGrams(grams: number): number {
  const g = Number(grams) || 0;
  const sign = g < 0 ? -1 : 1;
  const a = Math.abs(g);
  if (a === 0) return 0;
  if (a > 1000) return sign * Math.round(a / 10) * 10;
  if (a >= 100) return sign * Math.round(a / 5) * 5;
  if (a >= 10) return sign * Math.round(a);
  return sign * Math.round(a * 10) / 10;
}

/** Skaleringsfaktor = ønsket antall / units_per_batch (aldri 0 eller negativ). */
export function scaleFactor(desiredUnits: number, unitsPerBatch: number | null | undefined): number {
  const base = Number(unitsPerBatch) || 0;
  const want = Number(desiredUnits) || 0;
  if (base <= 0 || want <= 0) return 1;
  return want / base;
}

export interface ScaledLine extends BakersLine {
  /** Uavrundet gramvekt etter skalering. */
  exactGrams: number;
  /** Bakervennlig avrundet gramvekt. */
  roundedGrams: number;
  /** Bakerprosent — uendret av skalering. */
  percent: number;
}

/**
 * Skalerer linjer til gram. Bakerprosenten regnes fra den USKALERTE oppskriften
 * og er dermed identisk før og etter skalering — den er oppskriftens fingeravtrykk.
 */
export function scaleLines(lines: BakersLine[], factor: number, baseFlourG: number): ScaledLine[] {
  return lines.map((l) => {
    const base = lineToGrams(l).grams;
    const exactGrams = base * factor;
    return {
      ...l,
      exactGrams,
      roundedGrams: roundBakerGrams(exactGrams),
      percent: baseFlourG > 0 ? (base / baseFlourG) * 100 : 0,
    };
  });
}

export interface ScaledSummary {
  factor: number;
  /** Nøkkeltall regnet på uavrundede gram — prosentene er identiske med basisoppskriften. */
  totals: BakersTotals;
  exactDoughG: number;
  roundedDoughG: number;
  exactFlourG: number;
  roundedFlourG: number;
  unitCount: number | null;
  batchCount: number | null;
}

/** Nøkkeltall for en skalert visning. Prosenter er skala-invariante. */
export function scaledSummary(
  lines: BakersLine[],
  factor: number,
  unitWeightGrams: number | null | undefined,
  desiredUnits: number,
  mixerCapacityG?: number | null,
): ScaledSummary {
  const baseTotals = computeTotals(lines, unitWeightGrams);
  const scaled = scaleLines(lines, factor, baseTotals.totalFlourG);
  const exactDoughG = baseTotals.totalDoughG * factor;
  const exactFlourG = baseTotals.totalFlourG * factor;
  const roundedDoughG = scaled.reduce((s, l) => s + l.roundedGrams, 0);
  const roundedFlourG = scaled.filter(isFlourLine).reduce((s, l) => s + l.roundedGrams, 0);
  const cap = Number(mixerCapacityG) || 0;
  const uw = Number(unitWeightGrams) || 0;

  return {
    factor,
    // Prosentene beholdes fra basisoppskriften — skalering endrer dem aldri.
    totals: {
      ...baseTotals,
      totalFlourG: exactFlourG,
      totalWaterG: baseTotals.totalWaterG * factor,
      totalDoughG: exactDoughG,
      unitCount: uw > 0 ? Math.floor(exactDoughG / uw) : null,
      doughPerUnitG: uw > 0 ? uw : null,
    },
    exactDoughG,
    roundedDoughG,
    exactFlourG,
    roundedFlourG,
    unitCount: uw > 0 ? Math.floor(exactDoughG / uw) : Math.round(Number(desiredUnits) || 0) || null,
    batchCount: cap > 0 && exactDoughG > 0 ? Math.ceil(exactDoughG / cap) : null,
  };
}

/**
 * Veierekkefølge: mel først, deretter væske, så resten.
 * Dette er rekkefølgen bakeren faktisk veier i — ikke skjermens sortering.
 */
export function weighingOrder<T extends BakersLine>(lines: T[]): T[] {
  const rank = (l: T) => {
    if (isFlourLine(l)) return 0;
    if (waterPctForLine(l) >= 50 || l.unit === "ml" || l.unit === "liter") return 1;
    return 2;
  };
  return [...lines].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return lineToGrams(b).grams - lineToGrams(a).grams;
  });
}

export function lineDisplayName(line: BakersLine): string {
  return line._rm?.name ?? line.ingredient_name ?? "Uten navn";
}

// ===== Formatering =====

export function fmtG(n: number | null | undefined, decimals = 0): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("nb-NO", { maximumFractionDigits: decimals });
}

export function fmtPercent(n: number | null | undefined, decimals = 1): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Number(n).toFixed(decimals).replace(".", ",")} %`;
}

/** Norsk tallformat med komma — brukes i PDF-ene (Intl er tilgjengelig i nettleseren). */
export function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("nb-NO", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Gram med bakervennlig presisjon: under 10 g vises med én desimal. */
export function fmtGrams(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  return fmtNum(v, Math.abs(v) < 10 && v !== 0 ? 1 : 0);
}

export function fmtDuration(minutes: number | null | undefined): string {
  const m = Number(minutes) || 0;
  if (!m) return "—";
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h && rest) return `${h} t ${rest} min`;
  if (h) return `${h} t`;
  return `${rest} min`;
}

