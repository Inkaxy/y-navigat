import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatKr, groupDefFor } from "@/fakturering/lib/groups";
import type { PreviewLineRow } from "@/fakturering/hooks/useFakturering";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  groupKey: string | null;
  runDate: string;
  lines: PreviewLineRow[];
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry: () => void;
  isFetching: boolean;
}

function fmtDate(v: string) {
  try {
    return format(new Date(v), "dd.MM.yyyy");
  } catch {
    return v;
  }
}

export function GroupPreviewDialog({
  open, onOpenChange, groupKey, runDate, lines, isLoading, isError, error, onRetry, isFetching,
}: Props) {
  const [q, setQ] = useState("");

  const def = groupDefFor(groupKey);
  const runDateLabel = useMemo(() => fmtDate(runDate), [runDate]);

  const groupLines = useMemo(
    () => lines.filter((l) => (l.invoicing_group ?? "__none") === (groupKey ?? "__none")),
    [lines, groupKey],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return groupLines;
    return groupLines.filter(
      (l) =>
        l.customer_name.toLowerCase().includes(term) ||
        (l.customer_number ?? "").toLowerCase().includes(term) ||
        l.order_number.toLowerCase().includes(term),
    );
  }, [groupLines, q]);

  const totalExcl = useMemo(() => filtered.reduce((s, r) => s + r.sum_excl_vat, 0), [filtered]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl p-0 gap-0">
        <DialogHeader className="border-b border-line-subtle px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="font-display text-xl font-semibold">
                Pakksedler til og med {runDateLabel} for faktureringsgruppe{" "}
                <span className="whitespace-nowrap">«{def.label}»</span>
              </DialogTitle>
              <DialogDescription>
                Grunnlag basert på leverte, ufakturerte ordrer. Ingenting opprettes.
              </DialogDescription>
            </div>
            <Badge className="shrink-0 bg-[hsl(var(--app-primary))] text-white hover:bg-[hsl(var(--app-primary))]">
              {groupLines.length} treff
            </Badge>
          </div>
        </DialogHeader>

        <div className="px-6 pt-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Søk på navn, kundenr eller ordrenr…"
              className="pl-9"
            />
          </div>
        </div>

        <div className="px-6 pb-6 pt-4">
          {isLoading && <div className="py-10 text-center text-sm text-muted-foreground">Laster…</div>}

          {isError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
              <div className="font-medium text-destructive">Kunne ikke hente grunnlaget</div>
              <div className="mt-1 text-muted-foreground">
                {(error as Error)?.message ?? "Ukjent feil"}
              </div>
              <Button variant="outline" size="sm" className="mt-3" onClick={onRetry} disabled={isFetching}>
                Prøv igjen
              </Button>
            </div>
          )}

          {!isLoading && !isError && filtered.length === 0 && (
            <div className="rounded-lg border border-line-subtle bg-surface-sunken p-10 text-center text-sm text-muted-foreground">
              {groupLines.length === 0
                ? "Ingen ordrer klare for denne gruppen."
                : "Ingen treff på søket."}
            </div>
          )}

          {!isLoading && !isError && filtered.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-line-subtle">
              <div className="max-h-[55vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-surface-sunken text-[11px] uppercase tracking-wider text-muted-foreground shadow-[0_1px_0_hsl(var(--line-subtle))]">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-semibold">Nummer</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Kundenr</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Navn</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Leveransedato</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Tur</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Sum (u/mva)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-subtle">
                    {filtered.map((r, idx) => (
                      <tr key={r.order_id} className={idx % 2 === 0 ? "bg-transparent" : "bg-surface-sunken/40"}>
                        <td className="px-4 py-2.5 tabular-nums text-text-primary">{r.order_number}</td>
                        <td className="px-4 py-2.5 font-semibold tabular-nums">{r.customer_number ?? "—"}</td>
                        <td className="px-4 py-2.5 text-text-primary">
                          {r.customer_name}
                          {r.is_return && (
                            <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-destructive">
                              Retur
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{fmtDate(r.delivery_date)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{r.tour_number ?? "—"}</td>
                        <td
                          className={`px-4 py-2.5 text-right font-semibold tabular-nums ${r.is_return ? "text-destructive" : "text-text-primary"}`}
                        >
                          {formatKr(r.sum_excl_vat)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t-2 border-line-subtle bg-surface-sunken px-4 py-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Sum grunnlag (u/mva)
                </span>
                <span className="font-display text-lg font-semibold tabular-nums text-text-primary">
                  {formatKr(totalExcl)}
                </span>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
