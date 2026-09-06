/**
 * Tastaturdrevet gjennomgang av fakturalinjer.
 *
 * Reduseren holder rekkefølgen på linjene i køen, hvilken linje som er aktiv,
 * og en angre-stabel. Den er helt uten React og Supabase slik at den kan
 * testes direkte (se src/test/invoiceQueue.test.ts).
 */

/** Feltene vi må kunne skrive tilbake når brukeren angrer en godkjenning. */
export interface QueueLineSnapshot {
  raw_material_id: string | null;
  match_confidence: string | null;
  requires_review: boolean | null;
  review_reason: string | null;
}

export interface QueueUndoEntry {
  lineId: string;
  /** Posisjonen linjen hadde i køen, slik at angre setter den tilbake der. */
  index: number;
  snapshot: QueueLineSnapshot;
  /** Kort beskrivelse til toast-en, f.eks. varenavnet som ble godtatt. */
  label: string;
}

export interface QueueState {
  ids: string[];
  activeId: string | null;
  undo: QueueUndoEntry[];
}

export type QueueAction =
  /** Ny liste fra spørringen — behold aktiv linje hvis den fortsatt finnes. */
  | { type: "sync"; ids: string[] }
  | { type: "focus"; id: string }
  | { type: "next" }
  | { type: "prev" }
  /** Linjen er behandlet (godtatt/ikke aktuell) og forsvinner fra køen. */
  | { type: "resolved"; id: string; snapshot: QueueLineSnapshot; label: string }
  /** Angrer den siste behandlede linjen og legger den tilbake. */
  | { type: "undo" }
  | { type: "clearUndo" };

export const emptyQueueState: QueueState = { ids: [], activeId: null, undo: [] };

function at(ids: string[], index: number): string | null {
  if (ids.length === 0) return null;
  const i = Math.min(Math.max(index, 0), ids.length - 1);
  return ids[i];
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "sync": {
      const ids = action.ids;
      const activeId = state.activeId && ids.includes(state.activeId) ? state.activeId : ids[0] ?? null;
      // Angre-oppføringer for linjer som ikke lenger finnes er verdiløse.
      const undo = state.undo.filter((u) => !ids.includes(u.lineId));
      return { ids, activeId, undo };
    }
    case "focus":
      return state.ids.includes(action.id) ? { ...state, activeId: action.id } : state;
    case "next":
    case "prev": {
      const idx = state.activeId ? state.ids.indexOf(state.activeId) : -1;
      if (state.ids.length === 0) return state;
      if (idx === -1) return { ...state, activeId: state.ids[0] };
      const nextIdx = action.type === "next" ? idx + 1 : idx - 1;
      return { ...state, activeId: at(state.ids, nextIdx) };
    }
    case "resolved": {
      const index = state.ids.indexOf(action.id);
      if (index === -1) return state;
      const ids = state.ids.filter((id) => id !== action.id);
      // Auto-advance: neste linje glir opp i samme posisjon.
      const activeId = state.activeId === action.id ? at(ids, index) : state.activeId;
      return {
        ids,
        activeId,
        undo: [...state.undo, { lineId: action.id, index, snapshot: action.snapshot, label: action.label }],
      };
    }
    case "undo": {
      const entry = state.undo[state.undo.length - 1];
      if (!entry) return state;
      const ids = [...state.ids];
      ids.splice(Math.min(entry.index, ids.length), 0, entry.lineId);
      return { ids, activeId: entry.lineId, undo: state.undo.slice(0, -1) };
    }
    case "clearUndo":
      return { ...state, undo: [] };
    default:
      return state;
  }
}

/** Siste angre-oppføring, uten å endre tilstanden. */
export function peekUndo(state: QueueState): QueueUndoEntry | null {
  return state.undo[state.undo.length - 1] ?? null;
}
