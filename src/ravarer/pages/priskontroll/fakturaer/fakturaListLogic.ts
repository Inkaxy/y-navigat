/** Filtre, klientfiltrering og CSV for Fakturaer-fanen. Rene funksjoner. */
import type { InboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";
import { INVOICE_SOURCES, INVOICE_STATUSES } from "@/fakturaer/lib/constants";
import { getPaidBadgeInfo } from "@/fakturaer/lib/paidStatus";

export interface FakturaFilters {
  q: string;
  leverandor: string | null;
  status: string | null;
  fra: string | null;
  til: string | null;
  avvik: boolean;
  betalt: "betalt" | "ubetalt" | null;
  kilde: string | null;
  kreditnota: boolean;
  lavSikkerhet: boolean;
}

/** URL-nøklene filtrene bruker — «Nullstill» fjerner bare disse (og side). */
export const FILTER_KEYS = ["q", "leverandor", "status", "fra", "til", "avvik", "betalt", "kilde", "kreditnota", "lav", "side"] as const;

export const LOW_CONFIDENCE = 0.7;

export function parseFilters(sp: URLSearchParams): FakturaFilters {
  const b = sp.get("betalt");
  return {
    q: sp.get("q") ?? "",
    leverandor: sp.get("leverandor"),
    status: sp.get("status"),
    fra: sp.get("fra"),
    til: sp.get("til"),
    avvik: sp.get("avvik") === "1",
    betalt: b === "betalt" || b === "ubetalt" ? b : null,
    kilde: sp.get("kilde"),
    kreditnota: sp.get("kreditnota") === "1",
    lavSikkerhet: sp.get("lav") === "1",
  };
}

export function hasActiveFilters(f: FakturaFilters): boolean {
  return !!(f.q.trim() || f.leverandor || f.status || f.fra || f.til || f.avvik || f.betalt || f.kilde || f.kreditnota || f.lavSikkerhet);
}

/** Søk på leverandør, fakturanummer eller bilagsnummer. */
export function matchesSearch(inv: Pick<InboxInvoice, "invoice_number" | "supplier_name" | "tripletex_voucher_number">, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return (
    inv.invoice_number.toLowerCase().includes(t) ||
    (inv.supplier_name ?? "").toLowerCase().includes(t) ||
    (inv.tripletex_voucher_number ?? "").toLowerCase().includes(t)
  );
}

/** Samme filtre som serveren bruker, for de åpne fakturaene som hentes samlet. */
export function matchesFilters(inv: InboxInvoice, f: FakturaFilters): boolean {
  if (!matchesSearch(inv, f.q)) return false;
  if (f.leverandor && inv.supplier_id !== f.leverandor) return false;
  if (f.status && inv.status !== f.status) return false;
  if (f.fra && inv.invoice_date < f.fra) return false;
  if (f.til && inv.invoice_date > f.til) return false;
  if (f.avvik && inv.lines_sum_status !== "mismatch") return false;
  if (f.betalt === "betalt" && !inv.paid_at) return false;
  if (f.betalt === "ubetalt" && (inv.paid_at || inv.tripletex_is_paid !== false)) return false;
  if (f.kilde && inv.source !== f.kilde) return false;
  if (f.kreditnota && !inv.is_credit_note) return false;
  if (f.lavSikkerhet && !(inv.extraction_confidence != null && inv.extraction_confidence < LOW_CONFIDENCE)) return false;
  return true;
}

const statusLabel = (s: string) => INVOICE_STATUSES.find((x) => x.value === s)?.label ?? s;
const sourceLabel = (s: string | null) => (s ? INVOICE_SOURCES.find((x) => x.value === s)?.label ?? s : "");
const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const nok = (v: number | null) => (v == null ? "" : v.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** CSV med norske kolonnenavn og verdier (semikolon, som Excel på norsk forventer). */
export function toCsv(rows: readonly InboxInvoice[]): string {
  const head = ["Leverandør", "Fakturanr", "Bilagsnr", "Fakturadato", "Mottatt", "Forfall", "Beløp", "Status", "Linjer avklart", "Linjer totalt", "Kilde", "Betalt", "Kreditnota"];
  const lines = rows.map((r) =>
    [
      r.supplier_name, r.invoice_number, r.tripletex_voucher_number, r.invoice_date, r.received_at?.slice(0, 10) ?? "", r.due_date ?? "",
      nok(r.total_amount), statusLabel(r.status), r.assessment.doneCount, r.line_count, sourceLabel(r.source),
      getPaidBadgeInfo(r.paid_at, r.tripletex_is_paid).label, r.is_credit_note ? "Ja" : "Nei",
    ].map(csvCell).join(";"),
  );
  return [head.join(";"), ...lines].join("\n");
}
