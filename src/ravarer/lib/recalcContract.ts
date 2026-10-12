/**
 * Strenge lesere for de eksakte live-kontraktene til `recalc_raw_material_costs` (bulk)
 * og `undo_raw_material_recalcs`. Ingen udokumenterte felt kreves (ingen per-linje-endringer,
 * base_unit, faktor …). Alt som ikke stemmer nøyaktig er `null` = ukjent utfall.
 *
 * Merk: dry-run `cost_after` er serverens forslag nå — ikke en garantert framtidig kostpris.
 * `manual_cost_protected` er i dag alltid false fra serveren og brukes ikke som bevis.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
function cost(v: unknown): number | null | undefined {
  if (v === null) return null;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export interface RecalcOkItem {
  rawMaterialId: string;
  ok: true;
  name: string;
  recalcId: string | null;
  linesTotal: number;
  linesChanged: number;
  linesUnknown: number;
  linesExcluded: number;
  costBefore: number | null;
  costAfter: number | null;
}
export interface RecalcFailedItem { rawMaterialId: string; ok: false; message: string }
export type RecalcItem = RecalcOkItem | RecalcFailedItem;

export interface RecalcEnvelope {
  ok: boolean;
  dryRun: boolean;
  batchId: string | null;
  requested: number;
  succeeded: number;
  failed: number;
  linesChanged: number;
  items: RecalcItem[];
}

/** Trygg brukertekst for serverfeil per vare — aldri rå feiltekst. */
export function safeRecalcError(sqlstate: unknown): string {
  if (sqlstate === "42501") return "Mangler tilgang til denne råvaren.";
  if (sqlstate === "P0002" || sqlstate === "02000") return "Råvaren ble ikke funnet.";
  return "Serveren kunne ikke beregne denne råvaren.";
}

export function parseRecalcEnvelope(data: unknown, expect: { ids: readonly string[]; dryRun: boolean }): RecalcEnvelope | null {
  if (!isRecord(data) || !Array.isArray(data.items)) return null;
  const { ok, dry_run, batch_id, requested, succeeded, failed, lines_changed } = data;
  if (typeof ok !== "boolean" || dry_run !== expect.dryRun) return null;
  if (!isCount(requested) || !isCount(succeeded) || !isCount(failed) || !isCount(lines_changed)) return null;
  if (expect.dryRun ? batch_id !== null : !isUuid(batch_id)) return null;
  const wanted = new Set(expect.ids);
  if (requested !== wanted.size || requested !== succeeded + failed || data.items.length !== requested) return null;
  const seen = new Set<string>();
  const items: RecalcItem[] = [];
  let okN = 0, sumChanged = 0;
  for (const raw of data.items) {
    if (!isRecord(raw) || !isUuid(raw.raw_material_id) || !wanted.has(raw.raw_material_id) || seen.has(raw.raw_material_id)) return null;
    seen.add(raw.raw_material_id);
    if (raw.ok === true) {
      const before = cost(raw.cost_before), after = cost(raw.cost_after);
      if (before === undefined || after === undefined) return null;
      if (!isCount(raw.lines_total) || !isCount(raw.lines_changed) || !isCount(raw.lines_unknown) || !isCount(raw.lines_excluded)) return null;
      if (typeof raw.raw_material !== "string") return null;
      const rid = raw.recalc_id;
      if (expect.dryRun ? rid !== null : !isUuid(rid)) return null;
      okN++; sumChanged += raw.lines_changed;
      items.push({
        rawMaterialId: raw.raw_material_id, ok: true, name: raw.raw_material, recalcId: rid as string | null,
        linesTotal: raw.lines_total, linesChanged: raw.lines_changed, linesUnknown: raw.lines_unknown, linesExcluded: raw.lines_excluded,
        costBefore: before, costAfter: after,
      });
    } else if (raw.ok === false) {
      if (typeof raw.error !== "string") return null;
      items.push({ rawMaterialId: raw.raw_material_id, ok: false, message: safeRecalcError(raw.sqlstate) });
    } else return null;
  }
  if (okN !== succeeded || ok !== (failed === 0) || sumChanged !== lines_changed) return null;
  return { ok, dryRun: expect.dryRun, batchId: expect.dryRun ? null : (batch_id as string), requested, succeeded, failed, linesChanged: lines_changed, items };
}

export type UndoItem =
  | { recalcId: string; rawMaterialId: string; ok: true; linesRestored: number }
  | { recalcId: string; rawMaterialId: string; ok: false; message: string };
export interface UndoEnvelope { ok: boolean; batchId: string; found: number; succeeded: number; failed: number; items: UndoItem[] }

export function parseUndoEnvelope(data: unknown, batchId: string): UndoEnvelope | null {
  if (!isRecord(data) || !Array.isArray(data.items)) return null;
  const { ok, batch_id, found, succeeded, failed } = data;
  if (typeof ok !== "boolean" || batch_id !== batchId) return null;
  if (!isCount(found) || !isCount(succeeded) || !isCount(failed)) return null;
  if (found !== succeeded + failed || data.items.length !== found || ok !== (failed === 0)) return null;
  const seen = new Set<string>();
  const items: UndoItem[] = [];
  let okN = 0;
  for (const raw of data.items) {
    if (!isRecord(raw) || !isUuid(raw.recalc_id) || !isUuid(raw.raw_material_id) || seen.has(raw.recalc_id)) return null;
    seen.add(raw.recalc_id);
    if (raw.ok === true) {
      if (!isCount(raw.lines_restored)) return null;
      okN++;
      items.push({ recalcId: raw.recalc_id, rawMaterialId: raw.raw_material_id, ok: true, linesRestored: raw.lines_restored });
    } else if (raw.ok === false) {
      if (typeof raw.error !== "string") return null;
      items.push({ recalcId: raw.recalc_id, rawMaterialId: raw.raw_material_id, ok: false, message: safeRecalcError(raw.sqlstate) });
    } else return null;
  }
  if (okN !== succeeded) return null;
  return { ok, batchId, found, succeeded, failed, items };
}
