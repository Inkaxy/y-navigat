/**
 * Skaleringsmotor for oppskrifter — bygger videre på bakers.ts/units-recipe.ts.
 * Ingen egen omregningslogikk her: gram-omregning skjer via `lineToGrams`.
 */

import {
  type BakersLine,
  computeTotals,
  isFlourLine,
  lineToGrams,
} from "./bakers";
import { computeUnitCount, type UnitCountRecipe } from "./units-recipe";

export type ScaleMode = "units" | "flour" | "dough" | "batches";
export type RoundingStep = 5 | 1 | 0.1;

export interface ScaleRequest {
  mode: ScaleMode;
  /** Måltall tolket etter modus: antall emner | melvekt i g | total deigvekt i g | maks kg deig per mikserbatch. */
  target: number;
  /** Avrunding av hver linje i gram. */
  rounding: RoundingStep;
  /** Ekstra svinn i prosent som legges på toppen av målet (0 = ingen). */
  wastePct?: number;
}

export interface ScaledBatchLine {
  lineId: string;
  name: string;
  grams: number | null; // null når linjen ikke kan regnes om
  unit: string; // "g" når grams != null, ellers linjens egen enhet
  quantity: number; // mengde i `unit`
  percent: number | null; // bakerprosent fra BASISoppskriften, uendret av skalering
  reason?: string; // hvorfor grams er null
}

export interface ScaleResult {
  mode: ScaleMode;
  factor: number;
  /** Antall like mikserbatcher. Alltid >= 1. */
  batchCount: number;
  /** Linjene for ÉN batch (allerede delt på batchCount og avrundet). */
  perBatch: ScaledBatchLine[];
  /** Sum for én batch. */
  batchDoughG: number;
  batchFlourG: number;
  /** Sum for hele bestillingen (alle batcher). */
  totalDoughG: number;
  totalFlourG: number;
  unitCount: number | null;
  incomplete: boolean;
  warnings: string[];
}

export const SCALE_MODE_LABEL: Record<ScaleMode, string> = {
  units: "Antall emner",
  flour: "Melvekt",
  dough: "Total deig",
  batches: "Mikserbatcher",
};

export const ROUNDING_OPTIONS: { value: RoundingStep; label: string }[] = [
  { value: 5, label: "5 g" },
  { value: 1, label: "1 g" },
  { value: 0.1, label: "0,1 g" },
];

/**
 * Runder gram til nærmeste steg. For 0,1 g brukes heltallsaritmetikk
 * (gange med 10, avrund, del på 10) for å unngå flyttallsstøy som 1,4000000000000001.
 */
export function roundToStep(grams: number, step: RoundingStep): number {
  const g = Number(grams) || 0;
  if (step === 0.1) return Math.round(g * 10) / 10;
  return Math.round(g / step) * step;
}

interface ScaleRecipeInput {
  dough_piece_grams?: number | string | null;
  dough_waste_pct?: number | string | null;
  units_per_batch?: number | string | null;
  unit_weight_grams?: number | string | null;
}

function asUnitCountRecipe(recipe: ScaleRecipeInput): UnitCountRecipe {
  return {
    dough_piece_grams: recipe.dough_piece_grams,
    dough_waste_pct: recipe.dough_waste_pct,
    units_per_batch: recipe.units_per_batch,
    unit_weight_grams: recipe.unit_weight_grams,
  };
}

function incompleteResult(mode: ScaleMode, warning: string): ScaleResult {
  return {
    mode,
    factor: 1,
    batchCount: 1,
    perBatch: [],
    batchDoughG: 0,
    batchFlourG: 0,
    totalDoughG: 0,
    totalFlourG: 0,
    unitCount: null,
    incomplete: true,
    warnings: [warning],
  };
}

/**
 * Skalerer en oppskrift til ønsket mengde etter valgt modus.
 *
 * - `units`: faktor = mål / basisantall emner (regnet fra oppskriftens felter).
 * - `flour`: faktor = mål / basisMelvekt.
 * - `dough`: faktor = mål / basisDeigvekt.
 * - `batches`: bestillingen ER basisoppskriften (faktor 1). Målet er maks kg deig
 *   per mikserbatch, og antall batcher = opprundet(basisDeigvekt / (mål·1000)).
 *
 * `wastePct` legger på ekstra margin ved å gange faktoren med (1 + svinn/100),
 * slik at man bestiller/veier inn nok til å dekke svinn i produksjonen.
 */
export function scaleRecipe(
  lines: BakersLine[],
  recipe: ScaleRecipeInput,
  req: ScaleRequest,
): ScaleResult {
  const { mode, rounding } = req;
  const target = Number(req.target) || 0;
  const wastePct = Number(req.wastePct) || 0;
  const wasteMultiplier = 1 + wastePct / 100;

  const baseTotals = computeTotals(lines);
  const baseDoughG = baseTotals.totalDoughG;
  const baseFlourG = baseTotals.totalFlourG;

  if (baseDoughG <= 0) {
    return incompleteResult(mode, "Basisoppskriften har ingen deigvekt å skalere fra.");
  }
  if (target <= 0) {
    return incompleteResult(mode, "Måltallet må være større enn null.");
  }

  let factor = 1;
  let batchCount = 1;

  if (mode === "flour") {
    if (baseFlourG <= 0) {
      return incompleteResult(mode, "Basisoppskriften har ingen melvekt å skalere fra.");
    }
    factor = (target / baseFlourG) * wasteMultiplier;
  } else if (mode === "dough") {
    factor = (target / baseDoughG) * wasteMultiplier;
  } else if (mode === "units") {
    const baseUnits = computeUnitCount(asUnitCountRecipe(recipe), baseDoughG);
    if (baseUnits == null || baseUnits <= 0) {
      return incompleteResult(mode, "Kan ikke regne ut basisantall emner — mangler emnevekt eller emner per batch.");
    }
    factor = (target / baseUnits) * wasteMultiplier;
  } else {
    // batches: bestillingen er hele basisoppskriften, ev. med svinnmargin.
    factor = wasteMultiplier;
    const capacityG = target * 1000;
    if (capacityG <= 0) {
      return incompleteResult(mode, "Mikserkapasitet må være større enn null.");
    }
    batchCount = Math.max(1, Math.ceil(baseDoughG / capacityG));
  }

  const warnings: string[] = [];
  let incomplete = false;
  let batchDoughG = 0;
  let batchFlourG = 0;

  const perBatch: ScaledBatchLine[] = lines.map((line) => {
    const conv = lineToGrams(line);
    const name = line._rm?.name ?? line.ingredient_name ?? "Ukjent råvare";
    const percent = baseFlourG > 0 ? (conv.grams / baseFlourG) * 100 : null;

    if (!conv.exact) {
      incomplete = true;
      const reason = conv.reason ?? "ufullstendig omregning";
      warnings.push(`${name}: ${reason}`);
      const scaledQuantity = ((Number(line.quantity) || 0) * factor) / batchCount;
      return {
        lineId: line.id,
        name,
        grams: null,
        unit: line.unit,
        quantity: Math.round(scaledQuantity * 1000) / 1000,
        percent,
        reason,
      };
    }

    const exactBatchGrams = (conv.grams * factor) / batchCount;
    const grams = roundToStep(exactBatchGrams, rounding);
    batchDoughG += grams;
    if (isFlourLine(line)) batchFlourG += grams;

    return {
      lineId: line.id,
      name,
      grams,
      unit: "g",
      quantity: grams,
      percent,
    };
  });

  const totalDoughG = batchDoughG * batchCount;
  const totalFlourG = batchFlourG * batchCount;

  const pieceWeight = Number(recipe.dough_piece_grams) || Number(recipe.unit_weight_grams) || 0;
  const wastePctForUnits = Number(recipe.dough_waste_pct) || 0;
  const unitCount =
    !incomplete && pieceWeight > 0
      ? Math.floor((totalDoughG * (1 - wastePctForUnits / 100)) / pieceWeight)
      : null;

  return {
    mode,
    factor,
    batchCount,
    perBatch,
    batchDoughG,
    batchFlourG,
    totalDoughG,
    totalFlourG,
    unitCount,
    incomplete,
    warnings,
  };
}
