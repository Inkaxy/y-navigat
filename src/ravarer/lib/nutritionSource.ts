// Ett vokabular for raw_material_nutrition.source.
// Historisk finnes 'manual' (fra useMissingNutrition) og 'leverandør_db' (fra datablad).
// Vi SKRIVER alltid de kanoniske verdiene, men LESER de gamle.

export const NUTRITION_SOURCES = ["matvaretabellen", "datablad", "manuell", "analyse"] as const;
export type NutritionSource = (typeof NUTRITION_SOURCES)[number];

const READ_ALIASES: Record<string, NutritionSource> = {
  manual: "manuell",
  manuel: "manuell",
  "leverandør_db": "datablad",
  leverandor_db: "datablad",
  supplier_db: "datablad",
  datasheet: "datablad",
  analysis: "analyse",
};

/** Leser en lagret kilde og oversetter gamle verdier til dagens vokabular. */
export function normalizeNutritionSource(value: string | null | undefined): NutritionSource | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  if ((NUTRITION_SOURCES as readonly string[]).includes(key)) return key as NutritionSource;
  return READ_ALIASES[key] ?? null;
}

export const NUTRITION_SOURCE_LABEL: Record<NutritionSource, string> = {
  matvaretabellen: "Matvaretabellen",
  datablad: "Leverandørens datablad",
  manuell: "Manuell registrering",
  analyse: "Laboratorieanalyse",
};

export function nutritionSourceLabel(value: string | null | undefined): string {
  const s = normalizeNutritionSource(value);
  return s ? NUTRITION_SOURCE_LABEL[s] : "Ukjent kilde";
}

/** Tallfeltene som utgjør næringsinnholdet. */
export const NUTRITION_NUMBER_FIELDS = [
  "energy_kj",
  "energy_kcal",
  "fat_g",
  "saturated_fat_g",
  "carbs_g",
  "sugars_g",
  "fiber_g",
  "protein_g",
  "salt_g",
] as const;

export type NutritionNumberField = (typeof NUTRITION_NUMBER_FIELDS)[number];

type NumberBag = Partial<Record<NutritionNumberField, number | null>>;

/** Hvilke næringsfelt som faktisk er endret mellom to utkast. */
export function changedNutritionFields(before: NumberBag | null | undefined, after: NumberBag): NutritionNumberField[] {
  const out: NutritionNumberField[] = [];
  for (const f of NUTRITION_NUMBER_FIELDS) {
    const a = before?.[f] ?? null;
    const b = after?.[f] ?? null;
    if (Number(a ?? NaN) !== Number(b ?? NaN) && !(a === null && b === null)) out.push(f);
  }
  return out;
}

/**
 * Kilden som skal lagres. Retter brukeren et tall som kom fra Matvaretabellen
 * eller et datablad, blir kilden 'manuell' — ellers beholdes valgt kilde.
 */
export function resolveSourceOnSave(input: {
  existingSource: string | null | undefined;
  draftSource: string | null | undefined;
  changedFields: readonly string[];
}): NutritionSource | null {
  const existing = normalizeNutritionSource(input.existingSource);
  const draft = normalizeNutritionSource(input.draftSource);
  // Brukeren har valgt kilde selv i nedtrekkslisten — det valget respekteres.
  if (draft !== existing) return draft;
  if (input.changedFields.length === 0) return draft;
  if (existing === "matvaretabellen" || existing === "datablad") return "manuell";
  return draft ?? "manuell";
}

/** kJ og kcal skal henge sammen: kcal ≈ kJ / 4,184. */
export const KJ_PER_KCAL = 4.184;

export function kcalFromKj(kj: number | null | undefined): number | null {
  if (kj == null || !Number.isFinite(Number(kj))) return null;
  return Math.round((Number(kj) / KJ_PER_KCAL) * 10) / 10;
}

/** Sant når kcal avviker mer enn 5 % fra kJ / 4,184. */
export function energyMismatch(
  kj: number | null | undefined,
  kcal: number | null | undefined,
): { mismatch: boolean; expectedKcal: number | null; deviationPct: number | null } {
  const expected = kcalFromKj(kj);
  if (expected == null || kcal == null || !Number.isFinite(Number(kcal)) || expected === 0) {
    return { mismatch: false, expectedKcal: expected, deviationPct: null };
  }
  const dev = Math.abs((Number(kcal) - expected) / expected) * 100;
  return { mismatch: dev > 5, expectedKcal: expected, deviationPct: Math.round(dev * 10) / 10 };
}
