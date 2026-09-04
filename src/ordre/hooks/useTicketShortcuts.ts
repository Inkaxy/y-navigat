// Tastaturlag for ticket-arbeidsflaten.
//
// Regel: snarveier utløses ALDRI mens brukeren skriver i et felt. Cmd/Ctrl+Enter
// er eneste unntak — den er «send» og skal fungere fra skrivefeltet.
import { useEffect } from "react";

export type TicketShortcutHandlers = {
  onNext?: () => void;
  onPrev?: () => void;
  onReply?: () => void;
  onAssignSelf?: () => void;
  onLinkOrder?: () => void;
  onResolve?: () => void;
  onSend?: () => void;
  onHelp?: () => void;
};

/** Er fokus i et felt der tastetrykk er tekst, ikke kommando? */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el !== "object") return false;
  const tag = (el.tagName ?? "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  // Radix-menyer og dialoger fanger egne taster.
  if (typeof el.closest === "function" && el.closest("[role='dialog'],[role='menu'],[role='listbox']")) {
    return true;
  }
  return false;
}

export const TICKET_SHORTCUTS: { keys: string; description: string }[] = [
  { keys: "J", description: "Neste sak i listen" },
  { keys: "K", description: "Forrige sak i listen" },
  { keys: "R", description: "Svar til kunde" },
  { keys: "A", description: "Ta saken selv" },
  { keys: "L", description: "Koble til ordre" },
  { keys: "E", description: "Ferdigbehandle saken" },
  { keys: "Ctrl/Cmd + Enter", description: "Send svaret" },
  { keys: "?", description: "Vis snarveier" },
];

export function useTicketShortcuts(handlers: TicketShortcutHandlers, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target);

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (handlers.onSend) {
          e.preventDefault();
          handlers.onSend();
        }
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      const map: Record<string, (() => void) | undefined> = {
        j: handlers.onNext,
        k: handlers.onPrev,
        r: handlers.onReply,
        a: handlers.onAssignSelf,
        l: handlers.onLinkOrder,
        e: handlers.onResolve,
        "?": handlers.onHelp,
      };
      const fn = map[e.key.toLowerCase()] ?? (e.key === "?" ? handlers.onHelp : undefined);
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, handlers]);
}
