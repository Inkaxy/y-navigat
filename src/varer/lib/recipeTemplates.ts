/**
 * Ren filterfunksjon for oppskriftslister: maler (`is_template = true`) skal
 * ikke vises i den vanlige oppskriftslisten, råvare-/halvfabrikat-velgere
 * eller på offentlige delingssider.
 */
export function filterNonTemplateRecipes<T extends { is_template?: boolean | null }>(
  rows: readonly T[],
): T[] {
  return rows.filter((r) => !r.is_template);
}

/** Maler tilgjengelig for «Ny fra mal». */
export function filterTemplateRecipes<T extends { is_template?: boolean | null }>(
  rows: readonly T[],
): T[] {
  return rows.filter((r) => !!r.is_template);
}
