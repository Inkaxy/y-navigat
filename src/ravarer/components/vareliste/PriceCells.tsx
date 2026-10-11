import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { evaluatePriceDeviation } from "@/fakturaer/lib/priceDeviation";
import { DEFAULT_MIN_IMPACT_NOK } from "@/fakturaer/hooks/useMatchTolerances";
import { formatDate, formatNumber } from "@/ravarer/lib/constants";
import { priceSourceLabel } from "@/ravarer/lib/varelisteCsv";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { paths } from "@/ravarer/lib/paths";
import { COST_STATUS_LABEL, type CostStatus, type ListComparison } from "@/ravarer/lib/listPriceEvidence";

/** Avvik uten mengde: bare prosenten teller (samme regel som motoren). */
export function isLargeDeviation(pct: number | null | undefined, tolPct: number, hardCapPct: number): boolean {
  if (pct == null || !Number.isFinite(pct)) return false;
  return evaluatePriceDeviation({ actual: 100 + pct, expected: 100, baseQuantity: null, tolPct, minImpactNok: DEFAULT_MIN_IMPACT_NOK, hardCapPct }).large;
}

export function DeviationCell({ deviation, tolerance, hardCap }: { deviation: number | null; tolerance: number; hardCap: number }) {
  if (deviation == null) return <span className="text-muted-foreground">—</span>;
  const over = isLargeDeviation(deviation, tolerance, hardCap);
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-xs tabular-nums", over ? "bg-destructive/10 text-destructive" : "text-muted-foreground")}
      title={`Toleranse ${formatNumber(tolerance, 1)} %`}>
      {deviation > 0 ? "+" : ""}
      {formatNumber(deviation, 1)} %
    </span>
  );
}

export function PriceSourceCell({ source, updatedAt }: { source: string | null; updatedAt: string | null }) {
  const label = priceSourceLabel(source);
  if (label === "—" || !updatedAt) return <span className="text-muted-foreground">{label}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span tabIndex={0}>{label}</span></TooltipTrigger>
      <TooltipContent>Oppdatert {formatDate(updatedAt)}</TooltipContent>
    </Tooltip>
  );
}

/** Merke når lagret kostpris ikke er verifisert — vises sammen med prisen, aldri som brukbar kost. */
export function CostStatusMark({ status }: { status: CostStatus }) {
  if (status === "verifisert") return null;
  return <Badge variant="outline" className="ml-1 border-warning/40 px-1 py-0 text-[11px] font-normal text-warning">{COST_STATUS_LABEL[status]}</Badge>;
}

export const COMPARISON_BASIS = "Siste faktura mot gjeldende kostpris (ikke avtalepris)";

/**
 * Avvik i listen: bare serverbevist «siste faktura mot gjeldende kostpris». Ukjent viser
 * grunnen og en handling til fakturaen; vises aldri som 0 og aldri som rødt avvik.
 */
export function ComparisonCell({ comparison, baseUnit, tolerance, hardCap }: { comparison: ListComparison; baseUnit: string; tolerance: number; hardCap: number }) {
  if (comparison.state === "eligible") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}><DeviationCell deviation={comparison.deviation} tolerance={tolerance} hardCap={hardCap} /></span>
        </TooltipTrigger>
        <TooltipContent>
          {COMPARISON_BASIS}. Faktura {comparison.invoiceNumber ?? ""} {formatDate(comparison.invoiceDate)}: {formatNumber(comparison.invoicePpbu, 2)} kr/{baseUnit}. Kontrollert {formatDate(comparison.checkedAt)}.
        </TooltipContent>
      </Tooltip>
    );
  }
  if (comparison.state === "pending") return <span className="text-xs text-muted-foreground" title={comparison.label}>—</span>;
  if (!comparison.needsControl) return <span className="text-xs text-muted-foreground" title={comparison.label}>—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs text-muted-foreground" title={`${COMPARISON_BASIS}: ${comparison.label}`}>
      <span>{comparison.label}</span>
      {comparison.invoiceId && (
        <Link to={paths.faktura(comparison.invoiceId)} className="text-primary underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
          Kontroller faktura
        </Link>
      )}
    </span>
  );
}
