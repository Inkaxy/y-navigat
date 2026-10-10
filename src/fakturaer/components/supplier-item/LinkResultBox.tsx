import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { linkResultSummary, type LinkSupplierItemResult } from "@/fakturaer/lib/supplierItems";

export function LinkResultBox({ result, onClose, onNext }: { result: LinkSupplierItemResult; onClose: () => void; onNext?: () => void }) {
  const numberOf = (id: string) => result.invoices.find((i) => i.invoice_id === id)?.invoice_number ?? "ukjent faktura";
  const notRematched = result.invoices.filter((i) => i.rematched === false);
  return (
    <div role="status" className="space-y-3 rounded-md border border-success/30 bg-success/5 p-4">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
        <div className="space-y-1 text-sm">
          {linkResultSummary(result).map((t) => <p key={t}>{t}</p>)}
        </div>
      </div>
      {notRematched.length > 0 && (
        <div className="text-sm">
          <p className="font-medium text-warning">Kunne ikke regnes om nå (prøves igjen automatisk)</p>
          <ul className="mt-1 list-disc pl-5">
            {notRematched.map((i) => <li key={i.invoice_id}>Faktura {i.invoice_number ?? "ukjent"}{i.error ? `: ${i.error}` : ""}</li>)}
          </ul>
        </div>
      )}
      {result.failures.length > 0 && (
        <div className="text-sm">
          <p className="font-medium text-destructive">Kunne ikke regnes om:</p>
          <ul className="mt-1 list-disc pl-5">
            {result.failures.map((f) => <li key={f.invoice_id}>Faktura {numberOf(f.invoice_id)}: {f.reason}</li>)}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Lukk</Button>
        {onNext && <Button type="button" onClick={onNext}>Neste varekort</Button>}
      </div>
    </div>
  );
}
