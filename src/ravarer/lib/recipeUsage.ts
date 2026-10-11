// Kost per oppskrift for «Brukt i oppskrifter» på råvarekortet.
// Bruker SAMME linjemotor som oppskriftseditoren (`lineToGrams` + `lineCost` med
// svinn), aldri «mengde × pris per grunnenhet». Ukjent eller uverifisert pris er
// ikke 0 kr; andel vises bare når hele oppskriftens kostgrunnlag er kjent.
import { lineToGrams, type BakersLine, type BakersRawMaterial } from "@/varer/lib/bakers";
import { lineCost } from "@/varer/lib/recipeCost";
import { ML_PER_UNIT, normalizeRecipeUnit } from "@/varer/lib/units-recipe";

export interface UsageLineInput {
  id: string;
  recipe_id: string;
  recipe_part_id: string;
  raw_material_id: string | null;
  sub_product_id: string | null;
  ingredient_name: string | null;
  quantity: number | string | null;
  unit: string | null;
  waste_percent: number | string | null;
}

export interface UsageQuantity { amount: number; unit: string }

export interface RecipeUsageRow {
  recipeId: string;
  recipeName: string;
  status: string | null;
  /** Mengder per kompatibel dimensjon (g, ml, stk) eller ukjent enhet hver for seg. */
  quantities: UsageQuantity[];
  /** Fullstendig kost for råvaren i oppskriften (alle linjer kjent og verifisert), ellers null. */
  lineCost: number | null;
  /** Kort forklaring når kost mangler/er uverifisert. */
  costNote: string | null;
  /** Andel av oppskriftens kost (0–1) når hele kostgrunnlaget er kjent, ellers null. */
  costShare: number | null;
  shareNote: string | null;
}

export const SHARE_UNKNOWN = "Kan ikke beregne andel — oppskriften har ufullstendig kostgrunnlag";

const MASS: Record<string, number> = { g: 1, kg: 1000 };

function toBakers(l: UsageLineInput, rm: BakersRawMaterial | null): BakersLine {
  return {
    id: l.id,
    recipe_part_id: l.recipe_part_id,
    raw_material_id: l.raw_material_id,
    sub_product_id: l.sub_product_id,
    ingredient_name: l.ingredient_name,
    quantity: l.quantity ?? 0,
    unit: l.unit ?? "",
    _rm: rm,
  };
}

/** Kjent, verifisert kost for én linje (med svinn), eller årsak. */
export function usageLineCost(l: UsageLineInput, rm: BakersRawMaterial | null): { cost: number | null; note: string | null } {
  if (l.quantity == null || !l.unit) return { cost: null, note: "Mengde eller enhet mangler" };
  if (l.sub_product_id) return { cost: null, note: "Halvfabrikatets kost hentes ikke her" };
  if (!l.raw_material_id || !rm) return { cost: null, note: "Mangler kostpris" };
  const b = toBakers(l, rm);
  const g = lineToGrams(b);
  const waste = 1 + (Number(l.waste_percent) || 0) / 100;
  const c = lineCost(b, g.exact ? g.grams * waste : 0, {}, waste);
  if (c.cost == null) return { cost: null, note: c.reason ?? "Mangler kostpris" };
  if (c.unverified) return { cost: null, note: c.reason ?? "Uverifisert kostpris" };
  return { cost: c.cost, note: null };
}

/** Summerer mengder kun innen kompatibel dimensjon; ukjente enheter holdes adskilt. */
export function sumQuantities(lines: UsageLineInput[]): UsageQuantity[] {
  let g = 0, ml = 0, stk = 0, hasG = false, hasMl = false, hasStk = false;
  const other = new Map<string, number>();
  for (const l of lines) {
    const q = Number(l.quantity);
    if (l.quantity == null || !Number.isFinite(q)) continue;
    const u = normalizeRecipeUnit(l.unit);
    if (u && u in MASS) { g += q * MASS[u]; hasG = true; }
    else if (u && u in ML_PER_UNIT) { ml += q * ML_PER_UNIT[u]; hasMl = true; }
    else if (u === "stk") { stk += q; hasStk = true; }
    else { const k = l.unit || "ukjent enhet"; other.set(k, (other.get(k) ?? 0) + q); }
  }
  const out: UsageQuantity[] = [];
  if (hasG) out.push(g >= 1000 ? { amount: g / 1000, unit: "kg" } : { amount: g, unit: "g" });
  if (hasMl) out.push(ml >= 1000 ? { amount: ml / 1000, unit: "l" } : { amount: ml, unit: "ml" });
  if (hasStk) out.push({ amount: stk, unit: "stk" });
  for (const [unit, amount] of other) out.push({ amount, unit });
  return out;
}

/**
 * `selectedId` = råvaren som vises. `allLines` = ALLE linjer i oppskriftene som bruker den
 * (også halvfabrikater og fritekst). `complete=false` (avkortet henting) undertrykker andel.
 */
export function computeRecipeUsage(input: {
  selectedId: string;
  allLines: UsageLineInput[];
  materials: Record<string, BakersRawMaterial>;
  recipes: Map<string, { name: string; status: string | null }>;
  complete: boolean;
}): RecipeUsageRow[] {
  const byRecipe = new Map<string, UsageLineInput[]>();
  for (const l of input.allLines) {
    const arr = byRecipe.get(l.recipe_id) ?? [];
    arr.push(l);
    byRecipe.set(l.recipe_id, arr);
  }
  const rows: RecipeUsageRow[] = [];
  for (const [recipeId, lines] of byRecipe) {
    const mine = lines.filter((l) => l.raw_material_id === input.selectedId);
    if (mine.length === 0) continue;
    let mineCost = 0, mineKnown = true, mineNote: string | null = null;
    let total = 0, totalKnown = input.complete;
    for (const l of lines) {
      const rm = l.raw_material_id ? input.materials[l.raw_material_id] ?? null : null;
      const c = usageLineCost(l, rm);
      const isMine = l.raw_material_id === input.selectedId;
      if (c.cost == null) {
        totalKnown = false;
        if (isMine) { mineKnown = false; mineNote ??= c.note; }
      } else {
        total += c.cost;
        if (isMine) mineCost += c.cost;
      }
    }
    const lineCostValue = mineKnown ? mineCost : null;
    const share = lineCostValue != null && totalKnown && total > 0 ? lineCostValue / total : null;
    const r = input.recipes.get(recipeId);
    rows.push({
      recipeId,
      recipeName: r?.name ?? "Uten navn",
      status: r?.status ?? null,
      quantities: sumQuantities(mine),
      lineCost: lineCostValue,
      costNote: mineKnown ? null : mineNote,
      costShare: share,
      shareNote: share == null ? SHARE_UNKNOWN : null,
    });
  }
  return rows.sort((a, b) => (b.costShare ?? -1) - (a.costShare ?? -1) || a.recipeName.localeCompare(b.recipeName, "nb"));
}
