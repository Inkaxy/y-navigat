// Felles etiketter og formatering for næringsverdier, slik at datablad-fanen og
// endringsloggen viser de samme navnene og tallene.

import { formatNumber } from "@/ravarer/lib/constants";

export const NUTRITION_LABELS: Record<string, string> = {
  energy_kj: "Energi (kJ)",
  energy_kcal: "Energi (kcal)",
  fat_g: "Fett",
  saturated_fat_g: "— mettet",
  carbs_g: "Karbohydrater",
  sugars_g: "— sukkerarter",
  fiber_g: "Fiber",
  protein_g: "Protein",
  salt_g: "Salt",
};

/** Endring i prosent, «ny» når det ikke fantes en verdi fra før. */
export function changePct(oldV: number | null, newV: number): string {
  if (oldV == null || oldV === 0) return oldV == null ? "ny" : "—";
  const pct = ((newV - oldV) / Math.abs(oldV)) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${formatNumber(pct, 1)} %`;
}

export interface NutritionValueDiff {
  field: string;
  label: string;
  before: string;
  after: string;
  change: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function show(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number") return formatNumber(value, 1);
  if (typeof value === "boolean") return value ? "ja" : "nei";
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ") || "—";
  return String(value);
}

/**
 * Én endringsrad fra endringsloggen, der raden lagrer skalarer per felt
 * (field/old_value/new_value). Dette er formen radene FAKTISK har i basen —
 * objektvarianten under gjelder eldre rader.
 */
export function nutritionValueDiff(
  field: string,
  oldValue: unknown,
  newValue: unknown,
): NutritionValueDiff {
  const n = typeof newValue === "number" ? newValue : null;
  return {
    field,
    label: NUTRITION_LABELS[field] ?? field,
    before: show(oldValue),
    after: show(newValue),
    change: n != null ? changePct(typeof oldValue === "number" ? oldValue : null, n) : null,
  };
}

/**
 * Gjør old_value/new_value fra endringsloggen om til lesbare rader.
 * Returnerer null når verdiene ikke er objekter vi kjenner igjen.
 */
export function nutritionObjectDiff(oldValue: unknown, newValue: unknown): NutritionValueDiff[] | null {
  const before = asRecord(oldValue) ?? {};
  const after = asRecord(newValue) ?? {};
  if (asRecord(oldValue) == null && asRecord(newValue) == null) return null;

  const fields = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const rows = fields
    .filter((f) => before[f] !== after[f])
    .map((f) => {
      const o = before[f];
      const n = after[f];
      return {
        field: f,
        label: NUTRITION_LABELS[f] ?? f,
        before: show(o),
        after: show(n),
        change:
          typeof n === "number" ? changePct(typeof o === "number" ? o : null, n) : null,
      };
    });
  return rows.length > 0 ? rows : null;
}
