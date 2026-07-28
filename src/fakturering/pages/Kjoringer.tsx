import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ClipboardList, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useFaktureringEntity } from "@/fakturering/context/FaktureringContext";
import { useAllInvoiceRuns } from "@/fakturering/hooks/useFakturering";
import { formatKr, groupDefFor } from "@/fakturering/lib/groups";

export default function Kjoringer() {
  const { activeEntityId } = useFaktureringEntity();
  const runs = useAllInvoiceRuns(activeEntityId);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Fakturering" title="Kjøringer" subtitle="Alle faktureringskjøringer for enheten" icon={ClipboardList} />

      <div className="overflow-hidden rounded-xl border border-line-subtle bg-surface-raised">
        <table className="w-full text-sm">
          <thead className="bg-surface-sunken text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Nr</th>
              <th className="px-3 py-2 text-left font-semibold">Dato</th>
              <th className="px-3 py-2 text-left font-semibold">Grupper</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-3 py-2 text-right font-semibold">Grunnlag</th>
              <th className="px-3 py-2 text-right font-semibold">Overført</th>
              <th className="px-3 py-2 text-right font-semibold">Fakturert</th>
              <th className="px-3 py-2 text-right font-semibold">Feilet</th>
              <th className="px-3 py-2 text-right font-semibold">Sum ink. mva</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {(runs.data ?? []).map((r, idx) => (
              <tr key={r.id} className="hover:bg-surface-sunken/60">
                <td className="px-3 py-2 font-mono">#{(runs.data?.length ?? 0) - idx}</td>
                <td className="px-3 py-2 tabular-nums">{r.started_at ? format(new Date(r.started_at), "dd.MM.yyyy HH:mm") : format(new Date(r.run_date), "dd.MM.yyyy")}</td>
                <td className="px-3 py-2">{(r.groups ?? []).map((g) => groupDefFor(g).label).join(" + ") || "—"}</td>
                <td className="px-3 py-2">
                  {r.status === "completed_with_errors" ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800 dark:bg-red-950/40 dark:text-red-300">
                      Fullført med feil
                    </span>
                  ) : (
                    <span className="capitalize">{r.status}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.basis_count}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{r.transferred_count}</td>
                <td className="px-3 py-2 text-right tabular-nums">—</td>
                <td className="px-3 py-2 text-right tabular-nums text-red-700 dark:text-red-400">{r.failed_count || ""}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatKr(Number(r.total_incl_vat))}</td>
                <td className="px-3 py-2 text-right">
                  <Link to={`/fakturering/kjoringer/${r.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-[hsl(var(--app-primary))]">
                    Åpne <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
            {!runs.isLoading && (runs.data ?? []).length === 0 && (
              <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">Ingen kjøringer ennå.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
