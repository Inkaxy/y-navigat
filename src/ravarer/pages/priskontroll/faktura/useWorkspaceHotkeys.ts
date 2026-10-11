import { useEffect } from "react";
import { shouldIgnoreShortcut } from "@/ravarer/ui/hotkeys";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

export type WorkspaceKeys = {
  enabled: boolean;
  /** Linjene kan endres (skrivetilgang og fakturaen er ikke avstemt/flagget). */
  canWrite: boolean;
  activeLine: ReviewLineRow | null;
  next: () => void;
  prev: () => void;
  /** Enter: godta toppforslag når det er alt som gjenstår, ellers klikk hovedknappen i inspektøren. */
  enter: (l: ReviewLineRow | null) => void;
  editMaterial: () => void;
  create: (l: ReviewLineRow) => void;
  notItem: (l: ReviewLineRow) => void;
  undo: () => void;
  toggleDoc: () => void;
  escape: () => void;
  help: () => void;
};

/** Inspektørens Sheet er en del av arbeidsflaten — snarveier virker der (unntatt i felt). */
export const INSPECTOR_SHEET = "[data-inspector-sheet]";

/** ↑/↓ J/K, Enter, M, N, X, U, D, Esc og ? i faktura-arbeidsflaten. */
export function workspaceKey(e: KeyboardEvent, k: WorkspaceKeys): boolean {
  if (!k.enabled || shouldIgnoreShortcut(e, { allowWithin: INSPECTOR_SHEET })) return false;
  const l = k.activeLine;
  switch (e.key) {
    case "ArrowDown": case "j": case "J": k.next(); return true;
    case "ArrowUp": case "k": case "K": k.prev(); return true;
    case "Enter": if (e.shiftKey || !k.canWrite) return false; k.enter(l); return true;
    case "m": case "M": if (!l || !k.canWrite) return false; k.editMaterial(); return true;
    case "n": case "N": if (!l || !k.canWrite) return false; k.create(l); return true;
    case "x": case "X": if (!l || !k.canWrite) return false; k.notItem(l); return true;
    case "u": case "U": if (!k.canWrite) return false; k.undo(); return true;
    case "d": case "D": k.toggleDoc(); return true;
    case "Escape": k.escape(); return true;
    case "?": k.help(); return true;
    default: return false;
  }
}

export function useWorkspaceHotkeys(k: WorkspaceKeys) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (workspaceKey(e, k)) e.preventDefault(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [k]);
}
