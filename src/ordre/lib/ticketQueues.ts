// Arbeidskøer for Ticket/Innboks.
//
// Ordrekontoret trenger få, tydelige innganger. Fire primærkøer dekker hele
// arbeidsdagen; alt annet er sekundære filtre. Logikken er ren og testbar slik
// at både innboksen og tellerne aldri kan komme i utakt.
import type { RequestType } from "@/ordre/lib/aiSuggestion";
import type { TicketPriority, TicketStatus } from "@/ordre/hooks/useTickets";
import type { TicketTeam } from "@/ordre/lib/teams";

export type PrimaryQueue = "mine" | "unassigned" | "now" | "waiting";

export type SecondaryQueue =
  | "all_open"
  | "resolved"
  | "closed"
  | "spam"
  | `intent:${RequestType}`
  | `team:${TicketTeam}`;

export type QueueKey = PrimaryQueue | SecondaryQueue;

export const PRIMARY_QUEUES: {
  key: PrimaryQueue;
  label: string;
  description: string;
}[] = [
  { key: "mine", label: "Mine", description: "Saker du er ansvarlig for" },
  { key: "unassigned", label: "Ufordelte", description: "Ingen har tatt saken" },
  { key: "now", label: "Må tas nå", description: "Over frist eller haster" },
  { key: "waiting", label: "Venter", description: "Venter på kunde eller intern" },
];

/** Minimum en rad må ha for å kunne køfiltreres. */
export interface QueueTicket {
  id: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigned_to: string | null;
  assigned_team?: TicketTeam | null;
  intent?: RequestType | null;
  overdue?: boolean;
  awaitingCustomer?: boolean;
  awaiting_internal?: boolean;
  awaiting_external?: boolean;
}

/** Åpen = ubehandlet eller under arbeid. */
export function isOpenTicket(t: Pick<QueueTicket, "status">): boolean {
  return t.status === "new" || t.status === "in_progress";
}

/** Saken venter på noen andre — kunde, intern kollega eller ekstern part. */
export function isWaiting(t: QueueTicket): boolean {
  return !!(t.awaitingCustomer || t.awaiting_internal || t.awaiting_external);
}

/**
 * «Må tas nå» = åpen sak som ikke venter på noen andre, og som enten er
 * over frist eller merket som haster.
 */
export function isMustHandleNow(t: QueueTicket): boolean {
  if (!isOpenTicket(t) || isWaiting(t)) return false;
  return !!t.overdue || t.priority === "urgent";
}

export function matchesQueue(
  t: QueueTicket,
  queue: QueueKey,
  userId: string | null | undefined,
): boolean {
  switch (queue) {
    case "mine":
      return isOpenTicket(t) && !!userId && t.assigned_to === userId;
    case "unassigned":
      return isOpenTicket(t) && t.assigned_to == null;
    case "now":
      return isMustHandleNow(t);
    case "waiting":
      return isOpenTicket(t) && isWaiting(t);
    case "all_open":
      return isOpenTicket(t);
    case "resolved":
      return t.status === "resolved";
    case "closed":
      return t.status === "closed";
    case "spam":
      return t.status === "spam";
    default:
      if (queue.startsWith("intent:")) {
        return isOpenTicket(t) && t.intent === queue.slice("intent:".length);
      }
      if (queue.startsWith("team:")) {
        return isOpenTicket(t) && t.assigned_team === queue.slice("team:".length);
      }
      return isOpenTicket(t);
  }
}

/** Antall per kø — brukes av venstrepanelet. */
export function countQueues<T extends QueueTicket>(
  rows: T[],
  userId: string | null | undefined,
  queues: QueueKey[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of queues) out[q] = rows.filter((r) => matchesQueue(r, q, userId)).length;
  return out;
}

/** Køer som viser avsluttede saker sorteres på siste aktivitet, ikke frist. */
export function isArchiveQueue(queue: QueueKey): boolean {
  return queue === "resolved" || queue === "closed" || queue === "spam";
}

const KNOWN_FIXED: QueueKey[] = [
  "mine",
  "unassigned",
  "now",
  "waiting",
  "all_open",
  "resolved",
  "closed",
  "spam",
];

/**
 * Køen ligger i URL-en. Ukjente og utdaterte verdier faller tilbake til
 * «Mine» slik at gamle lenker aldri gir en tom skjerm.
 */
export function parseQueueParam(
  raw: string | null | undefined,
  opts: { intents: readonly string[]; teams: readonly string[] },
): QueueKey {
  if (!raw) return "mine";
  if ((KNOWN_FIXED as string[]).includes(raw)) return raw as QueueKey;
  // Bakoverkompatible aliaser fra forrige innboks.
  if (raw === "all") return "all_open";
  if (raw === "new") return "unassigned";
  if (raw === "awaiting_customer") return "waiting";
  if (raw.startsWith("intent:") && opts.intents.includes(raw.slice("intent:".length))) {
    return raw as QueueKey;
  }
  if (raw.startsWith("team:") && opts.teams.includes(raw.slice("team:".length))) {
    return raw as QueueKey;
  }
  return "mine";
}
