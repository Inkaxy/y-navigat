/**
 * Utvelgelse av SLA-brudd som skal varsles.
 *
 * Vi varsler kun brukeren selv — for saker vedkommende er ansvarlig for eller
 * har åpen akkurat nå — og kun én gang per sak. Dedupliseringen skjer klientside
 * (localStorage) fordi det ikke finnes et eget hendelsestype for SLA-brudd.
 */

export type SlaBreachCandidate = {
  id: string;
  subject: string | null;
  status: string;
  assigned_to: string | null;
  deadline: Date | null;
};

export const SLA_BREACH_STORAGE_KEY = "nbhub:ordre:sla-breach-varslet";

export function pickSlaBreaches(
  rows: SlaBreachCandidate[],
  opts: {
    userId: string | null;
    openTicketId?: string | null;
    now?: Date;
    alreadyNotified?: Iterable<string>;
  },
): SlaBreachCandidate[] {
  if (!opts.userId) return [];
  const now = opts.now ?? new Date();
  const seen = new Set(opts.alreadyNotified ?? []);
  return rows.filter((r) => {
    if (seen.has(r.id)) return false;
    if (r.status !== "new" && r.status !== "in_progress") return false;
    if (!r.deadline || r.deadline.getTime() > now.getTime()) return false;
    return r.assigned_to === opts.userId || r.id === opts.openTicketId;
  });
}

export function readNotifiedBreaches(): string[] {
  try {
    const raw = localStorage.getItem(SLA_BREACH_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function rememberNotifiedBreaches(ids: string[]): void {
  try {
    // Holder listen kort slik at localStorage ikke vokser i det uendelige.
    const next = [...readNotifiedBreaches(), ...ids].slice(-500);
    localStorage.setItem(SLA_BREACH_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ingen lagring tilgjengelig — da varsles saken på nytt senere. Akseptabelt.
  }
}
