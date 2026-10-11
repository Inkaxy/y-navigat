import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { Column } from "@/ravarer/ui/DataTable";
import type { InboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";
import { formatDate, formatNok, INVOICE_SOURCES, todayIso } from "@/fakturaer/lib/constants";
import { getPaidBadgeInfo } from "@/fakturaer/lib/paidStatus";
import { extrasFor, type DeliveryExtrasMap } from "@/ravarer/hooks/useInvoiceDeliveryStatus";
import { DeliveryTimeline } from "@/ravarer/pages/priskontroll/faktura/DeliveryTimeline";
import { deliverySteps } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";

export function stepsOf(inv: InboxInvoice, extras: DeliveryExtrasMap | undefined) {
  return deliverySteps(
    {
      status: inv.status, received_at: inv.received_at, line_count: inv.line_count, lines_source: inv.lines_source,
      line_extraction_status: inv.line_extraction_status, open_count: inv.assessment.openCount,
      lines_sum_status: inv.lines_sum_status, reconciled_mode: inv.reconciled_mode,
    },
    extrasFor(extras, inv.id),
  );
}

const PAID_TONE: Record<string, string> = {
  success: "border-success/30 bg-success/15 text-success",
  warning: "border-warning/30 bg-warning/15 text-warning",
  muted: "border-border bg-muted text-ink-secondary",
};

export function isOverdue(inv: Pick<InboxInvoice, "due_date" | "status">): boolean {
  return inv.status !== "reconciled" && !!inv.due_date && inv.due_date.slice(0, 10) < todayIso();
}

export function LinesProgress({ inv }: { inv: InboxInvoice }) {
  const total = inv.line_count;
  if (total === 0) return <span className="text-ink-secondary">Ingen linjer</span>;
  const done = inv.assessment.doneCount;
  return (
    <div className="min-w-[110px]">
      <span className="text-caption">{done} av {total} avklart</span>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${done} av ${total} linjer avklart`} aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
        <div className="h-full bg-primary" style={{ width: `${Math.round((done / total) * 100)}%` }} />
      </div>
    </div>
  );
}

export function fakturaColumns(extras: DeliveryExtrasMap | undefined, actions: (inv: InboxInvoice) => ReactNode): Column<InboxInvoice>[] {
  return [
    { id: "leverandor", header: "Leverandør", cell: (r) => <span className="font-medium">{r.supplier_name ?? "Ukjent leverandør"}</span>, sortKey: (r) => r.supplier_name },
    { id: "nr", header: "Fakturanr", cell: (r) => <span className="font-mono text-xs">{r.invoice_number}</span>, sortKey: (r) => r.invoice_number },
    { id: "dato", header: "Fakturadato", cell: (r) => formatDate(r.invoice_date), sortKey: (r) => r.invoice_date, hideable: true },
    { id: "mottatt", header: "Mottatt", cell: (r) => formatDate(r.received_at), sortKey: (r) => r.received_at, hideable: true },
    {
      id: "forfall", header: "Forfall", hideable: true, sortKey: (r) => r.due_date,
      cell: (r) => <span className={isOverdue(r) ? "font-medium text-destructive" : undefined}>{formatDate(r.due_date)}</span>,
    },
    { id: "belop", header: "Beløp", align: "right", cell: (r) => formatNok(r.total_amount), sortKey: (r) => r.total_amount },
    { id: "linjer", header: "Linjer", cell: (r) => <LinesProgress inv={r} />, sortKey: (r) => r.assessment.openCount, hideable: true },
    {
      id: "leveranse", header: "Leveransestatus", hideable: true,
      cell: (r) => <DeliveryTimeline steps={stepsOf(r, extras)} flagged={r.status === "flagged"} creditNote={!!r.is_credit_note} showLabel />,
      sortKey: (r) => stepsOf(r, extras).filter((s) => s.done).length,
    },
    { id: "kilde", header: "Kilde", hideable: true, cell: (r) => INVOICE_SOURCES.find((s) => s.value === r.source)?.label ?? r.source ?? "—" },
    {
      id: "betalt", header: "Betalt", hideable: true,
      cell: (r) => { const p = getPaidBadgeInfo(r.paid_at, r.tripletex_is_paid); return <Badge variant="outline" className={PAID_TONE[p.tone]}>{p.label}</Badge>; },
    },
    { id: "bilag", header: "Bilagsnr", hideable: true, defaultHidden: true, cell: (r) => r.tripletex_voucher_number ?? "—", sortKey: (r) => r.tripletex_voucher_number },
    { id: "handling", header: "", align: "right", cell: (r) => actions(r) },
  ];
}
