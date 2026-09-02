import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { grainCategoryFromBreadscaleValue } from "@/varer/lib/brodskalan";
import type { GrainCategory } from "@/varer/lib/breadscale";

/** Én ordrelinje med ferdig oppløste etikettverdier fra RPC `resolve_label_data`. */
export interface LabelData {
  /** Verdier per feltnøkkel fra `label_field_catalog`. */
  felter: Record<string, unknown>;
  /** Felter som profilen kan skrive ut, men som mangler verdi. */
  mangler: string[];
  /**
   * EFFEKTIV grovhet fra `products.breadscale_value` (trinn 1–4).
   * Verdien vedlikeholdes av bryterne på oppskrift og produkt, og av DB-triggere
   * — etiketten skal aldri overstyre den med beregningen.
   */
  effektivGrovhet: GrainCategory | null;
  /** Effektiv prosent fra `products.breadscale_pct`, kun til visning. */
  effektivGrovhetPct: number | null;
}

export type LabelDataMap = Record<string, LabelData | null>;

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toMap(ids: string[], rows: unknown): LabelDataMap {
  const out: LabelDataMap = {};
  for (const id of ids) out[id] = null;
  for (const raw of (rows as Array<Record<string, unknown>>) ?? []) {
    const id = raw.order_line_id as string;
    if (!id) continue;
    const felter = (raw.felter ?? {}) as Record<string, unknown>;
    const safeFelter = typeof felter === "object" && felter !== null ? felter : {};
    const kategori = grainCategoryFromBreadscaleValue(safeFelter.brodskala);
    out[id] = {
      // `brodskala_beregnet` beholdes som feltnøkkel for etikettmalen, men den
      // inneholder nå den effektive verdien fra produktet.
      felter: kategori ? { ...safeFelter, brodskala_beregnet: kategori } : safeFelter,
      mangler: (raw.mangler as string[] | null) ?? [],
      effektivGrovhet: kategori,
      effektivGrovhetPct: toNum(safeFelter.brodskala_pct),
    };
  }
  return out;
}

/** Henter etikettdata for et sett ordrelinjer utenfor React. */
export async function fetchLabelData(orderLineIds: string[]): Promise<LabelDataMap> {
  const ids = orderLineIds.filter(Boolean);
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc("resolve_label_data", {
    p_order_line_ids: ids,
  });
  if (error) throw error;
  return toMap(ids, data);
}

export function useLabelData(orderLineIds: string[] | undefined) {
  const ids = (orderLineIds ?? []).filter(Boolean).slice().sort();
  return useQuery({
    queryKey: ["resolve_label_data", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: () => fetchLabelData(ids),
    staleTime: 30_000,
  });
}

