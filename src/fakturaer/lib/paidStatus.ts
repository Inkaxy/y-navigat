import { formatDate } from "@/fakturaer/lib/constants";

export type PaidTone = "success" | "warning" | "muted";

export interface PaidBadgeInfo {
  label: string;
  tone: PaidTone;
}

/**
 * Betalingsstatus for en faktura, avledet fra Tripletex-feltene
 * `paid_at` og `tripletex_is_paid`.
 *
 * - `paid_at` satt → «Betalt dd.mm.åååå»
 * - `tripletex_is_paid === false` → «Ubetalt»
 * - ellers (ukjent/ikke synkronisert ennå) → «—»
 */
export function getPaidBadgeInfo(
  paidAt: string | null | undefined,
  tripletexIsPaid: boolean | null | undefined,
): PaidBadgeInfo {
  if (paidAt) {
    return { label: `Betalt ${formatDate(paidAt)}`, tone: "success" };
  }
  if (tripletexIsPaid === false) {
    return { label: "Ubetalt", tone: "warning" };
  }
  return { label: "—", tone: "muted" };
}
