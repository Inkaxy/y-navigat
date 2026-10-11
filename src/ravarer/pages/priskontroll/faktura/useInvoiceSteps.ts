import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFakturaer } from "@/fakturaer/context/FakturaerContext";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import type { InvoiceDetailData } from "@/fakturaer/components/invoice-detail/fetchInvoiceDetail";
import { assessInboxInvoice, lineIsOpen, type InboxLine } from "@/fakturaer/lib/inbox";
import { approveInvoiceInternal } from "@/fakturaer/lib/approval";
import { postSafeCosts } from "@/fakturaer/lib/costPosting";
import { useInvoiceDeliveryStatus, extrasFor } from "@/ravarer/hooks/useInvoiceDeliveryStatus";
import { deliverySteps, nextInvoiceStep } from "./invoiceSteps";
import { invalidateInvoiceWork } from "./useInvoiceActions";

export type StepResult = { title: string; items: string[]; error?: boolean; undoable?: boolean } | null;

function toInboxLines(d: InvoiceDetailData): InboxLine[] {
  return (d.invoice_lines ?? []).map((l) => ({
    id: l.id, raw_material_id: l.raw_material_id, requires_review: l.requires_review, review_reason: l.review_reason,
    match_confidence: l.match_confidence, price_variance_pct: l.price_variance_pct == null ? null : Number(l.price_variance_pct),
    variance_status: l.variance_status, category: null, quantity: l.quantity == null ? null : Number(l.quantity),
    price_per_base_unit: l.price_per_base_unit == null ? null : Number(l.price_per_base_unit),
    invoice: { currency: d.currency, lines_sum_status: d.lines_sum_status, extraction_confidence: d.extraction_confidence == null ? null : Number(d.extraction_confidence) },
  }));
}

/** Vurdering, leveransestatus, neste steg og de to serverstegene (godkjenn, før kostpris). */
export function useInvoiceSteps(data: InvoiceDetailData | undefined) {
  const qc = useQueryClient();
  const { canWrite, canReconcile } = useFakturaer();
  const rights = useInvoiceRights();
  const extrasQ = useInvoiceDeliveryStatus(data ? [data.id] : []);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StepResult>(null);

  const derived = useMemo(() => {
    if (!data) return null;
    const lines = toInboxLines(data);
    const assessment = assessInboxInvoice({
      status: data.status, is_credit_note: data.is_credit_note, lines_sum_status: data.lines_sum_status, notes: data.notes,
      line_extraction_status: data.line_extraction_status, currency: data.currency,
      extraction_confidence: data.extraction_confidence == null ? null : Number(data.extraction_confidence),
      lines_sum_variance_pct: data.lines_sum_variance_pct == null ? null : Number(data.lines_sum_variance_pct), lines,
    });
    const extras = extrasFor(extrasQ.data, data.id);
    const base = {
      status: data.status, received_at: data.imported_at ?? data.created_at, line_count: lines.length, lines_source: data.lines_source,
      line_extraction_status: data.line_extraction_status, open_count: lines.filter(lineIsOpen).length,
      lines_sum_status: data.lines_sum_status, reconciled_mode: data.reconciled_mode,
    };
    return {
      assessment,
      steps: deliverySteps(base, extras),
      next: nextInvoiceStep({
        ...base, ...extras, source: data.source, canReconcile: assessment.canReconcile, reconcileBlockedReason: assessment.reconcileBlockedReason,
        canWrite, canReconcileRight: canReconcile, canApprove: rights.canApprove,
      }),
    };
  }, [data, extrasQ.data, canWrite, canReconcile, rights.canApprove]);

  const done = () => invalidateInvoiceWork(qc, data?.id);

  async function approve() {
    if (!data) return;
    setBusy(true);
    const r = await approveInvoiceInternal(data.id, null);
    setBusy(false);
    setResult(r.ok ? { title: r.already ? "Fakturaen var allerede godkjent" : "Fakturaen er godkjent", items: ["Intern godkjenning. Utløser ikke betaling."] } : { title: "Kunne ikke godkjenne", items: [r.message ?? ""], error: true });
    done();
  }

  async function postCosts() {
    if (!data) return;
    setBusy(true);
    const [r] = await postSafeCosts([data.id]);
    setBusy(false);
    setResult(r.error
      ? { title: "Kostpris ble ikke ført", items: [r.error], error: true }
      : { title: `Kostpris ført for ${r.posted} ${r.posted === 1 ? "linje" : "linjer"}`, items: r.skipped ? [`${r.skipped} ${r.skipped === 1 ? "linje" : "linjer"} hoppet over (ikke trygge nok)`] : [] });
    done();
  }

  return { ...derived, canWrite, busy, result, setResult, approve, postCosts };
}
