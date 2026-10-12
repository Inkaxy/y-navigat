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

  const settled = q.isSuccess && !q.isError;
  const unverifiedRows = useMemo(() => rows.filter((r) => r.status !== "avviker"), [rows]);
  const toggle = (id: string, v: boolean) => setChecked((prev) => { const n = new Set(prev); if (v) n.add(id); else n.delete(id); return n; });

  const renderRow = (r: (typeof rows)[number]) => (
    <li key={r.rawMaterialId} className="flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-line-subtle py-2 text-sm">
      {r.status === "avviker" && canWrite && (
        <label className="-my-1 flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center">
          <Checkbox aria-label={`Velg ${r.name}`} checked={checked.has(r.rawMaterialId)} onCheckedChange={(v) => toggle(r.rawMaterialId, v === true)} />
        </label>
      )}
      <div className="min-w-0 flex-1 basis-48">
        <Link className="font-medium hover:underline" to={paths.raavare(r.rawMaterialId)}>{r.name}</Link>{" "}
        <Badge variant="outline">{r.status === "avviker" ? "Avviker" : "Uverifisert"}</Badge>
        <div className="text-caption text-ink-secondary">
          {r.sourceDate ? formatDate(r.sourceDate) : "Ingen gyldig kilde"}
          {r.supplierName && <> · {r.supplierName}</>}
          {r.invoiceId && <> · <Link className="text-app hover:underline" to={paths.faktura(r.invoiceId)}>{r.invoiceNumber ?? "faktura"}</Link></>}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 text-right tabular-nums">
        <dt className="text-caption text-ink-secondary">Lagret</dt>
        <dt className="text-caption text-ink-secondary">Nyeste gyldige</dt>
        <dd>{r.currentPrice != null ? `${formatNok(r.currentPrice)}/${r.baseUnit ?? ""}` : "—"}</dd>
        <dd>{r.sourcePrice != null ? `${formatNok(r.sourcePrice)}/${r.baseUnit ?? ""}` : "—"}</dd>
      </dl>
    </li>
  );

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold text-ink-primary">Avvik mot nyeste gyldige pris</h2>
          <p className="mt-1 text-sm text-ink-secondary" data-testid="deviation-summary">
            {settled
              ? <>{deviating.length} med lagret kostpris som ikke er nyeste gyldige pris. {unverified} uten gyldig kilde (uverifisert) — de beholdes til en pris dokumenteres.</>
              : q.isError ? "Avvikene kunne ikke hentes — antallet er ukjent." : "Henter avvik …"}
          </p>
        </div>
        {canWrite && (
          <Button className="min-h-[44px]" onClick={run} disabled={refresh.isPending || checked.size === 0}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden /> Oppdater valgte ({checked.size})
          </Button>
        )}
      </div>
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} scope="ravarer:kostpris-avvik" onRetry={() => q.refetch()} isEmpty={rows.length === 0} emptyTitle="Ingen avvik" emptyDescription="Alle kostpriser er nyeste gyldige pris.">
        {deviating.length > 0 && <ul aria-label="Avviker" className="max-h-96 overflow-auto">{deviating.map(renderRow)}</ul>}
        {unverifiedRows.length > 0 && (
          <details className="rounded-md border border-line-subtle">
            <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-sm font-medium">Vis {unverifiedRows.length} uverifiserte</summary>
            <ul aria-label="Uverifiserte" className="max-h-96 overflow-auto px-3">{unverifiedRows.map(renderRow)}</ul>
          </details>
        )}
      </QueryState>
    </Card>
  );
}
