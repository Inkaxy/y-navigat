import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LinesSumMismatchAlert } from "@/fakturaer/components/LinesSumMismatchAlert";
import type { InvoiceDetailData } from "@/fakturaer/components/invoice-detail/fetchInvoiceDetail";
import { recheckInvoiceLinesSum } from "@/fakturaer/lib/linesSum";

/** Dokumentert overstyring av sumavvik — samme skjema som før, åpnet fra «Flere valg». */
export function SumOverrideDialog({ open, onOpenChange, data, canOverride, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; data: InvoiceDetailData; canOverride: boolean; onDone: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Overstyr sumavvik</DialogTitle>
          <DialogDescription>Kontroller linjene mot originalen først. Begrunnelsen lagres på fakturaen.</DialogDescription>
        </DialogHeader>
        <LinesSumMismatchAlert invoiceId={data.id} linesSum={data.lines_sum_excl_vat} totalAmount={data.total_amount} totalVat={data.total_vat}
          variancePct={data.lines_sum_variance_pct} canOverride={canOverride}
          onRecheck={async () => { await recheckInvoiceLinesSum(data.id); onDone(); }} onOverridden={onDone} />
      </DialogContent>
    </Dialog>
  );
}
