import type { OverviewRow } from "@/fakturaer/lib/approval";
import { formatMoney } from "@/fakturaer/lib/constants";
import { sumByCurrency } from "@/fakturaer/lib/ravarerQueueFilter";

/** Fakturaene en massehandling gjelder (leverandør · fakturanr · beløp) og summen. */
export function ConfirmInvoiceList({ rows }: { rows: readonly OverviewRow[] }) {
  if (rows.length === 0) return null;
  const sums = sumByCurrency(rows);
  return (
    <div className="space-y-2 text-sm">
      <ul className="max-h-56 divide-y divide-border overflow-auto rounded-md border border-border" aria-label="Valgte fakturaer">
        {rows.map((r) => (
          <li key={r.invoice_id} className="flex items-center justify-between gap-3 px-3 py-1.5">
            <span className="min-w-0 truncate">{r.supplier_name ?? "Ukjent leverandør"} · {r.invoice_number}</span>
            <span className="shrink-0 tabular-nums">{formatMoney(r.total_amount, r.currency)}</span>
          </li>
        ))}
      </ul>
      {sums.length > 0 && (
        <p className="text-right font-medium tabular-nums">Sum {sums.map((c) => `${formatMoney(c.total, c.currency)} inkl. mva.`).join(" · ")}</p>
      )}
    </div>
  );
}
