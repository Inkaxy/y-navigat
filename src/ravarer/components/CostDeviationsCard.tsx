import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { QueryState } from "@/components/common/QueryState";
import { useCompany } from "@/hooks/useCompany";
import { useRavarerAccessLevel } from "@/ravarer/hooks/useRavarerAccessLevel";
import { useCostDeviations, useRefreshCostPrices } from "@/ravarer/hooks/useCostPriceSource";
import { formatDate, formatNok } from "@/ravarer/lib/constants";
import { paths } from "@/ravarer/lib/paths";

/**
 * Avviksoversikt: lagret kostpris som ikke er nyeste gyldige pris, og priser uten gyldig kilde.
 * Bare «avviker» kan oppdateres, og bare når brukeren velger det. Uverifiserte priser beholdes til
 * noen dokumenterer en pris — de nullstilles aldri.
 */
export function CostDeviationsCard() {
  const access = useRavarerAccessLevel(true);
  const canWrite = ["write", "approve", "admin"].includes(access.data ?? "none");
  const { data: company } = useCompany();
  const q = useCostDeviations(company?.id);
  const refresh = useRefreshCostPrices();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const deviating = useMemo(() => rows.filter((r) => r.status === "avviker"), [rows]);
  const unverified = rows.length - deviating.length;

  const run = async () => {
    const ids = deviating.filter((r) => checked.has(r.rawMaterialId)).map((r) => r.rawMaterialId);
    if (ids.length === 0) return;
    try {
      const r = await refresh.mutateAsync(ids);
      toast.success(`${r.changed} av ${ids.length} kostpriser oppdatert til nyeste gyldige pris`);
      setChecked(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kostprisene ble ikke oppdatert");
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold text-ink-primary">Avvik mot nyeste gyldige pris</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            {deviating.length} råvarer har en lagret kostpris som ikke er nyeste gyldige pris. {unverified} har pris uten gyldig kilde
            (uverifisert) — de beholdes til en pris dokumenteres.
          </p>
        </div>
        {canWrite && (
          <Button onClick={run} disabled={refresh.isPending || checked.size === 0}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden /> Oppdater valgte ({checked.size})
          </Button>
        )}
      </div>
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} scope="ravarer:kostpris-avvik" onRetry={() => q.refetch()} isEmpty={rows.length === 0} emptyTitle="Ingen avvik" emptyDescription="Alle kostpriser er nyeste gyldige pris.">
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs uppercase text-ink-secondary">
              <tr>
                <th className="w-8 pb-2"><span className="sr-only">Velg</span></th>
                <th className="pb-2">Råvare</th>
                <th className="pb-2">Status</th>
                <th className="pb-2 text-right">Lagret</th>
                <th className="pb-2 text-right">Nyeste gyldige</th>
                <th className="pb-2">Kilde</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rawMaterialId} className="border-t border-line-subtle">
                  <td className="py-2">
                    {r.status === "avviker" && canWrite && (
                      <Checkbox aria-label={`Velg ${r.name}`} checked={checked.has(r.rawMaterialId)}
                        onCheckedChange={(v) => setChecked((prev) => { const n = new Set(prev); if (v === true) n.add(r.rawMaterialId); else n.delete(r.rawMaterialId); return n; })} />
                    )}
                  </td>
                  <td className="py-2"><Link className="hover:underline" to={paths.raavare(r.rawMaterialId)}>{r.name}</Link></td>
                  <td className="py-2"><Badge variant="outline">{r.status === "avviker" ? "Avviker" : "Uverifisert"}</Badge></td>
                  <td className="py-2 text-right tabular-nums">{r.currentPrice != null ? `${formatNok(r.currentPrice)}/${r.baseUnit ?? ""}` : "—"}</td>
                  <td className="py-2 text-right tabular-nums">{r.sourcePrice != null ? `${formatNok(r.sourcePrice)}/${r.baseUnit ?? ""}` : "—"}</td>
                  <td className="py-2 text-ink-secondary">
                    {r.sourceDate ? formatDate(r.sourceDate) : "Ingen gyldig kilde"}
                    {r.supplierName && <> · {r.supplierName}</>}
                    {r.invoiceId && <> · <Link className="text-app hover:underline" to={paths.faktura(r.invoiceId)}>{r.invoiceNumber ?? "faktura"}</Link></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
    </Card>
  );
}
