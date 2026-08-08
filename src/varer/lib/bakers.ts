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

/** Konverterer en linjemengde til gram. `stk` gir 0 (ukjent vekt). */
export function toGrams(quantity: number | string, unit: string): number {
  const q = Number(quantity) || 0;
  switch (unit) {
    case "kg":
    case "liter":
      return q * 1000;
    case "g":
    case "ml":
      return q;
    default:
      return 0;
  }
}

export function fromGrams(grams: number, unit: string): number {
  switch (unit) {
    case "kg":
    case "liter":
      return grams / 1000;
    default:
      return grams;
  }
}

// ===== Klassifisering =====

export interface BakersRawMaterial {
  id: string;
  name: string;
  category?: string | null;
  grain_classification?: string | null;
  water_content_pct?: number | null;
}

export interface BakersLine {
  id: string;
  recipe_part_id: string;
  raw_material_id: string | null;
  ingredient_name?: string | null;
  quantity: number | string;
  unit: string;
  bakers_percent?: number | string | null;
  is_flour_override?: boolean | null;
  water_content_pct_override?: number | string | null;
  entry_mode?: string;
  _rm?: BakersRawMaterial | null;
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
}

export function computeTotals(lines: BakersLine[], unitWeightGrams?: number | null): BakersTotals {
  let totalFlourG = 0;
  let totalWaterG = 0;
  let totalDoughG = 0;
  let saltG = 0;
  let leavenG = 0;

  for (const l of lines) {
    const g = toGrams(l.quantity, l.unit);
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
  };
}

/** Oppsummering for én del (typisk fordeig). */
export function computePartSummary(partLines: BakersLine[], totalFlourG: number) {
  let flourG = 0;
  let waterG = 0;
  let totalG = 0;
  for (const l of partLines) {
    const g = toGrams(l.quantity, l.unit);
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
  return (toGrams(line.quantity, line.unit) / totalFlourG) * 100;
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

// ===== Formatering =====

export function fmtG(n: number | null | undefined, decimals = 0): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("nb-NO", { maximumFractionDigits: decimals });
}

export function fmtPercent(n: number | null | undefined, decimals = 1): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Number(n).toFixed(decimals).replace(".", ",")} %`;
}
