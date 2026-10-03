// Ren logikk for hvordan en sak presenteres i lister: avsluttet vs åpen,
// venteflagg og neste handling. Holdes testbar og fri for React.
import type { TicketStatus } from "@/ordre/hooks/useTickets";

/** Løst, lukket og søppel er avsluttet — ingen aktiv frist eller hurtighandling. */
export function isTerminalTicket(status: TicketStatus): boolean {
  return status === "resolved" || status === "closed" || status === "spam";
}

export const TERMINAL_ACTION_LABEL: Record<"resolved" | "closed" | "spam", string> = {
  resolved: "Løst — ingen handling nødvendig",
  closed: "Lukket",
  spam: "Merket som søppel",
};

export interface NextActionInput {
  status: TicketStatus;
  assigned_to: string | null;
  related_order_id: string | null;
  intent: string | null;
  awaitingCustomer: boolean;
  awaiting_internal?: boolean;
  awaiting_external?: boolean;
  /** Antall ordrer via ticket_order_links (i tillegg til related_order_id). */
  linkedOrderCount?: number;
}

/** Kort, handlingsrettet neste steg basert på tilstanden saken faktisk er i. */
export function nextActionFor(row: NextActionInput): string {
  if (row.status === "resolved" || row.status === "closed" || row.status === "spam") {
    return TERMINAL_ACTION_LABEL[row.status];
  }
  if (row.awaitingCustomer) return "Venter på kunde";
  if (row.awaiting_internal) return "Venter på intern avklaring";
  if (row.awaiting_external) return "Venter på ekstern part";
  if (!row.assigned_to) return "Trenger ansvarlig";
  const hasOrder = !!row.related_order_id || (row.linkedOrderCount ?? 0) > 0;
  if (!hasOrder && row.intent !== "question") return "Koble til ordre";
  return "Svar kunden";
}

/** Fjerner valgte saker som ikke lenger er synlige i køen/filteret. */
export function pruneSelection(selection: Set<string>, visibleIds: Iterable<string>): Set<string> {
  const visible = new Set(visibleIds);
  let changed = false;
  const next = new Set<string>();
  for (const id of selection) {
    if (visible.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : selection;
}
