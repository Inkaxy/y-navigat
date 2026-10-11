/**
 * Godkjenning-fanen: hurtigfiltre og filtrering. Rene funksjoner (testes).
 */
import { approvalBucket, type OverviewRow } from "@/fakturaer/lib/approval";

export const GODKJENNING_STATUSER = ["klare", "avventer", "godkjent", "kostpris"] as const;
export type GodkjenningStatus = (typeof GODKJENNING_STATUSER)[number];

export const GODKJENNING_LABEL: Record<GodkjenningStatus, string> = {
  klare: "Klare",
  avventer: "Avventer",
  godkjent: "Godkjent",
  kostpris: "Kostpris kan føres",
};

/** Gamle verdier (ready/waiting/done fra InvoiceOverview) mappes til de nye. */
const LEGACY: Record<string, GodkjenningStatus> = { ready: "klare", waiting: "avventer", done: "godkjent" };

export function parseGodkjenningStatus(v: string | null): GodkjenningStatus {
  if (!v) return "klare";
  if ((GODKJENNING_STATUSER as readonly string[]).includes(v)) return v as GodkjenningStatus;
  return LEGACY[v] ?? "klare";
}

/**
 * «Kostpris kan føres»: godkjent, og ingen kostpris er ført ennå. Hvilke linjer
 * som er trygge avgjør serveren (`rm_post_safe_line_costs`) ved føring.
 */
export function canPostCosts(r: Pick<OverviewRow, "approved_at" | "cost_posted_lines">): boolean {
  return !!r.approved_at && r.cost_posted_lines === 0;
}

export function matchesStatus(r: OverviewRow, s: GodkjenningStatus): boolean {
  if (s === "kostpris") return canPostCosts(r);
  const b = approvalBucket(r);
  return s === "klare" ? b === "ready" : s === "avventer" ? b === "waiting" : b === "done";
}

export function countByStatus(rows: readonly OverviewRow[]): Record<GodkjenningStatus, number> {
  const c: Record<GodkjenningStatus, number> = { klare: 0, avventer: 0, godkjent: 0, kostpris: 0 };
  for (const r of rows) for (const s of GODKJENNING_STATUSER) if (matchesStatus(r, s)) c[s]++;
  return c;
}

export function filterApprovalRows(rows: readonly OverviewRow[], f: { status: GodkjenningStatus; q: string; leverandor: string | null }): OverviewRow[] {
  const s = f.q.trim().toLowerCase();
  return rows.filter((r) => matchesStatus(r, f.status)
    && (!f.leverandor || r.supplier_id === f.leverandor)
    && (!s || r.invoice_number.toLowerCase().includes(s) || (r.supplier_name ?? "").toLowerCase().includes(s)));
}

export type BulkReport = { ok: number; failed: number; title: string; items: string[] };

/** Samlet resultat etter massegodkjenning, med feil per faktura. */
export function approvalReport(
  results: readonly { invoiceId: string; ok: boolean; already: boolean; message: string | null }[],
  numberOf: (id: string) => string,
): BulkReport {
  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  const already = results.filter((r) => r.ok && r.already).length;
  const title = failed === 0 ? `${ok} av ${results.length} fakturaer godkjent` : `${ok} av ${results.length} godkjent, ${failed} feilet`;
  const items = [
    ...(already ? [`${already} var allerede godkjent`] : []),
    ...results.filter((r) => !r.ok).map((r) => `${numberOf(r.invoiceId)}: ${r.message ?? "Kunne ikke godkjenne"}`),
    "Intern godkjenning. Utløser ikke betaling og sendes ikke til Tripletex.",
  ];
  return { ok, failed, title, items };
}
