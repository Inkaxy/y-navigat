// DENNE FILEN ER BYTE-IDENTISK MED supabase/functions/_shared/nutritionFields.ts.
// Endrer du én av dem, må du kopiere den andre. src/test/nutritionFields.test.ts
// slår ut hvis de kommer i utakt.
//
// Samlet definisjon av næringsfeltene i deklarasjonen, jf. forordning (EU)
// 1169/2011 vedlegg XV. Dette er katalogen (nøkkel, etikett, enhet, pliktfelt) —
// avrunding og visningsformat ligger i nutritionFormat.ts.

export type NutritionFieldKey =
  | "energy_kj"
  | "energy_kcal"
  | "fat_g"
  | "saturated_fat_g"
  | "carbs_g"
  | "sugars_g"
  | "fiber_g"
  | "protein_g"
  | "salt_g";

export interface NutritionFieldDef {
  key: NutritionFieldKey;
  /** Ordlyd etter vedlegg XV. */
  label: string;
  /** Måleenhet — kJ/kcal for energi, ellers gram. */
  unit: "kJ" | "kcal" | "g";
  /** Pliktfelt i næringsdeklarasjonen etter vedlegg XV. Kostfiber er frivillig. */
  mandatory: boolean;
}

/** Alle næringsfeltene, i rekkefølgen vedlegg XV krever dem oppført. */
export const NUTRITION_FIELDS: NutritionFieldDef[] = [
  { key: "energy_kj", label: "Energi", unit: "kJ", mandatory: true },
  { key: "energy_kcal", label: "Energi", unit: "kcal", mandatory: true },
  { key: "fat_g", label: "Fett", unit: "g", mandatory: true },
  { key: "saturated_fat_g", label: "hvorav mettede fettsyrer", unit: "g", mandatory: true },
  { key: "carbs_g", label: "Karbohydrat", unit: "g", mandatory: true },
  { key: "sugars_g", label: "hvorav sukkerarter", unit: "g", mandatory: true },
  { key: "fiber_g", label: "Kostfiber", unit: "g", mandatory: false },
  { key: "protein_g", label: "Protein", unit: "g", mandatory: true },
  { key: "salt_g", label: "Salt", unit: "g", mandatory: true },
];

export const NUTRITION_FIELD_KEYS: NutritionFieldKey[] = NUTRITION_FIELDS.map((f) => f.key);

export const MANDATORY_NUTRITION_FIELD_KEYS: NutritionFieldKey[] = NUTRITION_FIELDS
  .filter((f) => f.mandatory)
  .map((f) => f.key);

export function nutritionFieldLabel(key: NutritionFieldKey | string): string {
  return NUTRITION_FIELDS.find((f) => f.key === key)?.label ?? key;
}
