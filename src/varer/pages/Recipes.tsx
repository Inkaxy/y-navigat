import { useMemo, useState } from "react";
import { useAppContext } from "@/varer/context/AppContext";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeaderBanner } from "@/varer/components/layout/AppHeaderBanner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Loader2, ChefHat } from "lucide-react";


export default function Recipes() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const recipesQuery = useQuery({
    queryKey: ["recipes-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("recipes")
        .select("id, version, valid_from, valid_to, yield_quantity, yield_unit, products!inner(id, display_name, code, product_category, legal_entity_id)")
        .eq("products.legal_entity_id", legalEntityId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipesQuery.data ?? [];
    return (recipesQuery.data ?? []).filter((r: any) =>
      `${r.products?.display_name} ${r.products?.code}`.toLowerCase().includes(q),
    );
  }, [recipesQuery.data, search]);

  return (
    <>
      <AppHeaderBanner title="Oppskrifter" subtitle="Aktive oppskrifter for varekatalogen" />
      <div className="px-6 py-6">
        <div className="mb-3 flex items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Søk i produktnavn eller kode…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
        </div>
        <Card className="overflow-hidden">
          {recipesQuery.isLoading ? (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <ChefHat className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Ingen oppskrifter ennå.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left">Vare</th>
                  <th className="px-4 py-2.5 text-left">Kategori</th>
                  <th className="px-4 py-2.5 text-left">Versjon</th>
                  <th className="px-4 py-2.5 text-left">Utbytte</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r: any) => (
                  <tr key={r.id} onClick={() => navigate(`/varer/vareliste/${r.products.id}?tab=recipe`)} className="cursor-pointer border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{r.products?.display_name}</div>
                      <div className="text-xs font-mono text-muted-foreground">{r.products?.code}</div>
                    </td>
                    <td className="px-4 py-2.5">{r.products?.product_category}</td>
                    <td className="px-4 py-2.5">v{r.version}</td>
                    <td className="px-4 py-2.5">{r.yield_quantity} {r.yield_unit}</td>
                    <td className="px-4 py-2.5">
                      <span className={r.valid_to ? "text-muted-foreground" : "text-success"}>
                        {r.valid_to ? "Utgått" : "Aktiv"}
                      </span>
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
