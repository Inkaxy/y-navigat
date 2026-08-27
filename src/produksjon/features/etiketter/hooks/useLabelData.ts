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
  /** Grovhet beregnet av `compute-recipe-label` — fasit når den finnes. */
  beregnetGrovhet: GrainCategory | null;
  /** Manuelt satt `products.breadscale_value`, kun reserve. */
  manuellGrovhet: GrainCategory | null;
}

export type LabelDataMap = Record<string, LabelData | null>;

function toMap(ids: string[], rows: unknown): LabelDataMap {
  const out: LabelDataMap = {};
  for (const id of ids) out[id] = null;
  for (const raw of (rows as Array<Record<string, unknown>>) ?? []) {
    const id = raw.order_line_id as string;
    if (!id) continue;
    const felter = (raw.felter ?? {}) as Record<string, unknown>;
    const safeFelter = typeof felter === "object" && felter !== null ? felter : {};
    out[id] = {
      felter: safeFelter,
      mangler: (raw.mangler as string[] | null) ?? [],
      beregnetGrovhet: null,
      manuellGrovhet: grainCategoryFromBreadscaleValue(safeFelter.brodskala),
    };
  }
  return out;
}

/**
 * Slår opp beregnet grovhet (`recipe_label_calculated.grain_category`) via
 * ordrelinje → produkt → primæroppskrift, og lar den vinne over manuell verdi.
 */
async function attachComputedGrain(map: LabelDataMap): Promise<LabelDataMap> {
  const ids = Object.keys(map).filter((id) => map[id]);
  if (ids.length === 0) return map;

  const { data: lines } = await supabase
    .from("order_lines")
    .select("id, product_id")
    .in("id", ids);
  const productByLine = new Map<string, string>();
  for (const l of (lines ?? []) as Array<{ id: string; product_id: string | null }>) {
    if (l.product_id) productByLine.set(l.id, l.product_id);
  }
  const productIds = [...new Set(productByLine.values())];
  if (productIds.length === 0) return map;

  const { data: links } = await supabase
    .from("product_recipe_links")
    .select("product_id, recipe_id, is_primary")
    .in("product_id", productIds);
  const recipeByProduct = new Map<string, string>();
  for (const l of (links ?? []) as Array<{ product_id: string; recipe_id: string; is_primary: boolean | null }>) {
    if (!recipeByProduct.has(l.product_id) || l.is_primary) recipeByProduct.set(l.product_id, l.recipe_id);
  }
  const recipeIds = [...new Set(recipeByProduct.values())];
  if (recipeIds.length === 0) return map;

  const { data: calc } = await supabase
    .from("recipe_label_calculated")
    .select("recipe_id, grain_category")
    .in("recipe_id", recipeIds);
  const grainByRecipe = new Map<string, GrainCategory>();
  for (const c of (calc ?? []) as Array<{ recipe_id: string; grain_category: string | null }>) {
    if (c.grain_category) grainByRecipe.set(c.recipe_id, c.grain_category as GrainCategory);
  }

  for (const id of ids) {
    const entry = map[id];
    if (!entry) continue;
    const productId = productByLine.get(id);
    const recipeId = productId ? recipeByProduct.get(productId) : undefined;
    const beregnet = recipeId ? grainByRecipe.get(recipeId) ?? null : null;
    entry.beregnetGrovhet = beregnet;
    // Beregningen er fasit; manuell verdi brukes kun når beregning mangler.
    const effektiv = beregnet ?? entry.manuellGrovhet;
    if (effektiv) entry.felter = { ...entry.felter, brodskala_beregnet: effektiv };
  }
  return map;
}

/** Henter etikettdata for et sett ordrelinjer utenfor React. */
export async function fetchLabelData(
  orderLineIds: string[],
): Promise<LabelDataMap> {
  const ids = orderLineIds.filter(Boolean);
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc("resolve_label_data", {
    p_order_line_ids: ids,
  });
  if (error) throw error;
  return attachComputedGrain(toMap(ids, data));
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
