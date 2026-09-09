// DENNE FILEN ER BYTE-IDENTISK MED supabase/functions/_shared/nutritionFormat.ts.
// Endrer du én av dem, må du kopiere den andre. src/test/nutritionFormat.test.ts
// slår ut hvis de kommer i utakt.
//
// Avrunding og ordlyd for næringsdeklarasjonen, jf. forordning (EU) 1169/2011
// vedlegg XV og Mattilsynets veileder (tabell 4 «Avrundingsregler»).
// Verdiene LAGRES urundet (3 desimaler) — avrunding skjer bare ved visning.

/** Obligatoriske felt i næringsdeklarasjonen, i den rekkefølgen vedlegg XV krever. */
export type NutrientKey =
  | "energy_kj"
  | "energy_kcal"
  | "fat_g"
  | "saturated_fat_g"
  | "carbs_g"
  | "sugars_g"
  | "fiber_g"
  | "protein_g"
  | "salt_g";

/** Ordlyd etter vedlegg XV — ikke «Karbohydrater», ikke «Mettet fett». */
export const NUTRIENT_LABEL: Record<NutrientKey, string> = {
  energy_kj: "Energi",
  energy_kcal: "Energi",
  fat_g: "Fett",
  saturated_fat_g: "hvorav mettede fettsyrer",
  carbs_g: "Karbohydrat",
  sugars_g: "hvorav sukkerarter",
  fiber_g: "Kostfiber",
  protein_g: "Protein",
  salt_g: "Salt",
};

/** Feltene som må være til stede for at en råvare skal regnes som «har næring». */
export const MANDATORY_NUTRIENTS: NutrientKey[] = [
  "energy_kj",
  "energy_kcal",
  "fat_g",
  "saturated_fat_g",
  "carbs_g",
  "sugars_g",
  "protein_g",
  "salt_g",
];

/** Norsk tallformat uten avhengighet til Intl (kjøres både i Deno og i nettleser). */
export function nbNumber(value: number, decimals: number): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [intPart, decPart] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const sign = value < 0 ? "-" : "";
  return sign + (decPart ? `${grouped},${decPart}` : grouped);
}

/**
 * Formaterer én næringsverdi til det som skal stå på etiketten.
 *
 * - energi: hele tall (kJ og kcal står på ÉN rad, se `formatEnergyRow`)
 * - fett/karbohydrat/sukkerarter/protein/kostfiber: ≥ 10 → hele tall, < 10 → 1 desimal,
 *   < 0,5 → «< 0,5 g» (samme klasse som databasens label_format_nutrient)
 * - mettede fettsyrer: som over, men < 0,1 → «< 0,1 g»
 * - salt: ≥ 1 → 1 desimal, < 1 → 2 desimaler, < 0,0125 → «0 g»
 *
 * Avrundingen skjer desimal-sikkert (Math.round(v * 10) / 10 før toFixed) slik at
 * 0,85 blir «0,9 g» og 9,96 blir «10 g» — nøyaktig som i databasen.
 */
export function formatNutrient(key: NutrientKey | string, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const v = Number(value);

  if (key === "energy_kj") return `${nbNumber(Math.round(v), 0)} kJ`;
  if (key === "energy_kcal") return `${nbNumber(Math.round(v), 0)} kcal`;

  if (key === "salt_g") {
    if (v < 0.0125) return "0 g";
    const r2 = Math.round(v * 100) / 100;
    if (r2 < 1) return `${nbNumber(r2, 2)} g`;
    return `${nbNumber(Math.round(v * 10) / 10, 1)} g`;
  }

  const r1 = Math.round(v * 10) / 10;

  if (key === "saturated_fat_g") {
    if (r1 < 0.1) return "< 0,1 g";
    if (r1 >= 10) return `${nbNumber(Math.round(r1), 0)} g`;
    return `${nbNumber(r1, 1)} g`;
  }

  // fat_g, carbs_g, sugars_g, protein_g, fiber_g og alt annet oppgitt i gram
  if (r1 < 0.5) return "< 0,5 g";
  if (r1 >= 10) return `${nbNumber(Math.round(r1), 0)} g`;
  return `${nbNumber(r1, 1)} g`;
}

/** «1 050 kJ / 250 kcal» — energi skal stå på én rad. */
export function formatEnergyRow(
  kj: number | null | undefined,
  kcal: number | null | undefined,
): string {
  const hasKj = kj != null && Number.isFinite(Number(kj));
  const hasKcal = kcal != null && Number.isFinite(Number(kcal));
  if (!hasKj && !hasKcal) return "—";
  if (hasKj && hasKcal) return `${formatNutrient("energy_kj", kj)} / ${formatNutrient("energy_kcal", kcal)}`;
  return hasKj ? formatNutrient("energy_kj", kj) : formatNutrient("energy_kcal", kcal);
}

/** Radene i næringstabellen. Energi er én rad; resten følger vedlegg XV. */
export const NUTRITION_TABLE_ROWS: Array<{ key: NutrientKey | "energy"; label: string; indent?: boolean }> = [
  { key: "energy", label: "Energi" },
  { key: "fat_g", label: "Fett" },
  { key: "saturated_fat_g", label: "hvorav mettede fettsyrer", indent: true },
  { key: "carbs_g", label: "Karbohydrat" },
  { key: "sugars_g", label: "hvorav sukkerarter", indent: true },
  { key: "fiber_g", label: "Kostfiber" },
  { key: "protein_g", label: "Protein" },
  { key: "salt_g", label: "Salt" },
];

/** Lagringsformat: urundet med 3 desimaler. */
export function storeNutrient(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 1000) / 1000;
}
