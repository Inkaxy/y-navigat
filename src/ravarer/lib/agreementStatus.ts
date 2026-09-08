import { osloTodayISO } from "@/lib/osloDate";

/** Gyldighetsstatus for en leverandøravtale. */
export type AgreementStatus = "upcoming" | "active" | "expiring_30" | "expiring_90" | "expired";

export const AGREEMENT_STATUS_LABEL: Record<AgreementStatus, string> = {
  upcoming: "Kommende",
  active: "Aktiv",
  expiring_30: "Utløper ≤ 30 d",
  expiring_90: "Utløper ≤ 90 d",
  expired: "Utløpt",
};

export const AGREEMENT_STATUS_CLASS: Record<AgreementStatus, string> = {
  upcoming: "border-info/30 bg-info/10 text-info",
  active: "border-success/30 bg-success/10 text-success",
  expiring_30: "border-destructive/40 bg-destructive/10 text-destructive",
  expiring_90: "border-warning/30 bg-warning/10 text-warning",
  expired: "border-destructive/50 bg-destructive/15 text-destructive",
};

/** Rekkefølgen statusene vises i som filterknapper. */
export const AGREEMENT_STATUS_ORDER: AgreementStatus[] = [
  "upcoming",
  "active",
  "expiring_30",
  "expiring_90",
  "expired",
];

function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((to - from) / 86400000);
}

/**
 * Regner ut gyldighetsstatus. En avtale som starter i framtiden er «Kommende»,
 * ikke «Aktiv» — det var feil i den gamle logikken, som bare så på sluttdatoen.
 */
export function getAgreementStatus(
  validFrom: string | null | undefined,
  validTo: string | null | undefined,
  todayISO: string = osloTodayISO(),
): AgreementStatus {
  const from = validFrom ? validFrom.slice(0, 10) : null;
  const to = validTo ? validTo.slice(0, 10) : null;

  if (to && to < todayISO) return "expired";
  if (from && from > todayISO) return "upcoming";
  if (!to) return "active";

  const days = daysBetween(todayISO, to);
  if (days <= 30) return "expiring_30";
  if (days <= 90) return "expiring_90";
  return "active";
}

/** Antall avtaler som utløper innen 30 dager — brukes som merke i menyen. */
export function countExpiringSoon(
  rows: { agreement_valid_from: string | null; agreement_valid_to: string | null }[],
  todayISO: string = osloTodayISO(),
): number {
  return rows.filter(
    (r) => getAgreementStatus(r.agreement_valid_from, r.agreement_valid_to, todayISO) === "expiring_30",
  ).length;
}
