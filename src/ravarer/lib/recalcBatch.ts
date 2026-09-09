// Ren logikk for masse-reberegning av kostpriser via `recalc_raw_material_costs`
// og angring via `undo_raw_material_recalcs`. Ingen nettverk her.

export const MAX_RECALC_BATCH_SIZE = 500;

export interface RecalcItemResult {
  raw_material_id: string;
  ok: boolean;
  error?: string | null;
  cost_before: number | null;
  cost_after: number | null;
  manual_cost_protected?: boolean;
}

export interface RecalcRunResult {
  batch_id: string | null;
  items: RecalcItemResult[];
}

/** Deler en liste med råvare-IDer i bolker på maks `MAX_RECALC_BATCH_SIZE`. */
export function chunkRawMaterialIds(
  ids: readonly string[],
  maxSize: number = MAX_RECALC_BATCH_SIZE,
): string[][] {
  if (maxSize <= 0) throw new Error("maxSize må være positiv");
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += maxSize) chunks.push([...ids.slice(i, i + maxSize)]);
  return chunks;
}

export interface RecalcSummary {
  okCount: number;
  errorCount: number;
  protectedCount: number;
}

/** Oppsummerer `items[]` fra RPC-svaret til visning i kvitteringen. */
export function summarizeRecalcItems(items: readonly RecalcItemResult[]): RecalcSummary {
  let okCount = 0;
  let errorCount = 0;
  let protectedCount = 0;
  for (const item of items) {
    if (item.ok) okCount++;
    else errorCount++;
    if (item.manual_cost_protected) protectedCount++;
  }
  return { okCount, errorCount, protectedCount };
}

/** Argumentene til `recalc_raw_material_costs`. */
export function buildRecalcArgs(input: {
  rawMaterialIds: readonly string[];
  reason: string;
  dryRun: boolean;
}): { p_raw_material_ids: string[]; p_reason: string; p_dry_run: boolean } {
  return {
    p_raw_material_ids: [...input.rawMaterialIds],
    p_reason: input.reason,
    p_dry_run: input.dryRun,
  };
}

/** Argumentene til `undo_raw_material_recalcs`. */
export function buildUndoRecalcArgs(batchId: string): { p_batch_id: string } {
  if (!batchId) throw new Error("Mangler batch_id å angre");
  return { p_batch_id: batchId };
}

/** 42501 fra `refresh_purchase_stats` er en RLS-sperre, ikke en reell feil — den skal aldri stoppe kvitteringen. */
export function isNonFatalPermissionError(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "42501";
}
