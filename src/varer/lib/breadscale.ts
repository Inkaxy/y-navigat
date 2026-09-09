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
  { key: "ekstra_grovt", label: "Ekstra grovt", min: 76, max: null, rangeText: "76 % og over" },
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

export const SIFTED_CLASSIFICATIONS = ["sifted_flour", "other_flour", "gluten_or_germ", "gluten_free_sifted"];
export const COARSE_CLASSIFICATIONS = [
  "whole_grain_flour",
  "whole_grains",
  "gluten_free_grain",
  "gluten_free_whole",
];
export const BRAN_CLASSIFICATIONS = ["wheat_bran", "rye_bran", "oat_bran"];
/** Malt og bakemidler står utenfor nevneren i Brødskala'n. */
export const OUTSIDE_CLASSIFICATIONS = ["malt_or_improver", "not_grain"];

/**
 * Alle kornklasser som kan velges på en råvare, med BKLF-faktoren synlig.
 * Kornklassene krever kornslag (cereal_type) for at rugandelen skal bli riktig.
 */
export const GRAIN_CLASSIFICATION_OPTIONS: Array<{
  value: string;
  label: string;
  hint: string;
  requiresCereal: boolean;
}> = [
  { value: "sifted_flour", label: "Siktet mel", hint: "teller i nevneren", requiresCereal: true },
  { value: "whole_grain_flour", label: "Sammalt mel", hint: "faktor 1,0 — teller som grovt", requiresCereal: true },
  { value: "whole_grains", label: "Hele korn", hint: "faktor 1,0 — teller som grovt", requiresCereal: true },
  { value: "wheat_bran", label: "Hvetekli", hint: "faktor 4,5", requiresCereal: false },
  { value: "rye_bran", label: "Rugkli", hint: "faktor 4,0", requiresCereal: false },
  { value: "oat_bran", label: "Havrekli", hint: "faktor 2,0", requiresCereal: false },
  { value: "gluten_free_grain", label: "Glutenfritt korn", hint: "faktor 1,0 — teller som grovt", requiresCereal: true },
  { value: "other_flour", label: "Annet mel", hint: "teller som siktet", requiresCereal: false },
  { value: "not_grain", label: "Ikke korn", hint: "utenfor beregningen", requiresCereal: false },
];

/**
 * Brødskala'n på klienten — speiler `computeBreadscale` i
 * `_shared/declaration-core.ts`: kli uvektet i nevneren, vektet i telleren.
 * Prosenten kan overstige 100 og rundes til én desimal ett sted.
 */
export function breadscalePct(
  lines: Array<{ grams: number; classification: string | null }>,
): { pct: number | null; totalFlourGrams: number; coarseWeightedGrams: number } {
  let total = 0;
  let coarse = 0;
  for (const l of lines) {
    const g = Number(l.grams) || 0;
    const c = l.classification ?? "";
    if (SIFTED_CLASSIFICATIONS.includes(c)) total += g;
    else if (COARSE_CLASSIFICATIONS.includes(c)) {
      total += g;
      coarse += g;
    } else if (BRAN_CLASSIFICATIONS.includes(c)) {
      total += g;
      coarse += g * (BRAN_FACTOR[c] ?? 1);
    }
  }
  const pct = total > 0 ? Math.round((coarse / total) * 1000) / 10 : null;
  return { pct, totalFlourGrams: total, coarseWeightedGrams: coarse };
}

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
