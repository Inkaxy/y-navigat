import { CheckCircle2, Loader2 } from "lucide-react";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatNok } from "@/fakturaer/lib/constants";
import { WORK_KIND_LABELS, labelFor } from "@/ravarer/lib/labels";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";
import { cn } from "@/lib/utils";
import { kr } from "./logic";

export function rowSubtitle(it: WorkItem): string {
  if (it.type === "faktura") {
    return [it.supplier_name ?? "Ukjent leverandør", it.last_date ? formatDate(it.last_date) : null, formatNok(it.amount)].filter(Boolean).join(" · ");
  }
  const lines = `${it.open_lines} ${it.open_lines === 1 ? "linje" : "linjer"} på ${it.open_invoices} ${it.open_invoices === 1 ? "faktura" : "fakturaer"}`;
  return [it.supplier_name ?? "Ukjent leverandør", it.sku ? `varenr ${it.sku}` : null, lines].filter(Boolean).join(" · ");
}

type Props = {
  items: WorkItem[];
  total: number;
  selectedKey: string | null;
  loading: boolean;
  fetchingMore: boolean;
  onSelect: (it: WorkItem) => void;
  onMore?: () => void;
};

/** Én prioritert liste: varekort og fakturasaker. */
export function WorkListView({ items, total, selectedKey, loading, fetchingMore, onSelect, onMore }: Props) {
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Laster listen">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-center text-sm text-ink-secondary">
        <CheckCircle2 className="h-6 w-6 text-success" aria-hidden />
        Ingenting venter her. Bra jobba.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <ul role="listbox" aria-label="Det som venter" className="divide-y divide-line-subtle overflow-hidden rounded-lg border border-border bg-card">
        {items.map((it) => {
          const meta = labelFor(WORK_KIND_LABELS, it.kind, "Oppgave");
          const active = it.key === selectedKey;
          return (
            <li key={it.key} role="option" aria-selected={active}>
              <button
                type="button"
                data-key={it.key}
                onClick={() => onSelect(it)}
                className={cn(
                  "relative flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                  active && "bg-primary/5 before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-primary",
                )}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <StatusPill label={meta.label} tokenVar={meta.tokenVar} />
                    <span className="truncate text-sm font-medium text-foreground">{it.title}</span>
                  </div>
                  <p className="truncate text-caption text-ink-secondary">{rowSubtitle(it)}</p>
                </div>
                {it.impact_nok > 0 && <span className="shrink-0 text-sm tabular-nums text-ink-secondary">≈ {kr(it.impact_nok)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between text-caption text-ink-secondary">
        <span className="tabular-nums">Viser {items.length} av {total}</span>
        {onMore && items.length < total && (
          <Button variant="outline" size="sm" onClick={onMore} disabled={fetchingMore}>
            {fetchingMore && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}Vis flere
          </Button>
        )}
      </div>
    </div>
  );
}
