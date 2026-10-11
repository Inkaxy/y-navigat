// Én kostmotor for oppskrifter. Brukes av editoren (RecipeStatsBar), PDF-en,
// halvfabrikat-prisen og produktkoblingen, slik at samme oppskrift aldri viser
// to ulike tall.
//
// Pris følger råvarens `base_unit` (g, kg, ml, cl, dl, l, stk). Vekt↔volum krever
// dokumentert tetthet (eller rent vann) begge veier. Prisen brukes bare som
// fullstendig når serverens prisstatus er `verifisert`; `uverifisert`, `mangler`
// eller ikke hentet status gjør kalkylen eksplisitt ufullstendig.

import { computeTotals, lineToGrams, type BakersLine } from "./bakers";
import { ML_PER_UNIT, normalizeRecipeUnit, toLitres } from "./units-recipe";

export type CostIssueKind = "vekt" | "pris" | "enhet" | "status";

export interface LineCostResult {
  /** Kostnad i kroner, eller null når den ikke kan beregnes. */
  cost: number | null;
  /** Forklaring på hvorfor kostnaden mangler eller ikke er verifisert. */
  reason?: string;
  kind?: CostIssueKind;
  /** Sann når prisen ikke har verifisert kilde — kostnaden telles ikke som fullstendig. */
  unverified?: boolean;
}

export interface CostContext {
  /** Kostpris per kg for halvfabrikater, slått opp på `sub_product_id`. Null = ufullstendig. */
  subProductCostPerKg?: Record<string, number | null | undefined>;
}

export const COST_BASIS_LABEL: Record<string, string> = {
  verifisert: "Verifisert",
  uverifisert: "Uverifisert — ingen gyldig kilde",
  mangler: "Mangler gyldig kostpris",
};

const GRAMS_PER_MASS: Record<string, number> = { g: 1, kg: 1000 };

/** Tetthet i g/ml når den er dokumentert. Rent vann uten tetthet = 1. */
function densityOf(line: BakersLine): number | null {
  const d = Number(line._rm?.density_g_per_ml);
  if (Number.isFinite(d) && d > 0) return d;
  return line._rm?.is_water ? 1 : null;
}

/** Prisstatus for en råvarelinje. Ikke hentet status regnes aldri som verifisert. */
export function lineCostStatus(line: BakersLine): { ok: boolean; reason?: string; kind?: CostIssueKind } {
  if (line.sub_product_id) return { ok: true };
  const st = line._rm?.cost_basis_status;
  if (st === "verifisert") return { ok: true };
  if (st === "uverifisert") return { ok: false, reason: "Uverifisert kostpris — ingen gyldig kilde", kind: "status" };
  if (st === "mangler") return { ok: false, reason: "Mangler gyldig kostpris", kind: "status" };
  return { ok: false, reason: "Prisstatus er ikke hentet", kind: "status" };
}

/**
 * Kostnad for én linje. `grams` er linjens vekt inkludert svinn (brukes når
 * linjen er i vekt eller kan regnes om). Mangler grunnlaget, returneres null med
 * forklaring i stedet for 0 kr.
 */
export function lineCost(line: BakersLine, grams: number, ctx: CostContext = {}): LineCostResult {
  const subId = line.sub_product_id ?? null;
  const rawPrice = subId ? ctx.subProductCostPerKg?.[subId] : line._rm?.current_cost_price;
  const price = rawPrice == null ? NaN : Number(rawPrice);
  if (!Number.isFinite(price)) {
    return { cost: null, reason: subId ? "Halvfabrikatet har ufullstendig kalkyle" : "Mangler kostpris", kind: "pris" };
  }

  const base = subId ? "kg" : normalizeRecipeUnit(line._rm?.base_unit ?? null);
  if (!base) return { cost: null, reason: "Ukjent grunnenhet for kostprisen", kind: "enhet" };
  const unit = normalizeRecipeUnit(line.unit);
  const qty = Number(line.quantity) || 0;
  const status = lineCostStatus(line);
  const finish = (cost: number): LineCostResult =>
    status.ok ? { cost } : { cost, reason: status.reason, kind: status.kind, unverified: true };

  if (base === "stk") {
    if (unit === "stk") return finish(qty * price);
    const w = Number(line._rm?.unit_weight_grams) || 0;
    if (w > 0 && grams > 0) return finish((grams / w) * price);
    return { cost: null, reason: "Prisen er per stk, men vekt per stykk mangler", kind: "enhet" };
  }

  if (base in GRAMS_PER_MASS) {
    if (!(grams > 0)) return { cost: null, reason: "Vekten kan ikke beregnes", kind: "vekt" };
    return finish((grams / GRAMS_PER_MASS[base]) * price);
  }

  // Volumgrunnlag (ml/cl/dl/l): pris per base-enhet → pris per ml.
  const perMl = price / ML_PER_UNIT[base];
  const litres = unit && unit !== "stk" && !(unit in GRAMS_PER_MASS) ? toLitres(qty, line.unit) : null;
  if (litres != null) {
    // Svinn følger vekten; i volum regnes det på samme måte.
    const raw = lineToGrams(line);
    const wasteFactor = raw.exact && raw.grams > 0 && grams > 0 ? grams / raw.grams : 1;
    return finish(litres * 1000 * wasteFactor * perMl);
  }
  if (grams > 0) {
    const d = densityOf(line);
    if (d == null) return { cost: null, reason: "Prisen er per volum, men tetthet mangler", kind: "enhet" };
    return finish((grams / d) * perMl);
  }
  return { cost: null, reason: "Prisen er per volum, men mengden kan ikke regnes om", kind: "enhet" };
}

export interface CostSourceInfo {
  name: string;
  status: string | null;
  source: string | null;
  updatedAt: string | null;
}

export interface RecipeCostTotals {
  /** Sum kroner for linjene som lot seg beregne (inkl. uverifiserte). */
  totalCost: number;
  /** Kroner per kg deig. Null når kalkylen er ufullstendig eller vekten ukjent. */
  costPerKg: number | null;
  /** Kroner per emne. Null når kalkylen er ufullstendig eller antall ukjent. */
  costPerUnit: number | null;
  /** Linjer uten fullstendig kostgrunnlag. */
  missing: { name: string; reason: string; kind?: CostIssueKind }[];
  /** Sann når minst én linje mangler kost, vekt eller verifisert prisstatus. */
  incomplete: boolean;
  /** Antall linjer med pris uten verifisert kilde. */
  unverifiedCount: number;
  /** Nyeste prisdato blant verifiserte råvarer. */
  newestVerifiedDate: string | null;
  /** Prisgrunnlag per råvarelinje (for visning av kilde/status). */
  sources: CostSourceInfo[];
}

function displayName(l: BakersLine): string {
  return l._rm?.name ?? l.ingredient_name ?? "ukjent råvare";
}

/** Total kost for en oppskrift, med svinn per linje. */
export function computeRecipeCost(
  lines: BakersLine[],
  opts: { unitCount?: number | null; totalDoughG?: number | null } & CostContext = {},
): RecipeCostTotals {
  let totalCost = 0;
  let totalGrams = 0;
  let unverifiedCount = 0;
  let newestVerifiedDate: string | null = null;
  const missing: RecipeCostTotals["missing"] = [];
  const sources: CostSourceInfo[] = [];

  for (const l of lines) {
    if (!l.sub_product_id && l._rm) {
      sources.push({
        name: displayName(l),
        status: l._rm.cost_basis_status ?? null,
        source: l._rm.price_source ?? null,
        updatedAt: l._rm.price_updated_at ?? null,
      });
      if (l._rm.cost_basis_status === "verifisert" && l._rm.price_updated_at) {
        if (!newestVerifiedDate || l._rm.price_updated_at > newestVerifiedDate) newestVerifiedDate = l._rm.price_updated_at;
      }
    }
    const g = lineToGrams(l);
    const waste = Number((l as { waste_percent?: number | string | null }).waste_percent) || 0;
    const grams = g.grams * (1 + waste / 100);
    totalGrams += g.grams;
    const c = lineCost(l, g.exact ? grams : 0, opts);
    if (!g.exact && c.cost == null) {
      missing.push({ name: displayName(l), reason: g.reason ?? "Vekten kan ikke beregnes", kind: "vekt" });
      continue;
    }
    if (c.cost == null) {
      missing.push({ name: displayName(l), reason: c.reason ?? "Mangler kostpris", kind: c.kind });
      continue;
    }
    totalCost += c.cost;
    if (c.unverified) {
      unverifiedCount += 1;
      missing.push({ name: displayName(l), reason: c.reason ?? "Uverifisert kostpris", kind: "status" });
    }
    if (!g.exact) missing.push({ name: displayName(l), reason: g.reason ?? "Vekten kan ikke beregnes", kind: "vekt" });
  }

  const doughG = opts.totalDoughG ?? totalGrams;
  const incomplete = missing.length > 0;
  return {
    totalCost,
    costPerKg: !incomplete && doughG > 0 ? totalCost / (doughG / 1000) : null,
    costPerUnit: !incomplete && opts.unitCount != null && opts.unitCount > 0 ? totalCost / opts.unitCount : null,
    missing,
    incomplete,
    unverifiedCount,
    newestVerifiedDate,
    sources,
  };
}

/** Kost for en oppskrift der totalvekten regnes ut fra linjene selv. */
export function costFromLines(lines: BakersLine[], unitCount?: number | null): RecipeCostTotals {
  const totals = computeTotals(lines, null);
  return computeRecipeCost(lines, { unitCount, totalDoughG: totals.totalDoughG });
}
