import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { evaluatePriceDeviation } from "@/fakturaer/lib/priceDeviation";
import { DEFAULT_MIN_IMPACT_NOK } from "@/fakturaer/hooks/useMatchTolerances";
import { formatDate, formatNumber } from "@/ravarer/lib/constants";
import { priceSourceLabel } from "@/ravarer/lib/varelisteCsv";
import { cn } from "@/lib/utils";

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
