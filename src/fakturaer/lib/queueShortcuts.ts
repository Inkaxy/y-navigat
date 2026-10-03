import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

/** Samme vakter som i Vareliste: ingen hurtigtaster mens brukeren skriver eller i dialog. */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const el = e.target instanceof HTMLElement ? e.target : null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  // En knapp med fokus skal bare svelge Enter og mellomrom — den er knappens
  // egen aktivering. Alle andre hurtigtaster skal fortsatt virke.
  if (el.closest("button") && (e.key === "Enter" || e.key === " ")) return true;
  if (el.closest('[role="combobox"], [role="dialog"], [role="menu"], [role="listbox"]')) return true;
  return false;
}

export type ShortcutDialog = "match" | "create" | "not_rm";

export interface QueueShortcutContext {
  /** Køen/oppgaven er faktisk synlig (åpen faktura eller linjer på tvers vist). */
  queueVisible: boolean;
  dialogOpen: boolean;
  activeLine: ReviewLineRow | null;
  canAcceptWithEnter: (line: ReviewLineRow) => boolean;
  next: () => void;
  prev: () => void;
  accept: (line: ReviewLineRow) => void;
  openDialog: (kind: ShortcutDialog, line: ReviewLineRow) => void;
  undo: () => void;
}

/**
 * Håndterer køens hurtigtaster. Når køen ikke er synlig gjøres ingenting —
 * piltaster scroller da som vanlig, og en usynlig aktiv linje kan ikke
 * godkjennes eller åpnes.
 */
export function handleQueueShortcut(e: KeyboardEvent, ctx: QueueShortcutContext): void {
  if (!ctx.queueVisible || ctx.dialogOpen || shouldIgnoreShortcut(e)) return;
  const line = ctx.activeLine;
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      ctx.next();
      break;
    case "ArrowUp":
      e.preventDefault();
      ctx.prev();
      break;
    case "Enter":
      e.preventDefault();
      // Enter godtar bare et råvareforslag — aldri en linje med pakning eller prisavvik.
      if (!e.shiftKey && line && ctx.canAcceptWithEnter(line)) ctx.accept(line);
      break;
    case "m":
    case "M":
      if (line) {
        e.preventDefault();
        ctx.openDialog("match", line);
      }
      break;
    case "n":
    case "N":
      if (line) {
        e.preventDefault();
        ctx.openDialog("create", line);
      }
      break;
    case "x":
    case "X":
      // Utelatelse krever en grunn — åpne dialogen i stedet for å markere direkte.
      if (line) {
        e.preventDefault();
        ctx.openDialog("not_rm", line);
      }
      break;
    case "u":
    case "U":
      e.preventDefault();
      ctx.undo();
      break;
    default:
      break;
  }
}
