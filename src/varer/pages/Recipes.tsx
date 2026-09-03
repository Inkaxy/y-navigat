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
import { Search, Loader2, ChefHat, Plus, Link2, Copy, MoreHorizontal, Wheat, ArrowUp, ArrowDown, ChevronsUpDown, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { copyRecipe } from "@/varer/lib/copyRecipe";

import {
  computeTotals, fmtG, fmtPercent, RECIPE_STATUS_LABEL, type BakersLine, type BakersRawMaterial,
} from "@/varer/lib/bakers";
import { BASE_RECIPE_CATEGORY } from "@/varer/lib/halvfabrikat";
import {
  asDepartment, RECIPE_DEPARTMENT_BADGE, RECIPE_DEPARTMENT_LABEL, type RecipeDepartment,
} from "@/varer/lib/departments";

/** Valgene i segmentkontrollen for avdeling. */
const DEPARTMENT_FILTERS: { value: "all" | RecipeDepartment | "none"; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "bakeri", label: "Bakeri" },
  { value: "konditori", label: "Konditori" },
  { value: "none", label: "Uten avdeling" },
];

/** Rå rad fra listespørringen — modulen bruker ikke de genererte Supabase-typene. */
type RecipeLineRow = BakersLine & { id: string; raw_material_id: string | null };
type RecipeListRow = {
  id: string;
  name: string | null;
  image_url: string | null;
  category: string | null;
  status: string | null;
  department: string | null;
  version: number | null;
  unit_weight_grams: number | null;
  units_per_batch: number | null;
  product_id: string | null;
  recipe_lines: RecipeLineRow[] | null;
  product_recipe_links: { product_id: string; products: { display_name: string | null } | null }[] | null;
};
type RecipeRow = RecipeListRow & {
  totals: ReturnType<typeof computeTotals>;
  products: string[];
};

/** Kolonner som kan sorteres i oppskriftslisten. */
type SortKey = "name" | "category" | "department" | "hydration" | "dough" | "products" | "status";

export default function Recipes() {
  const { legalEntityId, canWrite } = useAppContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<"all" | RecipeDepartment | "none">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });

  /** Klikk på kolonne: samme kolonne snur retning, ny kolonne starter stigende. */
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const [creating, setCreating] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  /** Slett oppskrift etter at brukeren har skrevet «slett». */
  async function handleDelete() {
    if (!deleting || deleteConfirm.trim().toLowerCase() !== "slett") return;
    setDeleteBusy(true);
    try {
      const { error } = await supabase.from("recipes").delete().eq("id", deleting.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["recipes-list"] });
      toast.success("Oppskriften er slettet");
      setDeleting(null);
      setDeleteConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke slette oppskriften");
    } finally {
      setDeleteBusy(false);
    }
  }

  /** Kopier oppskrift fra radmenyen og åpne kopien i navneredigering. */
  async function handleCopy(id: string) {
    setCopyingId(id);
    try {
      const newId = await copyRecipe(id);
      qc.invalidateQueries({ queryKey: ["recipes-list"] });
      toast.success("Kopi opprettet");
      navigate(`/varer/oppskrifter/${newId}?rename=1`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke kopiere oppskriften");
    } finally {
      setCopyingId(null);
    }
  }


  const rmQuery = useQuery({
    queryKey: ["rm-bakers-map", legalEntityId],
    queryFn: async () => {
      const { data } = await supabase
        .from("raw_materials")
        .select("id, name, category, grain_classification, water_content_pct, current_cost_price")
        .limit(2000);
      const map: Record<string, BakersRawMaterial> = {};
      for (const r of (data ?? []) as unknown as BakersRawMaterial[]) map[r.id] = r;
      return map;
    },
  });

  const recipesQuery = useQuery({
    queryKey: ["recipes-list", legalEntityId],
    queryFn: async () => {
      const { data } = await supabase
        .from("recipes")
        .select("id, name, image_url, category, status, department, version, unit_weight_grams, units_per_batch, product_id, recipe_lines(id, quantity, unit, raw_material_id, is_flour_override, water_content_pct_override, ingredient_name), product_recipe_links(product_id, products(display_name))")
        .is("valid_to", null)
        .order("created_at", { ascending: false });
      return (data ?? []) as unknown as RecipeListRow[];
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
      for (const r of (data ?? []) as { recipe_id: string; expires_at: string | null }[]) {
        if (r.expires_at && new Date(r.expires_at).getTime() < now) continue;
        counts[r.recipe_id] = (counts[r.recipe_id] ?? 0) + 1;
      }
      return counts;
    },
  });

  const rmMap = rmQuery.data ?? {};
  const shareCounts = shareCountsQuery.data ?? {};


  const rows = useMemo<RecipeRow[]>(() => {
    const q = search.trim().toLowerCase();
    return (recipesQuery.data ?? [])
      .map((r): RecipeRow => {
        const lines = (r.recipe_lines ?? []).map((l) => ({
          ...l,
          _rm: l.raw_material_id ? rmMap[l.raw_material_id] ?? null : null,
        }));
        const totals = computeTotals(lines, r.unit_weight_grams);
        const products = (r.product_recipe_links ?? [])
          .map((l) => l.products?.display_name)
          .filter((n): n is string => !!n);
        return { ...r, totals, products };
      })
      .filter((r) => (statusFilter === "all" ? true : (r.status ?? "draft") === statusFilter))
      .filter((r) => {
        if (deptFilter === "all") return true;
        const d = asDepartment(r.department);
        return deptFilter === "none" ? d === null : d === deptFilter;
      })
      .filter((r) =>
        !q ? true : `${r.name ?? ""} ${r.category ?? ""} ${r.products.join(" ")}`.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const dir = sort.dir === "asc" ? 1 : -1;
        const txt = (v: string | null | undefined) => (v ?? "").toLowerCase();
        const num = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? null : v);
        const cmpNum = (x: number | null, y: number | null) =>
          x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : (x - y) * dir;
        switch (sort.key) {
          case "category":
            return txt(a.category).localeCompare(txt(b.category), "nb") * dir;
          case "department":
            return txt(asDepartment(a.department) ?? "").localeCompare(txt(asDepartment(b.department) ?? ""), "nb") * dir;
          case "hydration":
            return cmpNum(num(a.totals.hydrationPct), num(b.totals.hydrationPct));
          case "dough":
            return cmpNum(num(a.totals.totalDoughG), num(b.totals.totalDoughG));
          case "products":
            return (a.products.length - b.products.length) * dir;
          case "status":
            return txt(a.status ?? "draft").localeCompare(txt(b.status ?? "draft"), "nb") * dir;
          default:
            return txt(a.name).localeCompare(txt(b.name), "nb") * dir;
        }
      });
  }, [recipesQuery.data, rmMap, search, statusFilter, deptFilter, sort]);

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

        <div className="mb-3 inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
          {DEPARTMENT_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setDeptFilter(f.value)}
              aria-pressed={deptFilter === f.value}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                deptFilter === f.value
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
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
                  <SortableTh label="Oppskrift" sortKey="name" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Kategori" sortKey="category" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Avdeling" sortKey="department" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Hydrering" sortKey="hydration" sort={sort} onSort={toggleSort} align="right" />
                  <SortableTh label="Deigvekt" sortKey="dough" sort={sort} onSort={toggleSort} align="right" />
                  <SortableTh label="Produkter" sortKey="products" sort={sort} onSort={toggleSort} />
                  <SortableTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                  <th className="w-10 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/varer/oppskrifter/${r.id}`)}
                    /* Zebra: annenhver rad får svak grå bakgrunn for lesbarhet */
                    className={`cursor-pointer border-t border-border hover:bg-muted/40 ${i % 2 === 1 ? "bg-muted/20" : ""}`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {r.image_url && (
                          <img
                            src={r.image_url}
                            alt={r.name || "Oppskrift"}
                            className="h-8 w-8 shrink-0 rounded object-cover"
                            loading="lazy"
                          />
                        )}
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

                    <td className="px-4 py-2.5">
                      {r.category === BASE_RECIPE_CATEGORY ? (
                        <Badge variant="outline" className="gap-1 border-app/50 text-app">
                          <Wheat className="h-3.5 w-3.5" /> Grunnoppskrift
                        </Badge>
                      ) : (
                        r.category ?? "—"
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {(() => {
                        const d = asDepartment(r.department);
                        return d ? (
                          <Badge variant="outline" className={`font-normal ${RECIPE_DEPARTMENT_BADGE[d]}`}>
                            {RECIPE_DEPARTMENT_LABEL[d]}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        );
                      })()}
                    </td>
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
                    <td className="px-2 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      {canWrite && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Handlinger">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem disabled={copyingId === r.id} onSelect={() => void handleCopy(r.id)}>
                              {copyingId === r.id ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Copy className="mr-2 h-4 w-4" />
                              )}
                              Lag kopi
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => {
                                setDeleteConfirm("");
                                setDeleting({ id: r.id, name: r.name?.trim() || "Uten navn" });
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Slett
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

          )}
        </Card>
      </div>

      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o && !deleteBusy) {
            setDeleting(null);
            setDeleteConfirm("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slett «{deleting?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Oppskriften og linjene slettes permanent. Dette kan ikke angres. Skriv «slett» for å bekrefte.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-confirm">Bekreftelse</Label>
            <Input
              id="delete-confirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="slett"
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleting(null);
                setDeleteConfirm("");
              }}
              disabled={deleteBusy}
            >
              Avbryt
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleteBusy || deleteConfirm.trim().toLowerCase() !== "slett"}
            >
              {deleteBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Slett
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Klikkbar kolonneoverskrift med sorteringsindikator. */
function SortableTh({
  label, sortKey, sort, onSort, align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={`px-4 py-2.5 ${align === "right" ? "text-right" : "text-left"}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase transition-colors hover:text-foreground ${active ? "text-foreground" : ""} ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? "" : "opacity-40"}`} />
      </button>
    </th>
  );
}
