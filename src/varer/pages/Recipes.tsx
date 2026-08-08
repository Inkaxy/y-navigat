import { useMemo, useState } from "react";
import { useAppContext } from "@/varer/context/AppContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppHeaderBanner } from "@/varer/components/layout/AppHeaderBanner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, ChefHat, Plus, Link2 } from "lucide-react";
import {
  computeTotals, fmtG, fmtPercent, RECIPE_STATUS_LABEL, type BakersRawMaterial,
} from "@/varer/lib/bakers";

export default function Recipes() {
  const { legalEntityId, canWrite } = useAppContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [creating, setCreating] = useState(false);

  const rmQuery = useQuery({
    queryKey: ["rm-bakers-map", legalEntityId],
    queryFn: async () => {
      const { data } = await supabase
        .from("raw_materials")
        .select("id, name, category, grain_classification, water_content_pct, current_cost_price")
        .limit(2000);
      const map: Record<string, BakersRawMaterial> = {};
      for (const r of (data ?? []) as any[]) map[r.id] = r;
      return map;
    },
  });

  const recipesQuery = useQuery({
    queryKey: ["recipes-list", legalEntityId],
    queryFn: async () => {
      const { data } = await supabase
        .from("recipes")
        .select("id, name, category, status, version, unit_weight_grams, units_per_batch, product_id, recipe_lines(id, quantity, unit, raw_material_id, is_flour_override, water_content_pct_override, ingredient_name), product_recipe_links(product_id, products(display_name))")
        .is("valid_to", null)
        .order("created_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  /** Antall aktive delingslenker per oppskrift — viser hva som ligger ute. */
  const shareCountsQuery = useQuery({
    queryKey: ["recipe-share-counts", legalEntityId],
    queryFn: async () => {
      const { data } = await supabase
        .from("recipe_share_links")
        .select("recipe_id, expires_at, revoked_at")
        .is("revoked_at", null);
      const counts: Record<string, number> = {};
      const now = Date.now();
      for (const r of (data ?? []) as any[]) {
        if (r.expires_at && new Date(r.expires_at).getTime() < now) continue;
        counts[r.recipe_id] = (counts[r.recipe_id] ?? 0) + 1;
      }
      return counts;
    },
  });

  const rmMap = rmQuery.data ?? {};
  const shareCounts = shareCountsQuery.data ?? {};


  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (recipesQuery.data ?? [])
      .map((r: any) => {
        const lines = (r.recipe_lines ?? []).map((l: any) => ({
          ...l,
          _rm: l.raw_material_id ? rmMap[l.raw_material_id] ?? null : null,
        }));
        const totals = computeTotals(lines, r.unit_weight_grams);
        const products = (r.product_recipe_links ?? []).map((l: any) => l.products?.display_name).filter(Boolean);
        return { ...r, totals, products };
      })
      .filter((r: any) => (statusFilter === "all" ? true : (r.status ?? "draft") === statusFilter))
      .filter((r: any) =>
        !q ? true : `${r.name ?? ""} ${r.category ?? ""} ${r.products.join(" ")}`.toLowerCase().includes(q),
      );
  }, [recipesQuery.data, rmMap, search, statusFilter]);

  async function createRecipe() {
    setCreating(true);
    const { data, error } = await supabase
      .from("recipes")
      .insert({ name: "Ny oppskrift", status: "draft", legal_entity_id: legalEntityId, yield_quantity: 1, yield_unit: "stk" } as never)
      .select("id")
      .single();
    if (error) {
      setCreating(false);
      toast.error(error.message);
      return;
    }
    await supabase.from("recipe_parts").insert({ recipe_id: data.id, name: "Hoveddeig", sort_order: 0, part_type: "dough" } as never);
    setCreating(false);
    qc.invalidateQueries({ queryKey: ["recipes-list"] });
    navigate(`/varer/oppskrifter/${data.id}`);
  }

  return (
    <>
      <AppHeaderBanner title="Oppskrifter" subtitle="Bakerfaglige oppskrifter med bakerprosent og prosess" />
      <div className="px-6 py-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Søk i navn, kategori eller produkt…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">Alle statuser</option>
            <option value="draft">Utkast</option>
            <option value="active">Aktiv</option>
            <option value="archived">Arkivert</option>
          </select>
          <div className="flex-1" />
          {canWrite && (
            <Button onClick={createRecipe} disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Ny oppskrift
            </Button>
          )}
        </div>

        <Card className="overflow-hidden">
          {recipesQuery.isLoading ? (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <ChefHat className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Ingen oppskrifter ennå.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left">Oppskrift</th>
                  <th className="px-4 py-2.5 text-left">Kategori</th>
                  <th className="px-4 py-2.5 text-right">Hydrering</th>
                  <th className="px-4 py-2.5 text-right">Deigvekt</th>
                  <th className="px-4 py-2.5 text-left">Produkter</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id} onClick={() => navigate(`/varer/oppskrifter/${r.id}`)} className="cursor-pointer border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.name || "Uten navn"}</span>
                        {shareCounts[r.id] > 0 && (
                          <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[11px] font-normal">
                            <Link2 className="h-3 w-3" />
                            {shareCounts[r.id]}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">v{r.version}</div>
                    </td>

                    <td className="px-4 py-2.5">{r.category ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtPercent(r.totals.hydrationPct)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtG(r.totals.totalDoughG)} g</td>
                    <td className="px-4 py-2.5">
                      {r.products.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <span className="text-xs">{r.products.slice(0, 2).join(", ")}{r.products.length > 2 ? ` +${r.products.length - 2}` : ""}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline">{RECIPE_STATUS_LABEL[r.status ?? "draft"] ?? r.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
