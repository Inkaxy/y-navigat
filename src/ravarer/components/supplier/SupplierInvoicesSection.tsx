import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InvoiceStatusBadge } from "@/fakturaer/components/InvoiceStatusBadge";
import { DataTable, type Column } from "@/ravarer/ui/DataTable";
import { formatDate, formatNok, formatNumber } from "@/ravarer/lib/constants";
import { paths } from "@/ravarer/lib/paths";
import { useSupplierInvoices, type SupplierInvoiceRow } from "@/ravarer/hooks/useSupplierDetail";

export const INVOICE_PAGE = 50;

/** Beløp i fakturaens egen valuta. NOK bare når fakturaen faktisk er i NOK. */
export function invoiceAmount(r: Pick<SupplierInvoiceRow, "total_amount" | "currency">): string {
  if (r.total_amount == null) return "—";
  const cur = (r.currency ?? "").toUpperCase();
  if (cur === "NOK") return formatNok(r.total_amount);
  if (!cur) return `${formatNumber(r.total_amount, 2)} (valuta ukjent)`;
  return `${formatNumber(r.total_amount, 2)} ${cur}`;
}

export function SupplierInvoicesSection({ supplierId, listSearch }: { supplierId: string; listSearch: string }) {
  const [limit, setLimit] = useState(INVOICE_PAGE);
  const q = useSupplierInvoices(supplierId, limit);
  const rows = q.data?.rows;
  const total = q.data?.total ?? 0;
  // Fakturaflaten får med retur til leverandørkortets fakturaseksjon.
  const back = `${paths.leverandor(supplierId)}?${new URLSearchParams({ seksjon: "fakturaer", ...(listSearch ? { liste: listSearch } : {}) }).toString()}`;
  const href = (r: SupplierInvoiceRow) => paths.faktura(r.id, { fra: back });
  const mismatch = (r: SupplierInvoiceRow) => r.lines_sum_status === "mismatch" && (
    <span className="inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning/15 px-1.5 py-0.5 text-caption text-warning" title="Varelinjene summerer seg ikke til fakturabeløpet">
      <AlertTriangle className="h-3 w-3" aria-hidden />Sum-avvik
    </span>
  );
  const columns: Column<SupplierInvoiceRow>[] = [
    { id: "nr", header: "Fakturanr", alwaysVisible: true, cell: (r) => <Link to={href(r)} className="font-medium hover:underline">{r.invoice_number}</Link> },
    { id: "date", header: "Dato", cell: (r) => formatDate(r.invoice_date) },
    { id: "amount", header: "Beløp", align: "right", cell: (r) => <span className="tabular-nums">{invoiceAmount(r)}</span> },
    { id: "status", header: "Status", cell: (r) => <span className="flex flex-wrap items-center gap-1.5"><InvoiceStatusBadge status={r.status} />{mismatch(r)}</span> },
  ];
  return (
    <div className="space-y-3">
      <DataTable ariaLabel="Fakturaer fra leverandøren" rows={rows} columns={columns} getId={(r) => r.id}
        isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} emptyText="Ingen fakturaer fra denne leverandøren."
        renderMobileCard={(r) => (
          <Link to={href(r)} className="block min-h-[44px] space-y-1">
            <span className="flex justify-between gap-2"><span className="font-medium">{r.invoice_number}</span><span className="tabular-nums">{invoiceAmount(r)}</span></span>
            <span className="flex flex-wrap items-center gap-1.5 text-caption text-ink-secondary">{formatDate(r.invoice_date)}<InvoiceStatusBadge status={r.status} />{mismatch(r)}</span>
          </Link>
        )}
      />
      {rows && (
        <div className="flex items-center justify-between text-sm text-ink-secondary" data-testid="invoice-paging">
          <span>Viser {rows.length} av {total}</span>
          {rows.length < total && <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-9" disabled={q.isFetching} onClick={() => setLimit((l) => l + INVOICE_PAGE)}>Vis flere</Button>}
        </div>
      )}
    </div>
  );
}
