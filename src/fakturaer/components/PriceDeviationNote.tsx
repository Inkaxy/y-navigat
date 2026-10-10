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
}

/** Nivådelt vurdering av ett prisavvik i klartekst. */
export function PriceDeviationNote({ actual, expected, baseQuantity, tolerancePct, settings, className }: Props) {
  const r = evaluatePriceDeviation({
    actual,
    expected,
    baseQuantity,
    tolPct: tolerancePct,
    minImpactNok: settings?.price_min_impact_nok ?? DEFAULT_MIN_IMPACT_NOK,
    hardCapPct: settings?.price_hard_cap_pct ?? DEFAULT_HARD_CAP_PCT,
  });
  if (r.rule === "mangler_grunnlag") return null;
  return <p className={cn("text-caption", r.large ? "text-warning" : "text-ink-secondary", className)}>{r.explanation}</p>;
}
