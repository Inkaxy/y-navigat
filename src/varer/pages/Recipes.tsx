import { useEffect, useMemo, useState } from "react";
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
import { Search, Loader2, ChefHat, Plus, Link2, Copy, MoreHorizontal, Wheat, ArrowUp, ArrowDown, ChevronsUpDown, Trash2, ChevronLeft, ChevronRight, FileStack } from "lucide-react";
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
import { fetchAllRows } from "@/lib/supabasePaging";
import { deriveLabelingStatus, LABELING_STATUS_LABEL, type LabelingStatus } from "@/varer/lib/labelStaleness";
import { format } from "date-fns";
import { nb } from "date-fns/locale";

import {
  computeTotalsForRecipe, fmtG, fmtPercent, RECIPE_STATUS_LABEL, type BakersLine, type BakersRawMaterial,
} from "@/varer/lib/bakers";
import { BASE_RECIPE_CATEGORY } from "@/varer/lib/halvfabrikat";
import {
  asDepartment, RECIPE_DEPARTMENT_BADGE, RECIPE_DEPARTMENT_LABEL, type RecipeDepartment,
} from "@/varer/lib/departments";
import { RecipeListCard } from "@/varer/components/recipes/RecipeListCard";

/** Kategoriverdi som markerer en oppskrift som mal for «Ny fra mal». */
export const RECIPE_TEMPLATE_CATEGORY = "Mal";

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
  updated_at: string | null;
  unit_weight_grams: number | null;
  units_per_batch: number | null;
  dough_piece_grams: number | null;
  dough_waste_pct: number | null;
  product_id: string | null;
  recipe_lines: RecipeLineRow[] | null;
  product_recipe_links: { product_id: string; products: { display_name: string | null } | null }[] | null;
};
type RecipeRow = RecipeListRow & {
  totals: ReturnType<typeof computeTotalsForRecipe>;
  products: string[];
  labeling: LabelingStatus;
};

/** Kolonner som kan sorteres i oppskriftslisten. */
type SortKey = "name" | "category" | "department" | "hydration" | "dough" | "products" | "status" | "labeling" | "updated";

export default function Recipes() {
  const { legalEntityId, canWrite } = useAppContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<"all" | RecipeDepartment | "none">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [labelingFilter, setLabelingFilter] = useState<"all" | LabelingStatus>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const [page, setPage] = useState(1);
  const [creatingFromTemplate, setCreatingFromTemplate] = useState(false);
  const PAGE_SIZE = 50;

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
    enabled: !!legalEntityId,
    queryFn: async () => {
      const data = await fetchAllRows<BakersRawMaterial>((from, to) =>
        supabase
          .from("raw_materials")
          .select("id, name, category, grain_classification, water_content_pct, unit_weight_grams, current_cost_price")
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
    queryFn: async () => {
      const data = await fetchAllRows<RecipeListRow>((from, to) =>
        supabase
          .from("recipes")
          .select("id, name, image_url, category, status, department, version, updated_at, unit_weight_grams, units_per_batch, dough_piece_grams, dough_waste_pct, product_id, recipe_lines(id, quantity, unit, raw_material_id, is_flour_override, water_content_pct_override, ingredient_name), product_recipe_links(product_id, products(display_name))")
          .is("valid_to", null)
          .order("created_at", { ascending: false })
          .range(from, to) as unknown as PromiseLike<{ data: RecipeListRow[] | null; error: { message: string } | null }>,
      );
      return data;
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

  /** Merkestatus pr oppskrift: godkjenning vs. siste beregning og siste endring. */
  const labelingQuery = useQuery({
    queryKey: ["recipes-labeling-status", legalEntityId],
    queryFn: async () => {
      const [calcRes, recRes] = await Promise.all([
        supabase.from("recipe_label_calculated").select("recipe_id, computed_at"),
        supabase.from("recipes").select("id, updated_at, declaration_updated_at").is("valid_to", null),
      ]);
      if (calcRes.error) throw calcRes.error;
      if (recRes.error) throw recRes.error;
      const computedBy = new Map<string, string | null>();
      for (const c of calcRes.data ?? []) computedBy.set(c.recipe_id, c.computed_at);
      const out: Record<string, LabelingStatus> = {};
      for (const r of recRes.data ?? []) {
        out[r.id] = deriveLabelingStatus({
          approvedAt: r.declaration_updated_at,
          computedAt: computedBy.get(r.id) ?? null,
          sources: [{ name: "Oppskriften", updatedAt: r.updated_at }],
        });
      }
      return out;
    },
  });

  const rmMap = rmQuery.data ?? {};
  const shareCounts = shareCountsQuery.data ?? {};
  const labelingMap = useMemo(() => labelingQuery.data ?? {}, [labelingQuery.data]);


  const rows = useMemo<RecipeRow[]>(() => {
    const q = search.trim().toLowerCase();
    return (recipesQuery.data ?? [])
      .map((r): RecipeRow => {
        const lines = (r.recipe_lines ?? []).map((l) => ({
          ...l,
          _rm: l.raw_material_id ? rmMap[l.raw_material_id] ?? null : null,
        }));
        const totals = computeTotalsForRecipe(lines, r);
        const products = (r.product_recipe_links ?? [])
          .map((l) => l.products?.display_name)
          .filter((n): n is string => !!n);
        return { ...r, totals, products, labeling: labelingMap[r.id] ?? "missing" };
      })
      .filter((r) => (statusFilter === "all" ? true : (r.status ?? "draft") === statusFilter))
      .filter((r) => (labelingFilter === "all" ? true : r.labeling === labelingFilter))
      .filter((r) => {
        if (deptFilter === "all") return true;
        const d = asDepartment(r.department);
        return deptFilter === "none" ? d === null : d === deptFilter;
      })
      .filter((r) => {
        if (categoryFilter === "all") return true;
        if (categoryFilter === "none") return !r.category;
        return r.category === categoryFilter;
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
          case "labeling":
            return txt(a.labeling).localeCompare(txt(b.labeling), "nb") * dir;
          case "status":
            return txt(a.status ?? "draft").localeCompare(txt(b.status ?? "draft"), "nb") * dir;
          case "updated":
            return (
              (a.updated_at ? new Date(a.updated_at).getTime() : 0) -
              (b.updated_at ? new Date(b.updated_at).getTime() : 0)
            ) * dir;
          default:
            return txt(a.name).localeCompare(txt(b.name), "nb") * dir;
        }
      });
  }, [recipesQuery.data, rmMap, labelingMap, search, statusFilter, labelingFilter, deptFilter, categoryFilter, sort]);

  /** Distinkte kategorier som faktisk finnes i dataene, sortert på norsk. */
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of recipesQuery.data ?? []) {
      if (r.category) set.add(r.category);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "nb"));
  }, [recipesQuery.data]);

  /** Oppskrifter markert som mal (kategori === RECIPE_TEMPLATE_CATEGORY). */
  const templates = useMemo(
    () => (recipesQuery.data ?? []).filter((r) => r.category === RECIPE_TEMPLATE_CATEGORY),
    [recipesQuery.data],
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pagedRows = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page],
  );

  /** Nullstill sidetall når søk/filtre/sortering endres. */
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, labelingFilter, deptFilter, categoryFilter, sort]);

  /** Tøm alle filtre. */
  function resetFilters() {
    setSearch("");
    setStatusFilter("all");
    setDeptFilter("all");
    setCategoryFilter("all");
    setLabelingFilter("all");
  }

  /** Opprett en ny oppskrift fra en mal via kopiering, og gi den et beskrivende navn. */
  async function createFromTemplate(templateId: string, templateName: string) {
    setCreatingFromTemplate(true);
    try {
      const newId = await copyRecipe(templateId);
      const { error } = await supabase
        .from("recipes")
        .update({ name: `Ny fra ${templateName}` } as never)
        .eq("id", newId);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["recipes-list"] });
      toast.success("Ny oppskrift opprettet fra mal");
      navigate(`/varer/oppskrifter/${newId}?rename=1`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke opprette fra mal");
    } finally {
      setCreatingFromTemplate(false);
    }
  }

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
          <select
            value={labelingFilter}
            onChange={(e) => setLabelingFilter(e.target.value as "all" | LabelingStatus)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Filtrer på merking"
          >
            <option value="all">All merking</option>
            <option value="approved">Merking: godkjent</option>
            <option value="stale">Merking: utdatert</option>
            <option value="missing">Merking: mangler</option>
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">Alle kategorier</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
            <option value="none">Uten kategori</option>
          </select>
          <div className="flex-1" />
          {canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  disabled={templates.length === 0 || creatingFromTemplate}
                  title={templates.length === 0 ? "Ingen maler ennå" : undefined}
                >
                  {creatingFromTemplate ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileStack className="mr-2 h-4 w-4" />}
                  Ny fra mal
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {templates.map((t) => (
                  <DropdownMenuItem key={t.id} onSelect={() => void createFromTemplate(t.id, t.name?.trim() || "Uten navn")}>
                    {t.name?.trim() || "Uten navn"}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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

        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? "oppskrift" : "oppskrifter"}
          </p>
        </div>

        <Card className="overflow-hidden">
          {recipesQuery.isLoading ? (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 && (recipesQuery.data ?? []).length > 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <ChefHat className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Ingen oppskrifter passer filtrene.</p>
              <Button variant="outline" size="sm" onClick={resetFilters}>Nullstill filtre</Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <ChefHat className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Ingen oppskrifter ennå.</p>
            </div>
          ) : (
            <>
              <table className="hidden w-full text-sm sm:table">
                <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr>
                    <SortableTh label="Oppskrift" sortKey="name" sort={sort} onSort={toggleSort} />
                    <SortableTh label="Kategori" sortKey="category" sort={sort} onSort={toggleSort} />
                    <SortableTh label="Avdeling" sortKey="department" sort={sort} onSort={toggleSort} />
                    <SortableTh label="Hydrering" sortKey="hydration" sort={sort} onSort={toggleSort} align="right" />
                    <SortableTh label="Deigvekt" sortKey="dough" sort={sort} onSort={toggleSort} align="right" />
                    <SortableTh label="Produkter" sortKey="products" sort={sort} onSort={toggleSort} />
                    <SortableTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                    <SortableTh label="Merking" sortKey="labeling" sort={sort} onSort={toggleSort} />
                    <SortableTh label="Oppdatert" sortKey="updated" sort={sort} onSort={toggleSort} />
                    <th className="w-10 px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((r, i) => (
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
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {r.updated_at ? format(new Date(r.updated_at), "EEE d. MMM yyyy, HH:mm", { locale: nb }) : "—"}
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

              <div className="divide-y divide-border sm:hidden">
                {pagedRows.map((r) => (
                  <RecipeListCard
                    key={r.id}
                    recipe={r}
                    shareCount={shareCounts[r.id] ?? 0}
                    canWrite={canWrite}
                    copyingId={copyingId}
                    onOpen={() => navigate(`/varer/oppskrifter/${r.id}`)}
                    onCopy={() => void handleCopy(r.id)}
                    onDelete={() => {
                      setDeleteConfirm("");
                      setDeleting({ id: r.id, name: r.name?.trim() || "Uten navn" });
                    }}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" /> Forrige
                </Button>
                <span className="text-sm text-muted-foreground">Side {page} av {totalPages}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Neste <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </>
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
