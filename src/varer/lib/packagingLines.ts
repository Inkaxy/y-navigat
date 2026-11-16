// Emballasje i kalkylen (recipe_packaging_lines): lagret mengde gjelder hele baksten og deles på
// antall per bakst i product_cost. Brukeren skriver «antall per vare». Ren logikk (testes).

export interface PackagingLine {
  /** null = ny linje som ikke er lagret. */
  id: string | null;
  updatedAt: string | null;
  rawMaterialId: string;
  name: string;
  /** Mengde per bakst (lagret verdi). */
  quantity: number;
  unitPriceOverride: number | null;
  sortOrder: number;
}

export const toBatchQty = (perUnit: number, unitsPerBatch: number): number => Math.round(perUnit * unitsPerBatch * 10000) / 10000;
export const toPerUnit = (batchQty: number, unitsPerBatch: number): number => Math.round((batchQty / unitsPerBatch) * 10000) / 10000;

/** Kost per vare; null når en linje mangler pris (ingen falsk komplett sum). */
export function packagingCostPerUnit(lines: readonly PackagingLine[], unitCost: (rmId: string) => number | null, unitsPerBatch: number | null): number | null {
  if (!unitsPerBatch || unitsPerBatch <= 0) return null;
  let sum = 0;
  for (const l of lines) {
    const p = l.unitPriceOverride ?? unitCost(l.rawMaterialId);
    if (p == null) return null;
    sum += l.quantity * p;
  }
  return sum / unitsPerBatch;
}

export interface PackagingDiff { inserts: PackagingLine[]; updates: PackagingLine[]; deletes: PackagingLine[] }

/** Hva som må skrives for å gå fra lagret til kladd. */
export function diffPackaging(saved: readonly PackagingLine[], draft: readonly PackagingLine[]): PackagingDiff {
  const draftIds = new Set(draft.filter((d) => d.id).map((d) => d.id));
  const byId = new Map(saved.map((s) => [s.id, s]));
  return {
    inserts: draft.filter((d) => d.id == null),
    updates: draft.filter((d) => {
      const s = d.id ? byId.get(d.id) : undefined;
      return !!s && (s.quantity !== d.quantity || s.sortOrder !== d.sortOrder || s.unitPriceOverride !== d.unitPriceOverride);
    }),
    deletes: saved.filter((s) => !draftIds.has(s.id)),
  };
}

export const isDirty = (d: PackagingDiff) => d.inserts.length + d.updates.length + d.deletes.length > 0;
