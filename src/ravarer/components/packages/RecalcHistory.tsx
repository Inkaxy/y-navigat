import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Undo2 } from "lucide-react";
import { useRecalcHistory, useUndoRecalc } from "@/ravarer/hooks/usePackageSizes";
import { formatNumber } from "@/ravarer/lib/constants";

function dateTime(v: string | null) {
  if (!v) return "—";
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "short", timeStyle: "short" }).format(new Date(v));
}

interface Props {
  rawMaterialId: string;
  baseUnit?: string | null;
  compact?: boolean;
}

export function RecalcHistory({ rawMaterialId, baseUnit, compact }: Props) {
  const { data: rows = [], isLoading } = useRecalcHistory(rawMaterialId);
  const undo = useUndoRecalc();

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (rows.length === 0)
    return <p className="text-sm text-ink-secondary">Ingen omregninger er utført for denne råvaren.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs uppercase text-ink-secondary">
          <tr>
            <th className="pb-2">Dato</th>
            <th className="pb-2">Hvem</th>
            <th className="pb-2 text-right">Faktor</th>
            <th className="pb-2 text-right">Linjer</th>
            <th className="pb-2 text-right">Kostpris</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const undone = !!r.undone_at;
            return (
              <tr key={r.id} className={`border-t border-line-subtle ${undone ? "opacity-50" : ""}`}>
                <td className="py-2 whitespace-nowrap">{dateTime(r.performed_at)}</td>
                <td className="py-2 text-ink-secondary">{r.performed_by_name ?? "—"}</td>
                <td className="py-2 text-right tabular-nums">
                  {formatNumber(r.factor_used, 3)}
                  {r.factor_source && <span className="ml-1 text-xs text-ink-secondary">({r.factor_source})</span>}
                </td>
                <td className="py-2 text-right tabular-nums">{r.lines_changed ?? 0}</td>
                <td className="py-2 text-right tabular-nums whitespace-nowrap">
                  {formatNumber(r.cost_before, 3)} → <span className="font-semibold">{formatNumber(r.cost_after, 3)}</span>
                  {baseUnit && <span className="ml-1 text-xs text-ink-secondary">kr/{baseUnit}</span>}
                </td>
                <td className="py-2 text-right">
                  {undone ? (
                    <Badge variant="outline">Angret</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={undo.isPending}
                      onClick={() => undo.mutate({ recalcId: r.id, rawMaterialId })}
                    >
                      <Undo2 className="mr-1 h-3.5 w-3.5" /> Angre
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!compact && r_note}
    </div>
  );
}

const r_note = (
  <p className="mt-2 text-xs text-ink-secondary">
    Angring setter fakturalinjene og kostprisen tilbake slik de var før omregningen.
  </p>
);
