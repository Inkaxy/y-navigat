/**
 * UTDATERTE BEREGNINGER
 * ---------------------------------------------------------------------------
 * Så lenge databasen ikke har et `is_stale`-flagg sammenligner vi i UI:
 * beregningens tidspunkt mot oppskriftens `updated_at` og mot siste endring på
 * råvarene (og næringsradene) som inngår i oppskriften.
 */

export interface StalenessSource {
  /** Hva som er endret — «Hvetemel» eller «Oppskriften». */
  name: string;
  updatedAt: string | null | undefined;
}

export interface StalenessResult {
  /** Ingen beregning finnes ennå. */
  neverComputed: boolean;
  stale: boolean;
  /** Kilden som er nyere enn beregningen. */
  sourceName: string | null;
  changedAt: string | null;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

export function computeStaleness(
  computedAt: string | null | undefined,
  sources: StalenessSource[],
): StalenessResult {
  const computed = ms(computedAt);
  if (computed == null) return { neverComputed: true, stale: true, sourceName: null, changedAt: null };

  let newest: StalenessSource | null = null;
  let newestMs = computed;
  for (const s of sources) {
    const t = ms(s.updatedAt);
    if (t != null && t > newestMs) {
      newestMs = t;
      newest = s;
    }
  }
  if (!newest) return { neverComputed: false, stale: false, sourceName: null, changedAt: null };
  return {
    neverComputed: false,
    stale: true,
    sourceName: newest.name,
    changedAt: newest.updatedAt ?? null,
  };
}

export type LabelingStatus = "approved" | "stale" | "missing";

/** Statusen som vises i «Merking»-kolonnen i lista. */
export function deriveLabelingStatus(input: {
  approvedAt: string | null | undefined;
  computedAt: string | null | undefined;
  sources: StalenessSource[];
  /** Sperre fra beregningen eller manglende pliktfelt. */
  blocked?: boolean;
}): LabelingStatus {
  if (!input.approvedAt || input.blocked) return "missing";
  const staleness = computeStaleness(input.computedAt, [
    ...input.sources,
    { name: "Godkjenning", updatedAt: null },
  ]);
  if (staleness.neverComputed) return "missing";
  const approved = ms(input.approvedAt);
  const computed = ms(input.computedAt);
  // Er godkjenningen eldre enn siste beregning eller siste endring, er den utdatert.
  if (approved != null && computed != null && approved < computed) return "stale";
  return staleness.stale ? "stale" : "approved";
}

export const LABELING_STATUS_LABEL: Record<LabelingStatus, string> = {
  approved: "Godkjent",
  stale: "Utdatert",
  missing: "Mangler",
};
