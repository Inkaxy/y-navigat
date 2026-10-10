import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

import { shouldIgnoreShortcut } from "@/ravarer/ui/hotkeys";

/** Felles vakt fra Råvarer-hurtigtastene (samme regler som før). */
export { shouldIgnoreShortcut };

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
