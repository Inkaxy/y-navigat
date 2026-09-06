// Rene regler for anvendelse av datablad. Ingen I/O — enkle å teste.

export interface ExistingComponent {
  id: string;
  component_raw_material_id: string | null;
  primary_ingredient_name: string | null;
  suggested_by_ai?: boolean | null;
}

/** Bare tidligere AI-forslag uten kobling kan erstattes av et nytt forslag. */
export function replaceableComponentIds(existing: ExistingComponent[]): string[] {
  return existing
    .filter((c) => !c.component_raw_material_id && c.suggested_by_ai === true)
    .map((c) => c.id);
}

/** Navn som skal beholdes: koblede rader og manuelt skrevne tekstkomponenter. */
export function preservedComponentNames(existing: ExistingComponent[]): Set<string> {
  return new Set(
    existing
      .filter((c) => !!c.component_raw_material_id || c.suggested_by_ai !== true)
      .map((c) => String(c.primary_ingredient_name ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Databladet får status «applied» bare når ingenting feilet OG forrige
 * gjeldende datablad faktisk ble nullstilt.
 */
export function shouldWriteAppliedStatus(failuresBefore: number, unsetFailed: boolean): boolean {
  return failuresBefore === 0 && !unsetFailed;
}

/** Fjerning av allergener krever både eksplisitt godkjenning og en tillitsverdig uthenting. */
export function mayRemoveAllergens(acceptedFields: Iterable<string>, rejectedCount: number): boolean {
  return new Set(acceptedFields).has("allergen_removals") && rejectedCount === 0;
}
