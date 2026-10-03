import { Checkbox } from "@/components/ui/checkbox";
import { formatMoney } from "@/fakturaer/lib/constants";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { LineStatus } from "@/fakturaer/lib/lineStatus";
import { LineStatusBadge } from "@/fakturaer/components/inbox/LineStatusBadge";
import { cn } from "@/lib/utils";
import { materialSummary } from "@/fakturaer/lib/lineControl";

interface Props {
  lines: ReviewLineRow[];
  statusOf: (line: ReviewLineRow) => LineStatus;
  activeLineId: string | null;
  onSelect: (line: ReviewLineRow) => void;
  selected: Record<string, boolean>;
  onToggleSelect: (id: string, value: boolean) => void;
  showInvoice: boolean;
}

/** Kompakt oversikt: varetekst, råvare/forslag, én status og beløp. */
export function LineList({ lines, statusOf, activeLineId, onSelect, selected, onToggleSelect, showInvoice }: Props) {
  return (
    <ul className="divide-y divide-line-subtle" aria-label="Fakturalinjer">
      {lines.map((l) => {
        const status = statusOf(l);
        const active = l.id === activeLineId;
        return (
          <li key={l.id} className={cn("relative flex items-start gap-2 px-3 py-2.5", active && "bg-primary/5")}>
            {active && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
            <Checkbox
              className="mt-1"
              checked={!!selected[l.id]}
              onCheckedChange={(v) => onToggleSelect(l.id, !!v)}
              aria-label={`Velg linje ${l.line_number ?? ""} ${l.description ?? ""}`.trim()}
            />
            <button
              type="button"
              onClick={() => onSelect(l)}
              aria-current={active ? "true" : undefined}
              className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="text-caption text-ink-secondary">
                {showInvoice ? `${l.invoice.invoice_number} · ` : ""}
                Linje {l.line_number ?? "–"}
                {l.supplier_sku ? ` · ${l.supplier_sku}` : ""}
              </div>
              <div className="truncate text-sm font-medium">{l.description ?? "Uten varetekst"}</div>
              <div className="truncate text-caption text-ink-secondary">{materialSummary(l)}</div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <LineStatusBadge status={status} />
                <span className="text-sm tabular-nums">{formatMoney(l.total_amount, l.invoice.currency ?? "NOK")}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
