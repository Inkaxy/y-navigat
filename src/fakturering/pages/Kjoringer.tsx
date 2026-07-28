import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ClipboardList, ChevronRight, AlertTriangle, RotateCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useFaktureringEntity } from "@/fakturering/context/FaktureringContext";
import { useAllInvoiceRuns, useRunInvoicedCounts } from "@/fakturering/hooks/useFakturering";
import { formatKr, groupDefFor } from "@/fakturering/lib/groups";
import { EntityPickerBanner } from "@/fakturering/components/EntityPickerBanner";

export default function Kjoringer() {
  const { activeEntityId } = useFaktureringEntity();
  const runs = useAllInvoiceRuns(activeEntityId);
  const invoicedCounts = useRunInvoicedCounts(activeEntityId);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Fakturering" title="Kjøringer" subtitle="Alle faktureringskjøringer for enheten" icon={ClipboardList} />

      <EntityPickerBanner />

      {runs.isError && (
        <ErrorBox
          message={runs.error instanceof Error ? runs.error.message : "Ukjent feil"}
          onRetry={() => runs.refetch()}
        />
      )}

      <div className="overflow-hidden rounded-xl border border-line-subtle bg-surface-raised">
        <table className="w-full text-sm">
          <thead className="bg-surface-sunken text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Startet</th>
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
            {(runs.data ?? []).map((r) => {
              const invoicedForRun = invoicedCounts.data?.get(r.id) ?? 0;
              return (
                <tr key={r.id} className="hover:bg-surface-sunken/60">
                  <td className="px-3 py-2 tabular-nums">
                    {r.started_at ? format(new Date(r.started_at), "dd.MM.yyyy HH:mm") : format(new Date(r.run_date), "dd.MM.yyyy")}
                  </td>
                  <td className="px-3 py-2">{(r.groups ?? []).map((g) => groupDefFor(g).label).join(" + ") || "—"}</td>
                  <td className="px-3 py-2"><RunStatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.basis_count}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{r.transferred_count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{invoicedForRun || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-700 dark:text-red-400">{r.failed_count || ""}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatKr(Number(r.total_incl_vat))}</td>
                  <td className="px-3 py-2 text-right">
                    <Link to={`/fakturering/kjoringer/${r.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-[hsl(var(--app-primary))]">
                      Åpne <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              );
            })}
            {!runs.isLoading && !runs.isError && (runs.data ?? []).length === 0 && (
              <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Ingen kjøringer ennå.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  if (status === "completed_with_errors") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800 dark:bg-red-950/40 dark:text-red-300">
        Fullført med feil
      </span>
    );
  }
  if (status === "running" || status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
        Kjører
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
        Fullført
      </span>
    );
  }
  return <span className="capitalize text-muted-foreground text-xs">{status}</span>;
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 text-red-700 dark:text-red-400" />
      <div className="flex-1">
        <div className="font-medium text-text-primary">Kunne ikke hente kjøringer</div>
        <div className="text-muted-foreground">{message}</div>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw className="mr-2 h-3.5 w-3.5" /> Prøv igjen
      </Button>
    </div>
  );
}
