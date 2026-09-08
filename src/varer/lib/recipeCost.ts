// Én kostmotor for oppskrifter. Brukes av editoren (RecipeStatsBar), PDF-en og
// halvfabrikat-prisen, slik at samme oppskrift aldri viser to ulike tall.

import {
  computeTotals,
  lineToGrams,
  type BakersLine,
} from "./bakers";
import { normalizeRecipeUnit, toLitres } from "./units-recipe";

export interface LineCostResult {
  /** Kostnad i kroner, eller null når den ikke kan beregnes. */
  cost: number | null;
  /** Forklaring på hvorfor kostnaden mangler. */
  reason?: string;
}

export interface CostContext {
  /** Kostpris per kg for halvfabrikater, slått opp på `sub_product_id`. */
  subProductCostPerKg?: Record<string, number | null | undefined>;
}

/**
 * Kostnad for én linje. Prisgrunnlaget følger råvarens `base_unit`:
 * «kg» → per kilo, «l» → per liter (trenger ingen tetthet når linjen er i volum),
 * «stk» → per stykk. Mangler grunnlaget, returneres null med en forklaring i
 * stedet for 0 kr — en usynlig nullkost er verre enn en synlig mangel.
 */
export function lineCost(
  line: BakersLine,
  grams: number,
  ctx: CostContext = {},
): LineCostResult {
  const subId = line.sub_product_id ?? null;
  const rawPrice = subId
    ? ctx.subProductCostPerKg?.[subId]
    : line._rm?.current_cost_price;
  const price = Number(rawPrice ?? NaN);
  if (!Number.isFinite(price)) {
    return { cost: null, reason: "Mangler kostpris" };
  }

  const base = subId ? "kg" : normalizeRecipeUnit(line._rm?.base_unit ?? "kg") ?? "kg";
  const unit = normalizeRecipeUnit(line.unit);

  if (base === "stk") {
    if (unit === "stk") return { cost: (Number(line.quantity) || 0) * price };
    const w = Number(line._rm?.unit_weight_grams) || 0;
    if (w > 0 && grams > 0) return { cost: (grams / w) * price };
    return { cost: null, reason: "Prisen er per stk, men vekt per stykk mangler" };
  }

  if (base === "l" || base === "ml" || base === "dl" || base === "cl") {
    const litres = unit ? toLitres(line.quantity, line.unit) : null;
    if (litres != null) {
      const perLitre = base === "l" ? price : price * (base === "ml" ? 1000 : base === "cl" ? 100 : 10);
      return { cost: litres * perLitre };
    }
    return { cost: null, reason: "Prisen er per liter, men mengden er ikke oppgitt i volum" };
  }

  if (!(grams > 0)) return { cost: null, reason: "Vekten kan ikke beregnes" };
  return { cost: (grams / 1000) * price };
}

export interface RecipeCostTotals {
  /** Sum kroner for linjene som lot seg beregne. */
  totalCost: number;
  /** Kroner per kg deig. Null når deigvekten er ukjent. */
  costPerKg: number | null;
  /** Kroner per emne. Null når antall emner er ukjent. */
  costPerUnit: number | null;
  /** Linjer uten kostgrunnlag — summen er ufullstendig så lenge denne ikke er tom. */
  missing: { name: string; reason: string }[];
  /** Sann når minst én linje mangler kost eller vekt. */
  incomplete: boolean;
}

function displayName(l: BakersLine): string {
  return l._rm?.name ?? l.ingredient_name ?? "ukjent råvare";
}

/**
 * Total kost for en oppskrift, med svinn per linje.
 * Alle nøkkeltall er null når de ikke kan beregnes trygt.
 */
export function computeRecipeCost(
  lines: BakersLine[],
  opts: { unitCount?: number | null; totalDoughG?: number | null } & CostContext = {},
): RecipeCostTotals {
  let totalCost = 0;
  let totalGrams = 0;
  const missing: { name: string; reason: string }[] = [];

  for (const l of lines) {
    const g = lineToGrams(l);
    const waste = Number((l as { waste_percent?: number | string | null }).waste_percent) || 0;
    const grams = g.grams * (1 + waste / 100);
    totalGrams += g.grams;
    if (!g.exact) {
      missing.push({ name: displayName(l), reason: g.reason ?? "Vekten kan ikke beregnes" });
      continue;
    }
    const c = lineCost(l, grams, opts);
    if (c.cost == null) {
      missing.push({ name: displayName(l), reason: c.reason ?? "Mangler kostpris" });
      continue;
    }
    totalCost += c.cost;
  }

  const doughG = opts.totalDoughG ?? totalGrams;
  const incomplete = missing.length > 0;
  return {
    totalCost,
    costPerKg: !incomplete && doughG > 0 ? totalCost / (doughG / 1000) : null,
    costPerUnit:
      !incomplete && opts.unitCount != null && opts.unitCount > 0 ? totalCost / opts.unitCount : null,
    missing,
    incomplete,
  };
}

/** Kost for en oppskrift der totalvekten regnes ut fra linjene selv. */
export function costFromLines(lines: BakersLine[], unitCount?: number | null): RecipeCostTotals {
  const totals = computeTotals(lines, null);
  return computeRecipeCost(lines, { unitCount, totalDoughG: totals.totalDoughG });
}
