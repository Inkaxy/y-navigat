/**
 * Næringsdata: finnes / fullstendig / verifisert. Påkrevde felt = obligatorisk næringsdeklarasjon
 * (energi kJ/kcal, fett, mettet fett, karbohydrat, sukkerarter, protein, salt). 0 er en oppgitt verdi.
 * Fiber er frivillig og teller ikke.
 */
export const NUTRITION_REQUIRED_FIELDS = ["energy_kj", "energy_kcal", "fat_g", "saturated_fat_g", "carbs_g", "sugars_g", "protein_g", "salt_g"] as const;
export type RequiredNutritionField = (typeof NUTRITION_REQUIRED_FIELDS)[number];

export const NUTRITION_FIELD_LABEL: Record<RequiredNutritionField, string> = {
  energy_kj: "energi (kJ)", energy_kcal: "energi (kcal)", fat_g: "fett", saturated_fat_g: "mettet fett",
  carbs_g: "karbohydrat", sugars_g: "sukkerarter", protein_g: "protein", salt_g: "salt",
};

export type NutritionValues = Partial<Record<RequiredNutritionField, number | null>>;

export function missingNutritionFields(row: NutritionValues): RequiredNutritionField[] {
  return NUTRITION_REQUIRED_FIELDS.filter((f) => {
    const v = row[f];
    return v == null || !Number.isFinite(Number(v));
  });
}

export type NutritionState =
  | { kind: "mangler" }
  | { kind: "ufullstendig"; missing: RequiredNutritionField[]; verified: boolean }
  | { kind: "ikke_verifisert" }
  | { kind: "verifisert" };

/**
 * Fullstendig krever ALLE påkrevde felt utfylt i klienten, og at databasens `is_complete` ikke sier nei.
 * Et verifiseringstidspunkt gjør aldri ufullstendige data fullstendige.
 */
export function nutritionState(row: (NutritionValues & { verified_at?: string | null; is_complete?: boolean | null }) | null): NutritionState {
  if (!row) return { kind: "mangler" };
  const missing = missingNutritionFields(row);
  const verified = !!row.verified_at;
  if (missing.length > 0 || row.is_complete === false) return { kind: "ufullstendig", missing, verified };
  return verified ? { kind: "verifisert" } : { kind: "ikke_verifisert" };
}
