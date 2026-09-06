import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChefHat, ExternalLink, Loader2, Plus } from "lucide-react";
import { useStockTrackedRawMaterials } from "@/varer/hooks/useStockTrackedRawMaterials";
import { computeTotals, fmtG, fmtPercent, RECIPE_STATUS_LABEL, type BakersRawMaterial } from "@/varer/lib/bakers";

interface Props {
  productId: string;
  productName: string;
  legalEntityId: string | null;
  canWrite: boolean;
}

/**
 * Oppsummeringskort på varekortet. Selve redigeringen bor i oppskriftsmodulen.
 */
export function RecipeSummaryCard({ productId, productName, legalEntityId, canWrite }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const linkQuery = useQuery({
    queryKey: ["product-recipe-summary", productId],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_recipe_links")
        .select("id, recipe_id, recipes(id, name, category, status, version, unit_weight_grams, recipe_lines(id, quantity, unit, raw_material_id, is_flour_override, water_content_pct_override, ingredient_name))")
        .eq("product_id", productId)
        .order("is_primary", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) return data as any;
      const { data: direct } = await supabase
        .from("recipes")
        .select("id, name, category, status, version, unit_weight_grams, recipe_lines(id, quantity, unit, raw_material_id, is_flour_override, water_content_pct_override, ingredient_name)")
        .eq("product_id", productId)
        .is("valid_to", null)
        .maybeSingle();
      return direct ? { id: null, recipe_id: direct.id, recipes: direct } : null;
    },
  });

  const rmQuery = useQuery({
    queryKey: ["rm-bakers-map", legalEntityId],
    queryFn: async () => {
      const { data } = await supabase
        .from("raw_materials")
        .select("id, name, category, grain_classification, water_content_pct, unit_weight_grams, current_cost_price")
        .limit(2000);
      const map: Record<string, BakersRawMaterial> = {};
      for (const r of (data ?? []) as any[]) map[r.id] = r;
      return map;
    },
  });

  const trackedQuery = useStockTrackedRawMaterials();

  async function createRecipe() {
    const { data, error } = await supabase
      .from("recipes")
      .insert({
        name: productName,
        product_id: productId,
        legal_entity_id: legalEntityId,
        status: "draft",
        yield_quantity: 1,
        yield_unit: "stk",
      } as never)
      .select("id")
      .single();
    if (error) return toast.error(error.message);
    await supabase.from("recipe_parts").insert({ recipe_id: data.id, name: "Hoveddeig", sort_order: 0, part_type: "dough" } as never);
    await supabase.from("product_recipe_links").insert({ product_id: productId, recipe_id: data.id, is_primary: true } as never);
    qc.invalidateQueries({ queryKey: ["product-recipe-summary", productId] });
    navigate(`/varer/oppskrifter/${data.id}`);
  }

  if (linkQuery.isLoading) {
    return <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const recipe = linkQuery.data?.recipes;

  if (!recipe) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <ChefHat className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Ingen oppskrift koblet til denne varen.</p>
          {canWrite && (
            <Button onClick={createRecipe}><Plus className="mr-2 h-4 w-4" /> Opprett oppskrift</Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const trackedIds = trackedQuery.data;
  const lines = (recipe.recipe_lines ?? []).map((l: any) => ({
    ...l,
    _rm: l.raw_material_id ? (rmQuery.data ?? {})[l.raw_material_id] ?? null : null,
  }));
  const totals = computeTotals(lines, recipe.unit_weight_grams);
  const trackedCount = lines.filter((l: any) => l.raw_material_id && trackedIds?.has(l.raw_material_id)).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ChefHat className="h-4 w-4 text-app" />
          {recipe.name || "Oppskrift"}
          <span className="text-xs font-normal text-muted-foreground">v{recipe.version}</span>
          <Badge variant="outline">{RECIPE_STATUS_LABEL[recipe.status ?? "draft"] ?? recipe.status}</Badge>
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => navigate(`/varer/oppskrifter/${recipe.id}`)}>
          Åpne i oppskrifter <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Melvekt" value={`${fmtG(totals.totalFlourG)} g`} />
        <Stat label="Hydrering" value={fmtPercent(totals.hydrationPct)} />
        <Stat label="Deigvekt" value={`${fmtG(totals.totalDoughG)} g`} />
        <Stat label="Ingredienser" value={`${lines.length}`} />
      </CardContent>
      {trackedCount > 0 && (
        <CardContent className="pt-0 text-xs text-muted-foreground">
          Lagertrekk aktivt: {trackedCount} av {lines.length} ingredienser lagerføres og trekkes ved kjørt pakkseddel.
        </CardContent>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
