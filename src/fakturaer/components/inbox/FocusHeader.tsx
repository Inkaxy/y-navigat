import { ArrowLeft, CheckCircle2, FileText, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatDate } from "@/fakturaer/lib/constants";
import type { InboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

interface Props {
  invoice: InboxInvoice | null;
  fallback: ReviewLineRow["invoice"] | null;
  progress: { handled: number; total: number; needs: number } | null;
  reconcileReady: boolean;
  undoLabel: string | null;
  onUndo: () => void;
  onBack: () => void;
  onReconcile: () => void;
  onShowDocument: () => void;
}

/** Liten fakturaoverskrift mens én faktura kontrolleres. */
export function FocusHeader(p: Props) {
  const supplier = p.invoice?.supplier_name ?? p.fallback?.supplier?.name ?? "Leverandør";
  const number = p.invoice?.invoice_number ?? p.fallback?.invoice_number ?? "";
  const date = p.invoice?.invoice_date ?? p.fallback?.invoice_date ?? null;
  const hasDoc = !!(p.invoice?.source_document_url ?? p.fallback?.source_document_url);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="-ml-2 gap-1.5" onClick={p.onBack}>
          <ArrowLeft className="h-4 w-4" /> Tilbake til fakturaer
        </Button>
        {p.undoLabel && (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={p.onUndo}>
            <Undo2 className="h-4 w-4" /> Angre «{p.undoLabel}»
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-xl leading-tight">
            {supplier} · Faktura {number}
          </h1>
          <p className="text-caption text-ink-secondary">
            {date ? formatDate(date) : ""}
            {p.progress
              ? ` · ${p.progress.handled} av ${p.progress.total} linjer avklart${p.progress.needs > 0 ? ` · ${p.progress.needs} gjenstår` : ""}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" disabled={!hasDoc} onClick={p.onShowDocument}>
            <FileText className="h-4 w-4" /> Originalfaktura
          </Button>
          {p.reconcileReady && (
            <Button size="sm" className="gap-1.5" onClick={p.onReconcile}>
              <CheckCircle2 className="h-4 w-4" /> Bekreft prismatch
            </Button>
          )}
        </div>
      </div>
      {p.progress && <Progress className="h-1.5" value={p.progress.total ? (p.progress.handled / p.progress.total) * 100 : 0} aria-label="Fremdrift for fakturaen" />}
    </div>
  );
}
