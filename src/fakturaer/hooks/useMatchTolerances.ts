import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const FALLBACK_TOLERANCE_PCT = 5;

export interface MatchTolerances {
  defaultPct: number;
  byCategory: Record<string, number>;
  /** Toleranse i prosent for en kategori: kategori-override → default → 5. */
  toleranceFor: (category?: string | null) => number;
}

/**
 * Henter de reelle prisavvik-toleransene for et selskap
 * (invoice_match_settings + invoice_match_category_tolerances).
 */
export function useMatchTolerances(legalEntityId: string | null | undefined): MatchTolerances {
  const { data } = useQuery({
    queryKey: ["invoice-match-tolerances", legalEntityId ?? "all"],
    enabled: !!legalEntityId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const [settings, cats] = await Promise.all([
        supabase
          .from("invoice_match_settings")
          .select("default_price_tolerance_pct")
          .eq("legal_entity_id", legalEntityId!)
          .maybeSingle(),
        supabase
          .from("invoice_match_category_tolerances")
          .select("category, price_tolerance_pct")
          .eq("legal_entity_id", legalEntityId!),
      ]);
      if (settings.error) throw settings.error;
      if (cats.error) throw cats.error;
      const byCategory: Record<string, number> = {};
      (cats.data ?? []).forEach((c) => {
        byCategory[c.category] = Number(c.price_tolerance_pct);
      });
      return {
        defaultPct: settings.data?.default_price_tolerance_pct ?? FALLBACK_TOLERANCE_PCT,
        byCategory,
      };
    },
  });

  const defaultPct = data?.defaultPct ?? FALLBACK_TOLERANCE_PCT;
  const byCategory = data?.byCategory ?? {};

  return {
    defaultPct,
    byCategory,
    toleranceFor: (category?: string | null) => {
      if (category && byCategory[category] != null) return byCategory[category];
      return defaultPct ?? FALLBACK_TOLERANCE_PCT;
    },
  };
}
