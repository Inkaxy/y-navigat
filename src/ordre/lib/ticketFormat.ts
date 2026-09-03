// Felles formattering og norske etiketter for ticket-systemet.
// ALT som vises i UI skal gå via disse — ingen rå engelske koder på skjermen.
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import type { TicketStatus, TicketPriority } from "@/ordre/hooks/useTickets";

/** Ett felles absolutt tidsformat overalt: «tor 3. sep 2026, 14:05». */
export function formatTicketTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "EEE d. MMM yyyy, HH:mm", { locale: nb });
}

/** Kort variant til tette lister: «tor 3. sep, 14:05». */
export function formatTicketTimeShort(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "EEE d. MMM, HH:mm", { locale: nb });
}

/** Relativ tid — brukes KUN i tooltip, aldri som hovedtidsstempel. */
export function formatTicketRelative(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  if (typeof Intl === "undefined" || typeof Intl.RelativeTimeFormat !== "function") {
    return formatTicketTimeShort(d);
  }
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("nb-NO", { numeric: "auto" });
  const abs = Math.abs(sec);
  if (abs < 60) return rtf.format(-sec, "second");
  if (abs < 3600) return rtf.format(-Math.round(sec / 60), "minute");
  if (abs < 86400) return rtf.format(-Math.round(sec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(-Math.round(sec / 86400), "day");
  return rtf.format(-Math.round(sec / (86400 * 30)), "month");
}

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  new: "Ny",
  in_progress: "Under behandling",
  resolved: "Løst",
  closed: "Lukket",
  spam: "Søppel",
};

export const TICKET_STATUS_STYLE: Record<TicketStatus, string> = {
  new: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  in_progress: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  resolved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  closed: "border-border bg-muted text-muted-foreground",
  spam: "border-border bg-muted text-muted-foreground line-through",
};

export const TICKET_STATUSES: TicketStatus[] = [
  "new",
  "in_progress",
  "resolved",
  "closed",
  "spam",
];

export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "Lav",
  normal: "Normal",
  high: "Høy",
  urgent: "Haster",
};

export const TICKET_PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

/** Prikkfarge for prioritet i lister. */
export const TICKET_PRIORITY_DOT: Record<TicketPriority, string> = {
  low: "bg-muted-foreground/40",
  normal: "bg-sky-500",
  high: "bg-amber-500",
  urgent: "bg-red-500",
};

/** Leveringsstatus for et utgående svar — aldri «sent»/«pending» i UI. */
export function sendStatusLabel(
  status: "pending" | "sent" | "failed",
  errorMessage?: string | null,
): string {
  if (status === "sent") return "Sendt";
  if (status === "pending") return "Sender …";
  return errorMessage ? `Feilet: ${errorMessage}` : "Feilet";
}

/** «T-1a2b3c4d» */
export function ticketShortId(id: string): string {
  return `T-${id.slice(0, 8)}`;
}

/** Initialer fra navn, med e-post som siste utvei. */
export function ticketInitials(
  name: string | null | undefined,
  email?: string | null,
): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}
