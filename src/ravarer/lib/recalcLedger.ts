/**
 * Kvitteringer for skarpe reberegninger. Lever uavhengig av forhåndsvisningen: ny skanning,
 * nullstilling eller ny kjøring fjerner dem aldri. Bare eksplisitt bekreftede angrede poster
 * markeres som angret; feilede og utelatte beholdes for gjennomgang.
 */
import type { RecalcEnvelope, UndoEnvelope } from "@/ravarer/lib/recalcContract";

export type UndoState = "kan_angres" | "angret" | "angring_feilet" | "uavklart";

export interface AppliedItem {
  rawMaterialId: string;
  name: string;
  recalcId: string;
  linesChanged: number;
  costBefore: number | null;
  costAfter: number | null;
  undo: UndoState;
  undoMessage: string | null;
}
export interface AppliedBatch {
  batchId: string;
  items: AppliedItem[];
  failures: { rawMaterialId: string; message: string }[];
  /** Siste angreforsøk ga ukjent utfall — batchen beholdes uendret. */
  undoUnknown: boolean;
}
export interface UnknownApply { opId: number; rawMaterialIds: string[] }
export interface RecalcLedger { batches: AppliedBatch[]; unknownApplies: UnknownApply[] }

export const EMPTY_LEDGER: RecalcLedger = { batches: [], unknownApplies: [] };

export function addAppliedBatch(l: RecalcLedger, env: RecalcEnvelope): RecalcLedger {
  if (env.dryRun || !env.batchId) return l;
  const items: AppliedItem[] = [];
  const failures: AppliedBatch["failures"] = [];
  for (const it of env.items) {
    if (it.ok && it.recalcId) items.push({ rawMaterialId: it.rawMaterialId, name: it.name, recalcId: it.recalcId, linesChanged: it.linesChanged, costBefore: it.costBefore, costAfter: it.costAfter, undo: "kan_angres", undoMessage: null });
    else if (!it.ok) failures.push({ rawMaterialId: it.rawMaterialId, message: it.message });
  }
  return { ...l, batches: [...l.batches, { batchId: env.batchId, items, failures, undoUnknown: false }] };
}

export function addUnknownApply(l: RecalcLedger, u: UnknownApply): RecalcLedger {
  return { ...l, unknownApplies: [...l.unknownApplies, u] };
}

/** Utestående (ikke bekreftet angret) poster som et nytt angreforsøk gjelder. */
export const outstanding = (b: AppliedBatch) => b.items.filter((i) => i.undo !== "angret");

export function applyUndoResult(l: RecalcLedger, batchId: string, env: UndoEnvelope): RecalcLedger {
  return {
    ...l,
    batches: l.batches.map((b) => {
      if (b.batchId !== batchId) return b;
      const byId = new Map(env.items.map((i) => [i.recalcId, i]));
      return {
        ...b,
        undoUnknown: false,
        items: b.items.map((it) => {
          if (it.undo === "angret") return it;
          const r = byId.get(it.recalcId);
          if (!r) return { ...it, undo: "uavklart", undoMessage: "Ikke med i svaret — kan allerede være angret. Kontroller råvaren." };
          if (r.rawMaterialId !== it.rawMaterialId) return { ...it, undo: "uavklart", undoMessage: "Svaret stemte ikke med råvaren." };
          return r.ok ? { ...it, undo: "angret", undoMessage: null } : { ...it, undo: "angring_feilet", undoMessage: r.message };
        }),
      };
    }),
  };
}

export function markUndoUnknown(l: RecalcLedger, batchId: string): RecalcLedger {
  return { ...l, batches: l.batches.map((b) => (b.batchId === batchId ? { ...b, undoUnknown: true } : b)) };
}

/** Eksplisitt: brukeren har kontrollert råvarene for et ukjent kjøreutfall. */
export function acknowledgeUnknownApply(l: RecalcLedger, opId: number): RecalcLedger {
  return { ...l, unknownApplies: l.unknownApplies.filter((u) => u.opId !== opId) };
}
/** Eksplisitt: fjern en kvittering fra visningen (angring herfra er da ikke lenger mulig). */
export function closeBatch(l: RecalcLedger, batchId: string): RecalcLedger {
  return { ...l, batches: l.batches.filter((b) => b.batchId !== batchId) };
}

/** Råvarer med uavklart utfall (ukjent kjøring eller ukjent angring) — sperrer ny kjøring. */
export function unresolvedIds(l: RecalcLedger): Set<string> {
  const out = new Set<string>();
  for (const u of l.unknownApplies) u.rawMaterialIds.forEach((id) => out.add(id));
  for (const b of l.batches) if (b.undoUnknown) b.items.forEach((i) => out.add(i.rawMaterialId));
  return out;
}
