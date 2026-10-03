import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import { deriveLabelingStatusFromDb, type LabelingStatus } from "@/varer/lib/labelStaleness";
import { latestApprovalByRecipe } from "@/varer/lib/labelWorkspace";
import { computeTotalsForRecipe, type BakersLine, type BakersRawMaterial } from "@/varer/lib/bakers";

/** Rå rad fra listespørringen — modulen bruker ikke de genererte Supabase-typene. */
type RecipeLineRow = BakersLine & { id: string; raw_material_id: string | null };
export type RecipeListRow = {
  id: string;
  name: string | null;
  image_url: string | null;
  category: string | null;
  status: string | null;
  department: string | null;
  version: number | null;
  updated_at: string | null;
  unit_weight_grams: number | null;
  units_per_batch: number | null;
  dough_piece_grams: number | null;
  dough_waste_pct: number | null;
  product_id: string | null;
  is_template: boolean | null;
  recipe_lines: RecipeLineRow[] | null;
  product_recipe_links: { product_id: string; products: { display_name: string | null } | null }[] | null;
};
export type RecipeRow = RecipeListRow & {
  totals: ReturnType<typeof computeTotalsForRecipe>;
  products: string[];
  labeling: LabelingStatus;
};

/** Henter og setter sammen alt oppskriftslisten trenger. */
export function useRecipeListData(legalEntityId: string | null | undefined) {
  const rmQuery = useQuery({
    queryKey: ["rm-bakers-map", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const data = await fetchAllRows<BakersRawMaterial>((from, to) =>
        supabase
          .from("raw_materials")
          .select("id, name, category, grain_classification, water_content_pct, unit_weight_grams, current_cost_price, density_g_per_ml, is_water")
          .eq("legal_entity_id", legalEntityId!)
          .eq("is_active", true)
          .range(from, to) as unknown as PromiseLike<{ data: BakersRawMaterial[] | null; error: { message: string } | null }>,
      );
      const map: Record<string, BakersRawMaterial> = {};
      for (const r of data) map[r.id] = r;
      return map;
    },
  });

  const recipesQuery = useQuery({
    queryKey: ["recipes-list", legalEntityId],
    queryFn: async () =>
      fetchAllRows<RecipeListRow>((from, to) =>
        supabase
          .from("recipes")
          .select("id, name, image_url, category, status, department, version, updated_at, unit_weight_grams, units_per_batch, dough_piece_grams, dough_waste_pct, product_id, is_template, recipe_lines(id, quantity, unit, raw_material_id, is_flour_override, water_content_pct_override, ingredient_name), product_recipe_links(product_id, products(display_name))")
          .is("valid_to", null)
          .order("created_at", { ascending: false })
          .range(from, to) as unknown as PromiseLike<{ data: RecipeListRow[] | null; error: { message: string } | null }>,
      ),
  });

  /** Antall aktive delingslenker per oppskrift — viser hva som ligger ute. */
  const shareCountsQuery = useQuery({
    queryKey: ["recipe-share-counts", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_share_links")
        .select("recipe_id, expires_at, revoked_at")
        .is("revoked_at", null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      const now = Date.now();
      for (const r of (data ?? []) as { recipe_id: string; expires_at: string | null }[]) {
        if (r.expires_at && new Date(r.expires_at).getTime() < now) continue;
        counts[r.recipe_id] = (counts[r.recipe_id] ?? 0) + 1;
      }
      return counts;
    },
  });

  /**
   * Merkestatus pr oppskrift — samme grunnlag som Merking-fanen og varelisten:
   * databasens `is_stale` på beregningen + godkjenningstidspunktet.
   */
  const labelingQuery = useQuery({
    queryKey: ["recipes-labeling-status", legalEntityId],
    queryFn: async () => {
      // Godkjenning = nyeste deklarasjonsversjon. Lagringsdatoen på oppskriften
      // flyttes også av «Lagre kladd» og kan derfor ikke brukes som bevis.
      const [calcRows, recRows, verRows] = await Promise.all([
        fetchAllRows<{ recipe_id: string; computed_at: string | null; is_stale: boolean | null }>((from, to) =>
          supabase.from("recipe_label_calculated").select("recipe_id, computed_at, is_stale").range(from, to),
        ),
        fetchAllRows<{ id: string }>((from, to) =>
          supabase.from("recipes").select("id").is("valid_to", null).range(from, to),
        ),
        fetchAllRows<{ recipe_id: string; approved_at: string | null }>((from, to) =>
          supabase.from("recipe_declaration_versions").select("recipe_id, approved_at").range(from, to),
        ),
      ]);
      const calcBy = new Map<string, { computed_at: string | null; is_stale: boolean | null }>();
      for (const c of calcRows) calcBy.set(c.recipe_id, c);
      const approvedBy = latestApprovalByRecipe(verRows);
      const out: Record<string, LabelingStatus> = {};
      for (const r of recRows) {
        const c = calcBy.get(r.id);
        out[r.id] = deriveLabelingStatusFromDb({
          approvedAt: approvedBy.get(r.id) ?? null,
          computedAt: c?.computed_at ?? null,
          isStale: c?.is_stale ?? null,
        });
      }
      return out;
    },
  });

  const rmMap = rmQuery.data;
  const labelingMap = labelingQuery.data;

  const rows = useMemo<RecipeRow[]>(() => {
    const rm = rmMap ?? {};
    const labels = labelingMap ?? {};
    return (recipesQuery.data ?? [])
      .filter((r) => !r.is_template)
      .map((r): RecipeRow => {
        const lines = (r.recipe_lines ?? []).map((l) => ({
          ...l,
          _rm: l.raw_material_id ? rm[l.raw_material_id] ?? null : null,
        }));
        const products = (r.product_recipe_links ?? [])
          .map((l) => l.products?.display_name)
          .filter((n): n is string => !!n);
        return { ...r, totals: computeTotalsForRecipe(lines, r), products, labeling: labels[r.id] ?? "missing" };
      });
  }, [recipesQuery.data, rmMap, labelingMap]);

  const templates = useMemo(() => (recipesQuery.data ?? []).filter((r) => r.is_template), [recipesQuery.data]);

  /** Distinkte kategorier som faktisk finnes i dataene, sortert på norsk. */
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of recipesQuery.data ?? []) if (r.category) set.add(r.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "nb"));
  }, [recipesQuery.data]);

  const staleCount = useMemo(
    () => Object.values(labelingMap ?? {}).filter((s) => s === "stale").length,
    [labelingMap],
  );

  // Kost og merking er en del av hver rad; feiler de, skal listen si fra
  // i stedet for å vise «Mangler»/0 g for alt.
  const queries = [recipesQuery, rmQuery, labelingQuery];
  return {
    rows,
    templates,
    categories,
    staleCount,
    shareCounts: shareCountsQuery.data ?? {},
    isLoading: recipesQuery.isLoading || rmQuery.isLoading || labelingQuery.isLoading,
    isError: queries.some((q) => q.isError),
    error: queries.find((q) => q.isError)?.error ?? null,
    refetch: () => {
      for (const q of queries) if (q.isError || q === recipesQuery) void q.refetch();
    },
  };
}
