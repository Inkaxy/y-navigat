import { useEffect, useRef } from "react";

/**
 * Felles vakt for hurtigtaster: ingen snarveier mens brukeren skriver i et felt,
 * har en dialog/meny åpen, eller holder en modifikatortast.
 */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const el = e.target instanceof HTMLElement ? e.target : null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  // En knapp med fokus svelger bare Enter og mellomrom (knappens egen aktivering).
  if (el.closest("button") && (e.key === "Enter" || e.key === " ")) return true;
  if (el.closest('[role="combobox"], [role="dialog"], [role="menu"], [role="listbox"]')) return true;
  return false;
}

export type HotkeyBinding = {
  /** Tast(er) slik `KeyboardEvent.key` rapporterer dem, f.eks. "j", "ArrowDown", "?". */
  keys: string[];
  description: string;
  handler: (e: KeyboardEvent) => void;
  /** Vis i hurtigtastlisten (standard: ja). */
  listed?: boolean;
  /** Krever ⌘/Ctrl og virker også mens man skriver i et felt (f.eks. ⌘S). */
  mod?: boolean;
};

/** Finner bindingen for en tast (bokstaver uavhengig av store/små). */
export function matchBinding(bindings: HotkeyBinding[], key: string, mod = false): HotkeyBinding | null {
  const k = key.length === 1 ? key.toLowerCase() : key;
  return bindings.find((b) => !!b.mod === mod && b.keys.some((bk) => (bk.length === 1 ? bk.toLowerCase() : bk) === k)) ?? null;
}

/** Registrerer hurtigtaster på vinduet så lenge `enabled` er sann. */
export function useHotkeys(bindings: HotkeyBinding[], { enabled = true }: { enabled?: boolean } = {}) {
  const ref = useRef(bindings);
  ref.current = bindings;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const m = matchBinding(ref.current, e.key, true);
        if (m) {
          e.preventDefault();
          m.handler(e);
          return;
        }
      }
      if (shouldIgnoreShortcut(e)) return;
      const b = matchBinding(ref.current, e.key);
      if (!b) return;
      e.preventDefault();
      b.handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** Pen visning av en tast i hurtigtastlisten. */
export function keyLabel(k: string, mod = false): string {
  if (mod) return `⌘/Ctrl+${keyLabel(k)}`;
  const map: Record<string, string> = { ArrowDown: "↓", ArrowUp: "↑", ArrowLeft: "←", ArrowRight: "→", Enter: "Enter", Escape: "Esc", " ": "Mellomrom" };
  return map[k] ?? (k.length === 1 ? k.toUpperCase() : k);
}
