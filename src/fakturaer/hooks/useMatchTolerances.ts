import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const FALLBACK_TOLERANCE_PCT = 5;

export interface MatchSettings {
  default_price_tolerance_pct: number;
  fuzzy_match_threshold: number | null;
  fuzzy_auto_match_threshold: number | null;
  fuzzy_auto_match_dominance_threshold: number | null;
  auto_approve_within_tolerance: boolean;
  auto_reconcile_clean_imports: boolean;
}

export interface MatchTolerances {
  defaultPct: number;
  byCategory: Record<string, number>;
  settings: MatchSettings | null;
  isLoading: boolean;
  /** Toleranse i prosent for en kategori: kategori-override → default → 5. */
  toleranceFor: (category?: string | null) => number;
}

interface ToleranceData {
  defaultPct: number;
  byCategory: Record<string, number>;
  settings: MatchSettings | null;
}

/** Henter innstillinger og kategoritoleranser for ett selskap. */
async function fetchTolerances(legalEntityId: string): Promise<ToleranceData> {
  const [settings, cats] = await Promise.all([
    supabase
      .from("invoice_match_settings")
      .select(
        "default_price_tolerance_pct, fuzzy_match_threshold, fuzzy_auto_match_threshold, fuzzy_auto_match_dominance_threshold, auto_approve_within_tolerance, auto_reconcile_clean_imports",
      )
      .eq("legal_entity_id", legalEntityId)
      .maybeSingle(),
    supabase
      .from("invoice_match_category_tolerances")
      .select("category, price_tolerance_pct")
      .eq("legal_entity_id", legalEntityId),
  ]);
  if (settings.error) throw settings.error;
  if (cats.error) throw cats.error;
  const byCategory: Record<string, number> = {};
  (cats.data ?? []).forEach((c) => {
    byCategory[c.category] = Number(c.price_tolerance_pct);
  });
  const s = settings.data;
  return {
    defaultPct: s?.default_price_tolerance_pct ?? FALLBACK_TOLERANCE_PCT,
    byCategory,
    settings: s
      ? ({
          default_price_tolerance_pct: Number(s.default_price_tolerance_pct ?? FALLBACK_TOLERANCE_PCT),
          fuzzy_match_threshold: s.fuzzy_match_threshold == null ? null : Number(s.fuzzy_match_threshold),
          fuzzy_auto_match_threshold:
            s.fuzzy_auto_match_threshold == null ? null : Number(s.fuzzy_auto_match_threshold),
          fuzzy_auto_match_dominance_threshold:
            s.fuzzy_auto_match_dominance_threshold == null
              ? null
              : Number(s.fuzzy_auto_match_dominance_threshold),
          auto_approve_within_tolerance: !!s.auto_approve_within_tolerance,
          auto_reconcile_clean_imports: !!s.auto_reconcile_clean_imports,
        } satisfies MatchSettings)
      : null,
  };
}

/**
 * ÉN kilde til prisavvik-toleransene (invoice_match_settings +
 * invoice_match_category_tolerances). Alle flater som fargelegger eller
 * vurderer avvik skal bruke denne — aldri hardkodede prosenter.
 */
export function useMatchTolerances(legalEntityId: string | null | undefined): MatchTolerances {
  const { data, isLoading } = useQuery({
    queryKey: ["invoice-match-tolerances", legalEntityId ?? "all"],
    enabled: !!legalEntityId,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchTolerances(legalEntityId!),
  });

  const defaultPct = data?.defaultPct ?? FALLBACK_TOLERANCE_PCT;
  const byCategory = data?.byCategory ?? {};

  return {
    defaultPct,
    byCategory,
    settings: data?.settings ?? null,
    isLoading,
    toleranceFor: (category?: string | null) => resolveTolerance(category, defaultPct, byCategory),
  };
}

/**
 * Ren oppløsning av toleranse: kategori-override slår global, global slår
 * fallback. Ligger utenfor hooken slik at den kan testes.
 */
export function resolveTolerance(
  category: string | null | undefined,
  defaultPct: number | null | undefined,
  byCategory: Record<string, number>,
): number {
  if (category && byCategory[category] != null && Number.isFinite(byCategory[category])) {
    return byCategory[category];
  }
  if (defaultPct != null && Number.isFinite(defaultPct)) return defaultPct;
  return FALLBACK_TOLERANCE_PCT;
}


/**
 * Toleranser for flere selskaper samtidig — brukes når innboksen viser
 * fakturaer på tvers av selskaper. Hver faktura vurderes mot sitt eget
 * selskaps terskler, ikke mot et vilkårlig valgt selskap.
 */
export function useMatchTolerancesByEntity(
  entityIds: readonly string[],
): (legalEntityId: string | null, category?: string | null) => number {
  const ids = useMemo(() => [...new Set(entityIds.filter(Boolean))].sort(), [entityIds]);

  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["invoice-match-tolerances", id],
      staleTime: 5 * 60 * 1000,
      queryFn: () => fetchTolerances(id),
    })),
  });

  const map = useMemo(() => {
    const out: Record<string, { defaultPct: number; byCategory: Record<string, number> }> = {};
    ids.forEach((id, i) => {
      const d = results[i]?.data;
      if (d) out[id] = { defaultPct: d.defaultPct, byCategory: d.byCategory };
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, results.map((r) => (r.data ? 1 : 0)).join("")]);

  return (legalEntityId, category) => {
    const entry = legalEntityId ? map[legalEntityId] : undefined;
    return resolveTolerance(category, entry?.defaultPct ?? null, entry?.byCategory ?? {});
  };
}
