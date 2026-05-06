import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeaderBanner } from "@/varer/components/layout/AppHeaderBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, AlertTriangle, Wrench, ArrowRight } from "lucide-react";
import { NB_LEGAL_ENTITY_ID } from "@/varer/lib/constants";

export default function RecipesCleanup() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["recipes-cleanup", NB_LEGAL_ENTITY_ID],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, version, yield_quantity, yield_unit, requires_cleanup, products!inner(id, display_name, code, product_category, legal_entity_id), recipe_lines(id, raw_material_id, ingredient_name)")
        .eq("products.legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("requires_cleanup", true)
        .is("valid_to", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: any) => {
        const total = (r.recipe_lines ?? []).length;
        const unmatched = (r.recipe_lines ?? []).filter((l: any) => !l.raw_material_id).length;
        return { ...r, _total: total, _unmatched: unmatched };
      });
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return query.data ?? [];
    return (query.data ?? []).filter((r: any) =>
      `${r.products?.display_name} ${r.products?.code}`.toLowerCase().includes(q),
    );
  }, [query.data, search]);

  const totalRecipes = query.data?.length ?? 0;
  const totalUnmatchedLines = (query.data ?? []).reduce((s: number, r: any) => s + r._unmatched, 0);
  const recipesAllUnlinked = (query.data ?? []).filter((r: any) => r._total > 0 && r._unmatched === r._total).length;

  return (
    <>
      <AppHeaderBanner title="Oppskrifter som krever opprydding" subtitle="Linjer uten råvare-kobling må fikses for å låse opp deklarasjon og kalkulasjon." />
      <div className="px-6 py-6 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard label="Oppskrifter med ukoblede linjer" value={totalRecipes} icon={<AlertTriangle className="h-4 w-4 text-warning" />} />
          <KpiCard label="Ukoblede linjer totalt" value={totalUnmatchedLines} icon={<Wrench className="h-4 w-4 text-warning" />} />
          <KpiCard label="Helt uten koblinger" value={recipesAllUnlinked} icon={<AlertTriangle className="h-4 w-4 text-destructive" />} />
        </div>

        <div className="flex items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Søk i produktnavn eller kode…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
        </div>

        <Card className="overflow-hidden">
          {query.isLoading ? (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Wrench className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Ingen oppskrifter krever opprydding. 🎉</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left">Vare</th>
                  <th className="px-4 py-2.5 text-left">Kategori</th>
                  <th className="px-4 py-2.5 text-left">Linjer</th>
                  <th className="px-4 py-2.5 text-left">Ukoblede</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r: any) => (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{r.products?.display_name}</div>
                      <div className="text-xs font-mono text-muted-foreground">{r.products?.code}</div>
                    </td>
                    <td className="px-4 py-2.5">{r.products?.product_category ?? "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums">{r._total}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="text-warning border-warning/40 bg-warning/10">
                        {r._unmatched} av {r._total}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="outline" onClick={() => navigate(`/varer/vareliste/${r.products.id}?tab=oppskrift`)}>
                        Rydd opp <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Button>
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

function KpiCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          {icon} {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
