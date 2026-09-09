// Ren sortering og statusvisning for `raw_material_nutrition_coverage`-viewet.
// Ingen nettverk her — hooken henter raden, denne fila avgjør rekkefølge og tekst.

export type CoverageStatus = "koblet" | "datablad" | "manuell" | "analyse" | "mangler" | string;

export interface CoverageRow {
  raw_material_id: string;
  name: string | null;
  category: string | null;
  status: CoverageStatus | null;
  source: string | null;
  matvaretabellen_food_id: string | null;
  manual_field_count: number | null;
  used_in_recipes: boolean | null;
  recipe_grams: number | null;
  purchase_12m: number | null;
  needs_nutrition: boolean | null;
}

const STATUS_LABEL: Record<string, string> = {
  koblet: "Koblet",
  datablad: "Datablad",
  manuell: "Manuell",
  analyse: "Analyse",
  mangler: "Mangler",
};

/** Menneskelesbar statustekst for status-chippen på dekningssiden. */
export function statusChipLabel(status: CoverageStatus | null | undefined): string {
  if (!status) return STATUS_LABEL.mangler;
  return STATUS_LABEL[status] ?? status;
}

/** «N felt overstyrt» — vises kun når noen har rettet enkeltfelt manuelt. */
export function manualFieldOverrideLabel(manualFieldCount: number | null | undefined): string | null {
  const n = manualFieldCount ?? 0;
  if (n <= 0) return null;
  return `${n} felt overstyrt`;
}

/**
 * Sorterer dekningsrader slik at «mangler»-radene som faktisk brukes i drift
 * kommer først: brukt i oppskrift foran ubrukt, deretter høyest gramforbruk
 * og innkjøpsbeløp siste 12 måneder.
 */
export function sortCoverageRows<T extends CoverageRow>(rows: readonly T[]): T[] {
  const priority = (r: T): number => (r.status === "mangler" ? 0 : 1);
  return [...rows].sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    const usedA = a.used_in_recipes ? 1 : 0;
    const usedB = b.used_in_recipes ? 1 : 0;
    if (usedA !== usedB) return usedB - usedA;
    const gramsA = a.recipe_grams ?? 0;
    const gramsB = b.recipe_grams ?? 0;
    if (gramsA !== gramsB) return gramsB - gramsA;
    const purchaseA = a.purchase_12m ?? 0;
    const purchaseB = b.purchase_12m ?? 0;
    if (purchaseA !== purchaseB) return purchaseB - purchaseA;
    return (a.name ?? "").localeCompare(b.name ?? "", "nb");
  });
}

/** Kontrakten for `nutrition_coverage_summary`-RPC-en, tolket fra `Json`. */
export interface NutritionCoverageSummary {
  covered: {
    recipe_weighted_pct: number;
    [key: string]: unknown;
  };
  by_status: Record<string, number>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Tolker `Json`-resultatet fra RPC-en uten å anta feltene finnes. */
export function parseNutritionCoverageSummary(json: unknown): NutritionCoverageSummary {
  const root = isRecord(json) ? json : {};
  const coveredRaw = isRecord(root.covered) ? root.covered : {};
  const pct = Number(coveredRaw.recipe_weighted_pct);
  const byStatusRaw = isRecord(root.by_status) ? root.by_status : {};
  const by_status: Record<string, number> = {};
  for (const [key, value] of Object.entries(byStatusRaw)) {
    by_status[key] = Number(value) || 0;
  }
  return {
    covered: { ...coveredRaw, recipe_weighted_pct: Number.isFinite(pct) ? pct : 0 },
    by_status,
  };
}
