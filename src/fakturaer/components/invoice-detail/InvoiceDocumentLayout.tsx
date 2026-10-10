import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { InvoiceDocumentPanel } from "@/fakturaer/components/InvoiceDocumentPanel";
import { formatNok, formatDate, INVOICE_SOURCES } from "@/fakturaer/lib/constants";
import { formatVariancePct } from "@/fakturaer/lib/linesSum";
import type { InvoiceDetailData } from "./fetchInvoiceDetail";

/** «Detaljer»-kortet på fakturadetaljen. */
export function InvoiceDetailsCard({ data }: { data: InvoiceDetailData }) {
  const sourceMeta = INVOICE_SOURCES.find((s) => s.value === data.source);
  const sumMismatch = data.lines_sum_status === "mismatch";
  const lowConfidence = data.extraction_confidence != null && Number(data.extraction_confidence) < 0.7;
  return (
  <Card className="p-6 lg:col-span-1">
    <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-ink-secondary">Detaljer</h3>
    <dl className="space-y-3 text-sm">
      <div><dt className="text-ink-secondary">Leverandør</dt><dd className="font-medium">{data.suppliers?.name}</dd></div>
      {data.suppliers?.org_number && <div><dt className="text-ink-secondary">Org.nr</dt><dd className="font-mono text-xs">{data.suppliers.org_number}</dd></div>}
      <div><dt className="text-ink-secondary">Fakturadato</dt><dd>{formatDate(data.invoice_date)}</dd></div>
      <div><dt className="text-ink-secondary">Forfall</dt><dd>{formatDate(data.due_date)}</dd></div>
      <div><dt className="text-ink-secondary">Beløp</dt><dd className="font-semibold">{formatNok(data.total_amount)}</dd></div>
      <div><dt className="text-ink-secondary">MVA</dt><dd>{formatNok(data.total_vat)}</dd></div>
      <div><dt className="text-ink-secondary">Kilde</dt><dd>{sourceMeta?.label ?? data.source}</dd></div>
      {data.extraction_confidence != null && (
        <div>
          <dt className="text-ink-secondary">Lesesikkerhet</dt>
          <dd className={lowConfidence ? "font-medium text-warning" : ""}>
            {Math.round(Number(data.extraction_confidence) * 100)} %
            {lowConfidence && " — krever gjennomgang"}
          </dd>
        </div>
      )}
      {data.lines_sum_excl_vat != null && (
        <div>
          <dt className="text-ink-secondary">Sum varelinjer (eks. mva)</dt>
          <dd className={sumMismatch ? "font-medium text-warning" : ""}>
            {formatNok(data.lines_sum_excl_vat)}
            {data.lines_sum_variance_pct != null && ` (${formatVariancePct(Number(data.lines_sum_variance_pct))})`}
          </dd>
        </div>
      )}
    </dl>
  </Card>
  );
}

/** Legger originalfakturaen ved siden av (desktop) eller i et bunnark (mobil). */
export function InvoiceDocumentLayout({ data, docOpen, isMobile, tolerancePct, onClose, children }: {
  data: InvoiceDetailData; docOpen: boolean; isMobile: boolean; tolerancePct: number; onClose: () => void; children: ReactNode;
}) {
  if (!docOpen) return <>{children}</>;
  const docPanel = (
        <InvoiceDocumentPanel
          invoice={{
            invoice_number: data.invoice_number,
            invoice_date: data.invoice_date,
            supplier_name: data.suppliers?.name ?? null,
            source_document_url: data.source_document_url,
            total_amount: data.total_amount,
            total_vat: data.total_vat,
            lines_sum_status: data.lines_sum_status,
            lines_sum_excl_vat: data.lines_sum_excl_vat,
            lines_sum_variance_pct: data.lines_sum_variance_pct,
            extraction_confidence: data.extraction_confidence,
          }}
          tolerancePct={tolerancePct}
          onClose={onClose}
          className="h-full"
        />
  );
  if (isMobile) {
    return (
      <>
        {children}
        <Sheet open onOpenChange={(v) => { if (!v) onClose(); }}>
          <SheetContent side="bottom" className="h-[92vh] p-0">{docPanel}</SheetContent>
        </Sheet>
      </>
    );
  }
  return (
    <ResizablePanelGroup direction="horizontal" className="min-h-[70vh] items-stretch">
      <ResizablePanel defaultSize={58} minSize={35}><div className="pr-3">{children}</div></ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={42} minSize={30} maxSize={65}>
        <div className="sticky top-4 h-[calc(100vh-8rem)] pl-3">{docPanel}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
