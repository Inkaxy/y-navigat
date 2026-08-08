/**
 * Brødskala'n — klientside-hjelpere.
 *
 * Terskler (offisielle): fint < 26 %, halvgrovt 26–50,9 %, grovt 51–75,9 %, ekstra grovt ≥ 76 %.
 * Grovhetsprosenten = vektet grovt korn / totalt mel, der kli teller med en faktor
 * (samme faktorer som beregningsmotoren i _shared/declaration-core.ts).
 */

export const BRAN_FACTOR: Record<string, number> = {
  wheat_bran: 4.5,
  rye_bran: 4.0,
  oat_bran: 2.0,
};

export type GrainCategory = "fint" | "halvgrovt" | "grovt" | "ekstra_grovt";

export const GRAIN_LEVELS: Array<{
  key: GrainCategory;
  label: string;
  min: number;
  max: number | null;
  rangeText: string;
}> = [
  { key: "fint", label: "Fint", min: 0, max: 26, rangeText: "under 26 %" },
  { key: "halvgrovt", label: "Halvgrovt", min: 26, max: 51, rangeText: "26–50,9 %" },
  { key: "grovt", label: "Grovt", min: 51, max: 76, rangeText: "51–75,9 %" },
  { key: "ekstra_grovt", label: "Ekstra grovt", min: 76, max: null, rangeText: "fra 76 %" },
];

export function grainCategoryFromPct(pct: number): GrainCategory {
  if (pct < 26) return "fint";
  if (pct < 51) return "halvgrovt";
  if (pct < 76) return "grovt";
  return "ekstra_grovt";
}

export function grainLevelLabel(key: string | null | undefined): string {
  return GRAIN_LEVELS.find((l) => l.key === key)?.label ?? "Ukjent";
}

/** Mark-nøkler i label_marks, én per grovhetsnivå. */
export const GRAIN_MARK_KEY: Record<GrainCategory, string> = {
  fint: "brodskalan_fint",
  halvgrovt: "brodskalan_halvgrovt",
  grovt: "brodskalan_grovt",
  ekstra_grovt: "brodskalan_ekstra_grovt",
};

export const SIFTED_CLASSIFICATIONS = ["sifted_flour", "other_flour"];
export const COARSE_CLASSIFICATIONS = ["whole_grain_flour", "whole_grains", "gluten_free_grain"];

export interface FlourLine {
  raw_material_id: string | null;
  name: string;
  grams: number;
  classification: string | null;
  cereal_type: string | null;
}

/**
 * Hvor mange gram siktet mel må byttes til sammalt/fullkorn for å nå neste nivå?
 * Bytte 1 g siktet → 1 g fullkorn holder melmengden konstant og øker grovt korn med 1 g.
 */
export function gramsToNextLevel(
  coarseWeightedGrams: number,
  totalFlourGrams: number,
): { next: (typeof GRAIN_LEVELS)[number]; gramsNeeded: number } | null {
  if (!(totalFlourGrams > 0)) return null;
  const pct = (coarseWeightedGrams / totalFlourGrams) * 100;
  const current = grainCategoryFromPct(pct);
  const idx = GRAIN_LEVELS.findIndex((l) => l.key === current);
  const next = GRAIN_LEVELS[idx + 1];
  if (!next) return null;
  const gramsNeeded = (next.min / 100) * totalFlourGrams - coarseWeightedGrams;
  return { next, gramsNeeded: Math.max(0, gramsNeeded) };
}

/** Formaterer gram pent: 1 850 g → «1,9 kg», 340 g → «340 g». */
export function fmtGrams(g: number): string {
  if (!Number.isFinite(g)) return "—";
  if (Math.abs(g) >= 1000) return `${(g / 1000).toFixed(1).replace(".", ",")} kg`;
  return `${Math.round(g)} g`;
}

export function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${Number(n).toFixed(decimals).replace(".", ",")} %`;
}

export function fmtNum(n: number | null | undefined, decimals = 1): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(decimals).replace(".", ",");
}
