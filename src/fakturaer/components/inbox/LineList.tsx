import { Checkbox } from "@/components/ui/checkbox";
import { formatMoney } from "@/fakturaer/lib/constants";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { LineStatus, StatusTone } from "@/fakturaer/lib/lineStatus";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<StatusTone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "border-line-subtle bg-muted text-ink-secondary",
};

export function LineStatusBadge({ status, className }: { status: Pick<LineStatus, "label" | "tone">; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold",
        TONE_CLASS[status.tone],
        className,
      )}
    >
      {status.label}
    </span>
  );
}

/** Kort tekst for hvilken råvare linjen peker på — skiller bekreftet kobling fra forslag. */
export function materialSummary(line: ReviewLineRow): string {
  if (line.match_confidence === "not_applicable") return "Utelatt — ikke råvare";
  if (line.matched_raw_material) return line.matched_raw_material.name;
  const top = line.suggestions?.[0]?.raw_material?.name;
  return top ? `Forslag: ${top}` : "Ingen råvare valgt";
}

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
