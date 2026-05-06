/**
 * Beregningsmotor for oppskrifter.
 * Ren funksjon — ingen side-effekter — slik at både UI (live preview) og
 * edge functions kan bruke samme logikk.
 */

export interface IngredientLineInput {
  raw_material_id?: string | null;
  quantity: number; // mengde
  unit: string; // g, kg, ml, liter, stk
  unit_cost_per_kg?: number | null; // pris per kg/liter (raw_materials.current_cost_price)
  override_total?: number | null; // eksplisitt linjetotal hvis ingen rm-kobling
  waste_percent?: number | null;
}

export interface LaborLineInput {
  hours: number;
  hourly_rate?: number | null;
}

export interface PackagingLineInput {
  quantity: number;
  unit_price: number; // per stk
}

export interface RecipeMetricsInput {
  ingredients: IngredientLineInput[];
  labor: LaborLineInput[];
  packaging: PackagingLineInput[];
  units_per_batch: number;
  hourly_rate_default: number;
  yield_weight_g?: number | null;
  prices: {
    netto?: number | null;
    engros?: number | null;
    engros_pkg?: number | null;
    egne_utsalg?: number | null;
  };
  vat_rate: number; // f.eks. 0.15
  target_db_pct: number; // 40 = 40%
}

export interface PriceMetrics {
  price: number;
  brutto_pct: number; // (price - raw)/price
  db: number;         // price - cost_per_unit - packaging_per_unit
  dg_pct: number;     // db / price
  price_inc_vat: number;
  status: "ok" | "warn" | "bad";
}

export interface RecipeMetrics {
  total_raw_cost: number;
  total_labor_cost: number;
  total_packaging_cost: number;
  total_cost: number;
  cost_per_unit: number;
  packaging_per_unit: number;
  ingredients_per_unit: number;
  total_weight_g: number;
  weight_per_unit_g: number;
  units_per_batch: number;
  prices: {
    netto: PriceMetrics;
    engros: PriceMetrics;
    engros_pkg: PriceMetrics;
    egne_utsalg: PriceMetrics;
  };
}

function lineCost(line: IngredientLineInput): number {
  if (line.override_total != null) return line.override_total;
  const qty = Number(line.quantity) || 0;
  const pricePerKg = Number(line.unit_cost_per_kg ?? 0);
  const waste = (Number(line.waste_percent) || 0) / 100;
  let kg: number;
  switch (line.unit) {
    case "kg":
    case "liter":
      kg = qty;
      break;
    case "g":
    case "ml":
      kg = qty / 1000;
      break;
    case "stk":
      // stk ⇒ pris er pr enhet, ikke pr kg. Bruk override_total i stedet.
      return qty * pricePerKg;
    default:
      kg = qty / 1000;
  }
  return kg * pricePerKg * (1 + waste);
}

function lineWeightG(line: IngredientLineInput): number {
  const qty = Number(line.quantity) || 0;
  switch (line.unit) {
    case "kg":
    case "liter":
      return qty * 1000;
    case "g":
    case "ml":
      return qty;
    default:
      return 0;
  }
}

function priceMetrics(
  price: number | null | undefined,
  cost_per_unit: number,
  packaging_per_unit: number,
  raw_per_unit: number,
  vat_rate: number,
  target_db_pct: number,
): PriceMetrics {
  const p = Number(price) || 0;
  const db = p - cost_per_unit - packaging_per_unit;
  const dg = p > 0 ? db / p : 0;
  const brutto = p > 0 ? (p - raw_per_unit) / p : 0;
  const target = target_db_pct / 100;
  let status: "ok" | "warn" | "bad" = "ok";
  if (p === 0) status = "bad";
  else if (dg < target - 0.05) status = "bad";
  else if (dg < target) status = "warn";
  return {
    price: p,
    brutto_pct: brutto,
    db,
    dg_pct: dg,
    price_inc_vat: p * (1 + vat_rate),
    status,
  };
}

export function calculateRecipeMetrics(input: RecipeMetricsInput): RecipeMetrics {
  const total_raw_cost = input.ingredients.reduce((s, l) => s + lineCost(l), 0);
  const total_labor_cost = input.labor.reduce(
    (s, l) => s + (Number(l.hours) || 0) * Number(l.hourly_rate ?? input.hourly_rate_default ?? 0),
    0,
  );
  const total_packaging_cost = input.packaging.reduce(
    (s, p) => s + (Number(p.quantity) || 0) * (Number(p.unit_price) || 0),
    0,
  );
  const total_cost = total_raw_cost + total_labor_cost;
  const units = Math.max(1, Number(input.units_per_batch) || 1);
  const cost_per_unit = total_cost / units;
  const packaging_per_unit = total_packaging_cost / units;
  const ingredients_per_unit = total_raw_cost / units;
  const total_weight_g = input.ingredients.reduce((s, l) => s + lineWeightG(l), 0);
  const weight_per_unit_g = input.yield_weight_g ?? total_weight_g / units;

  const args = [cost_per_unit, packaging_per_unit, ingredients_per_unit, input.vat_rate, input.target_db_pct] as const;

  return {
    total_raw_cost,
    total_labor_cost,
    total_packaging_cost,
    total_cost,
    cost_per_unit,
    packaging_per_unit,
    ingredients_per_unit,
    total_weight_g,
    weight_per_unit_g,
    units_per_batch: units,
    prices: {
      netto: priceMetrics(input.prices.netto, ...args),
      engros: priceMetrics(input.prices.engros, ...args),
      engros_pkg: priceMetrics(input.prices.engros_pkg, ...args),
      egne_utsalg: priceMetrics(input.prices.egne_utsalg, ...args),
    },
  };
}

export function fmtKr(n: number | null | undefined, decimals = 2): string {
  if (n == null || isNaN(Number(n))) return "—";
  return Number(n).toFixed(decimals).replace(".", ",");
}

export function fmtPct(n: number | null | undefined, decimals = 0): string {
  if (n == null || isNaN(Number(n))) return "—";
  return (Number(n) * 100).toFixed(decimals).replace(".", ",") + " %";
}
