/**
 * Godkjenning-fanen: hurtigfiltre og filtrering. Rene funksjoner (testes).
 */
import { approvalBucket, type OverviewRow } from "@/fakturaer/lib/approval";
import { costPostingAllowed } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";

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
 * «Kostpris kan føres»: samme regel som `rm_post_safe_line_costs` — åpen status
 * (imported/needs_review/ready), ikke kreditnota, og ingen kostpris ført ennå.
 * Godkjenning kreves IKKE. Hvilke linjer som er trygge avgjør serveren.
 */
export function canPostCosts(r: Pick<OverviewRow, "status" | "is_credit_note" | "cost_posted_lines">): boolean {
  return costPostingAllowed(r) && r.cost_posted_lines === 0;
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

/** Samlet resultat etter kostprisføring, med feil per faktura. */
export function costReport(
  results: readonly { invoiceId: string; posted: number; skipped: number; error: string | null }[],
  numberOf: (id: string) => string,
): BulkReport {
  const posted = results.reduce((a, r) => a + r.posted, 0);
  const skipped = results.reduce((a, r) => a + r.skipped, 0);
  const failedRows = results.filter((r) => r.error);
  const ok = results.length - failedRows.length;
  return {
    ok, failed: failedRows.length,
    title: failedRows.length === 0
      ? `Kostpris ført på ${posted} trygge linjer (${ok} av ${results.length} fakturaer)`
      : `Kostpris ført på ${posted} trygge linjer, ${failedRows.length} av ${results.length} fakturaer feilet`,
    items: [
      ...(skipped ? [`${skipped} linjer venter på avklaring`] : []),
      ...failedRows.map((f) => `${numberOf(f.invoiceId)}: ${f.error}`),
    ],
  };
}

export const APPROVER_ROLE_TEXT = "Intern godkjenning krever godkjenner- eller admin-rolle";
export const WRITE_ROLE_TEXT = "Føring av kostpris krever skrivetilgang til fakturaer";

/**
 * Massehandlingene i Godkjenning. Samme regler som databasen: godkjenning
 * krever approve/admin, kostprisføring krever skrivetilgang.
 */
export function bulkActionGate(r: { canApprove: boolean; canWrite: boolean }) {
  return {
    approve: r.canApprove,
    approveReason: r.canApprove ? null : APPROVER_ROLE_TEXT,
    costs: r.canWrite,
    costsReason: r.canWrite ? null : WRITE_ROLE_TEXT,
  };
}
