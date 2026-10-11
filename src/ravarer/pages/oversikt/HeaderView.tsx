import { Link } from "react-router-dom";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { ClipboardList, Upload } from "lucide-react";
import { getTimeGreeting } from "@/lib/greeting";
import { paths } from "@/ravarer/lib/paths";
import { statusLine } from "./logic";
import type { WorkSummary } from "@/ravarer/lib/workRpcTypes";

export type HeaderViewProps = {
  summary: WorkSummary | null;
  firstName: string | null;
  now?: Date;
};

/** Redaksjonell topp — svarer på «Hva venter på meg?». */
export function HeaderView({ summary, firstName, now = new Date() }: HeaderViewProps) {
  const dateLabel = format(now, "EEEE d. MMMM", { locale: nb });
  const greet = getTimeGreeting(now);
  const line = summary
    ? statusLine({
        todo_total: summary.todo_total,
        hasInvoiceAccess: summary.invoice_access,
        supplier: summary.supplier_items,
        invoices: summary.invoices,
        dq: summary.data_quality,
      })
    : { headline: "Laster …", sub: null };
  const todo = summary?.todo_total ?? 0;
  const hasInvoiceAccess = summary?.invoice_access ?? false;

  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="text-caption uppercase tracking-wide text-ink-secondary">
          {dateLabel[0].toUpperCase() + dateLabel.slice(1)}
        </p>
        <h1 className="mt-1 font-display text-3xl leading-tight sm:text-4xl">
          {greet}
          {firstName ? `, ${firstName}` : ""}.{" "}
          <span className="text-ink-secondary">{line.headline}</span>
        </h1>
        {line.sub && <p className="mt-2 text-body text-ink-secondary">{line.sub}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {hasInvoiceAccess && todo > 0 && (
          <Button asChild>
            <Link to={paths.priskontroll({ fane: "gjore" })}>
              <ClipboardList className="mr-1.5 h-4 w-4" />
              Start priskontroll
            </Link>
          </Button>
        )}
        {hasInvoiceAccess && (
          <Button asChild variant="outline">
            <Link to={paths.importFaktura()}>
              <Upload className="mr-1.5 h-4 w-4" />
              Importer faktura
            </Link>
          </Button>
        )}
      </div>
    </header>
  );
}
