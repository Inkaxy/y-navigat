import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { QueryErrorState, QueryLoadingState } from "@/components/common/QueryState";
import { useTimelineHistory } from "@/ravarer/hooks/useRmSuppliers";
import { useUserNames } from "@/ravarer/hooks/useUserNames";
import { useMatchTolerances } from "@/fakturaer/hooks/useMatchTolerances";
import { useCompany } from "@/hooks/useCompany";
import { osloTodayISO } from "@/lib/osloDate";
import { formatNok } from "@/ravarer/lib/constants";
import { paths } from "@/ravarer/lib/paths";
import { buildAllPrices, defaultSince, MIN_PRICES_FOR_MEDIAN, registeredByLabel } from "@/ravarer/lib/allPrices";

const pctFmt = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1, minimumFractionDigits: 1, signDisplay: "exceptZero" });
const pct1 = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 });
const dateFmt = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };

interface Props {
  rawMaterialId: string;
  baseUnit: string;
  category: string | null;
  /** Kompakt visning i panelet ved siden av varelisten. */
  compact?: boolean;
}

/** «Alle priser» — bare lesing. Ingen retting her (kommer i fase a2). */
export function AllPricesList({ rawMaterialId, baseUnit, category, compact }: Props) {
  const [since, setSince] = useState(() => defaultSince(osloTodayISO()));
  const history = useTimelineHistory(rawMaterialId);
  const { data: company } = useCompany();
  const tol = useMatchTolerances(company?.id);
  const threshold = tol.isLoaded && !tol.isFetching ? tol.toleranceFor(category) : null;
  const result = useMemo(
    () => buildAllPrices(history.rows, { since: since || null, currentUnit: baseUnit, thresholdPct: threshold }),
    [history.rows, since, baseUnit, threshold],
  );
  const names = useUserNames(result.rows.map((r) => r.row.createdBy));
  const nameMap = names.data ?? null;

  return (
    <section className="space-y-3" aria-labelledby={`alle-priser-${rawMaterialId}`} data-testid="all-prices">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h3 id={`alle-priser-${rawMaterialId}`} className="text-base font-semibold">Alle priser</h3>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`alle-priser-siden-${rawMaterialId}`} className="text-caption text-ink-secondary">Siden</Label>
            <Input id={`alle-priser-siden-${rawMaterialId}`} type="date" value={since} onChange={(e) => setSince(e.target.value)} className="h-11 w-[11rem]" />
          </div>
          <Button type="button" variant="ghost" size="sm" className="min-h-[44px]" onClick={() => setSince("")}>Alle</Button>
        </div>
      </div>

      {history.isError ? (
        <QueryErrorState error={history.error} scope="ravarer:alle-priser" title="Kunne ikke hente prisene" onRetry={() => history.refetch()} />
      ) : history.isLoading ? (
        <QueryLoadingState />
      ) : result.rows.length === 0 ? (
        <p className="text-sm text-ink-secondary">Ingen priser {since ? `siden ${dateFmt(since)}` : "registrert"}.</p>
      ) : (
        <>
          <p className="text-caption text-ink-secondary" data-testid="all-prices-basis">
            {result.median == null
              ? `Avvik merkes når perioden har minst ${MIN_PRICES_FOR_MEDIAN} sammenlignbare priser.`
              : result.thresholdPct == null
                ? `Median ${formatNok(result.median)} / ${baseUnit}. Avviksgrensen er ukjent, så ingen priser merkes.`
                : `Median ${formatNok(result.median)} / ${baseUnit}. «Avvik» = mer enn ${pct1.format(result.thresholdPct)} % fra medianen (toleransen for kategorien).`}
            {history.projectionError ? " Kontrollen av kildene feilet, så noen priser kan ikke sammenlignes." : ""}
          </p>
          <ul className="divide-y divide-line-subtle text-sm">
            {result.rows.map((r) => (
              <li key={r.row.id} className={compact ? "py-2" : "grid gap-1 py-2 sm:grid-cols-[7rem_1fr_6rem_1fr] sm:items-center"} data-testid="all-prices-row">
                <span className="tabular-nums text-ink-secondary">{dateFmt(r.row.effective_date)}</span>
                <span className="tabular-nums font-medium">
                  {formatNok(Number(r.row.price))} / {r.row.unit ?? baseUnit}
                  {r.deviation === true && <span className="ml-2 rounded-sm bg-warning/15 px-1.5 py-0.5 text-caption text-warning" title={`${pct1.format(r.deviationPct ?? 0)} % fra medianen`}>Avvik</span>}
                  {r.kindLabel && <span className="ml-2 text-caption text-ink-secondary">{r.kindLabel}</span>}
                </span>
                <span className="tabular-nums">{r.changePct == null ? "—" : `${pctFmt.format(r.changePct)} %`}</span>
                <span className="text-caption text-ink-secondary">
                  {registeredByLabel(r.row, nameMap)}
                  {r.row.invoice_id && (
                    <> · <Link className="underline-offset-2 hover:underline" to={paths.faktura(r.row.invoice_id)}>{r.row.invoiceNumber ? `Faktura ${r.row.invoiceNumber}` : "Faktura"}</Link></>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
