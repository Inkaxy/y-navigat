import { evaluatePriceDeviation } from "@/fakturaer/lib/priceDeviation";
import { DEFAULT_HARD_CAP_PCT, DEFAULT_MIN_IMPACT_NOK, type MatchSettings } from "@/fakturaer/hooks/useMatchTolerances";
import { cn } from "@/lib/utils";

interface Props {
  actual: number | null;
  expected: number | null;
  baseQuantity: number | null;
  tolerancePct: number;
  settings: MatchSettings | null;
  className?: string;
  /** Bare prosenten, forklaringen i tooltip. */
  compact?: boolean;
}

/** Nivådelt vurdering av ett prisavvik i klartekst. */
export function PriceDeviationNote({ actual, expected, baseQuantity, tolerancePct, settings, className, compact }: Props) {
  const r = evaluatePriceDeviation({
    actual,
    expected,
    baseQuantity,
    tolPct: tolerancePct,
    minImpactNok: settings?.price_min_impact_nok ?? DEFAULT_MIN_IMPACT_NOK,
    hardCapPct: settings?.price_hard_cap_pct ?? DEFAULT_HARD_CAP_PCT,
  });
  if (r.rule === "mangler_grunnlag") return compact ? <span className="text-ink-secondary">—</span> : null;
  if (compact && r.pct != null) {
    return (
      <span title={r.explanation} className={cn("whitespace-nowrap text-xs tabular-nums", r.large ? "text-warning" : "text-ink-secondary", className)}>
        {r.pct > 0 ? "+" : r.pct < 0 ? "−" : ""}{Math.abs(r.pct).toLocaleString("nb-NO", { maximumFractionDigits: 1 })} %
        <span className="sr-only"> — {r.explanation}</span>
      </span>
    );
  }
  return <p className={cn("text-caption", r.large ? "text-warning" : "text-ink-secondary", className)}>{r.explanation}</p>;
}
