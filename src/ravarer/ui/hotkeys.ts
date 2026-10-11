import { useEffect, useRef } from "react";

/**
 * Felles vakt for hurtigtaster: ingen snarveier mens brukeren skriver i et felt,
 * har en dialog/meny åpen, eller holder en modifikatortast.
 */
export function shouldIgnoreShortcut(e: KeyboardEvent, opts: { allowWithin?: string } = {}): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  // Allerede håndtert av et fokusert element (f.eks. mobilkortets Enter): aldri en handling til.
  if (e.defaultPrevented) return true;
  const el = e.target instanceof HTMLElement ? e.target : null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  // En knapp med fokus svelger bare Enter og mellomrom (knappens egen aktivering).
  if (el.closest('button, a[href], [role="button"], [role="link"], [role="checkbox"], [role="switch"]') && (e.key === "Enter" || e.key === " ")) return true;
  if (el.closest('[role="combobox"], [role="menu"], [role="listbox"]')) return true;
  // Et panel som er en del av arbeidsflaten (f.eks. inspektørens Sheet) kan tillate snarveier.
  if (el.closest('[role="dialog"]') && !(opts.allowWithin && el.closest(opts.allowWithin))) return true;
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
  /** Tastesekvens, f.eks. ["g", "p"]. `keys` brukes da bare til visning (f.eks. ["g p"]). */
  sequence?: string[];
};

const SEQUENCE_MS = 1200;

/** Finner en sekvensbinding som fullføres av `key` etter `prev` (begge små bokstaver). */
export function matchSequence(bindings: HotkeyBinding[], prev: string | null, key: string): HotkeyBinding | null {
  if (!prev) return null;
  const k = key.toLowerCase();
  return bindings.find((b) => b.sequence?.length === 2 && b.sequence[0].toLowerCase() === prev && b.sequence[1].toLowerCase() === k) ?? null;
}

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
    let prev: { key: string; at: number } | null = null;
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
      const recent = prev && Date.now() - prev.at < SEQUENCE_MS ? prev.key : null;
      const seq = matchSequence(ref.current, recent, e.key);
      prev = e.key.length === 1 ? { key: e.key.toLowerCase(), at: Date.now() } : null;
      if (seq) {
        prev = null;
        e.preventDefault();
        seq.handler(e);
        return;
      }
      const b = matchBinding(ref.current.filter((x) => !x.sequence), e.key);
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
