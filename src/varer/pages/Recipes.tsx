import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChefHat, ChevronLeft, ChevronRight, FileStack, Loader2, Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAppContext } from "@/varer/context/AppContext";
import { AppHeaderBanner } from "@/varer/components/layout/AppHeaderBanner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { QueryState } from "@/components/common/QueryState";
import { copyRecipe } from "@/varer/lib/copyRecipe";
import { LABELING_STATUS_LABEL, type LabelingStatus } from "@/varer/lib/labelStaleness";
import { RECIPE_STATUS_LABEL } from "@/varer/lib/bakers";
import {
  parseRecipeListParams, writeRecipeListParams, RECIPE_LIST_DEFAULTS,
  type RecipeDeptFilter, type RecipeSortKey, type RecipeStatusFilter,
} from "@/varer/lib/listUrlState";
import { detailHref } from "@/varer/lib/listReturn";
import { filterAndSortRecipes } from "@/varer/lib/recipeListFilter";
import { useListUrlState, useReturnFocus } from "@/varer/hooks/useListUrlState";
import { useRecipeListData } from "@/varer/hooks/useRecipeListData";
import { RecipeListCard } from "@/varer/components/recipes/RecipeListCard";
import { RecipeListTable } from "@/varer/components/recipes/list/RecipeListTable";
import { DeleteRecipeDialog } from "@/varer/components/recipes/list/DeleteRecipeDialog";
import { ListResultSummary, type ActiveFilter } from "@/varer/components/lists/ActiveFilterChips";

/** Valgene i segmentkontrollen for avdeling. */
const DEPARTMENT_FILTERS: { value: RecipeDeptFilter; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "bakeri", label: "Bakeri" },
  { value: "konditori", label: "Konditori" },
  { value: "none", label: "Uten avdeling" },
];

const PAGE_SIZE = 50;
const SELECT_CLS = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-auto";

export default function Recipes() {
  const { legalEntityId, canWrite } = useAppContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { state, update, search } = useListUrlState(parseRecipeListParams, writeRecipeListParams);
  const data = useRecipeListData(legalEntityId);
  const [creating, setCreating] = useState(false);
  const [creatingFromTemplate, setCreatingFromTemplate] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  const rows = useMemo(() => filterAndSortRecipes(data.rows, state), [data.rows, state]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(state.page, totalPages);
  const pagedRows = useMemo(() => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [rows, page]);
  const hrefFor = (id: string) => detailHref("recipes", id, search);

  useReturnFocus(!data.isLoading && !data.isError);

  /** Klikk på kolonne: samme kolonne snur retning, ny kolonne starter stigende. */
  const toggleSort = (key: RecipeSortKey) =>
    update({ sort: key, dir: state.sort === key && state.dir === "asc" ? "desc" : "asc" });

  const activeFilters: ActiveFilter[] = [
    state.q.trim() && { key: "q", label: `Søk: «${state.q.trim()}»`, onRemove: () => update({ q: "" }) },
    state.status !== "all" && { key: "status", label: `Status: ${RECIPE_STATUS_LABEL[state.status] ?? state.status}`, onRemove: () => update({ status: "all" }) },
    state.labeling !== "all" && { key: "merking", label: `Merking: ${LABELING_STATUS_LABEL[state.labeling].toLowerCase()}`, onRemove: () => update({ labeling: "all" }) },
    state.dept !== "all" && { key: "avdeling", label: DEPARTMENT_FILTERS.find((f) => f.value === state.dept)?.label ?? state.dept, onRemove: () => update({ dept: "all" }) },
    state.category !== "all" && { key: "kategori", label: state.category === "none" ? "Uten kategori" : `Kategori: ${state.category}`, onRemove: () => update({ category: "all" }) },
  ].filter((f): f is ActiveFilter => !!f);

  const resetFilters = () =>
    update({ q: "", status: "all", labeling: "all", dept: "all", category: RECIPE_LIST_DEFAULTS.category });

  /** Kopier oppskrift fra radmenyen og åpne kopien i navneredigering. */
  async function handleCopy(id: string) {
    setCopyingId(id);
    try {
      const newId = await copyRecipe(id);
      qc.invalidateQueries({ queryKey: ["recipes-list"] });
      toast.success("Kopi opprettet");
      navigate(`${hrefFor(newId)}${hrefFor(newId).includes("?") ? "&" : "?"}rename=1`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke kopiere oppskriften");
    } finally {
      setCopyingId(null);
    }
  }

  /** Opprett en ny oppskrift fra en mal via kopiering, og gi den et beskrivende navn. */
  async function createFromTemplate(templateId: string, templateName: string) {
    setCreatingFromTemplate(true);
    try {
      const newId = await copyRecipe(templateId);
      // Kopien skal være en vanlig, redigerbar oppskrift, ikke selv en mal.
      const { error } = await supabase
        .from("recipes")
        .update({ name: `Ny fra ${templateName}`, is_template: false } as never)
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
    const { data: created, error } = await supabase
      .from("recipes")
      .insert({ name: "Ny oppskrift", status: "draft", legal_entity_id: legalEntityId, yield_quantity: 1, yield_unit: "stk" } as never)
      .select("id")
      .single();
    if (error) {
      setCreating(false);
      toast.error(error.message);
      return;
    }
    await supabase.from("recipe_parts").insert({ recipe_id: created.id, name: "Hoveddeig", sort_order: 0, part_type: "dough" } as never);
    setCreating(false);
    qc.invalidateQueries({ queryKey: ["recipes-list"] });
    navigate(`/varer/oppskrifter/${created.id}`);
  }

  const headerActions = canWrite && (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={data.templates.length === 0 || creatingFromTemplate} title={data.templates.length === 0 ? "Ingen maler ennå" : undefined}>
            {creatingFromTemplate ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileStack className="mr-1.5 h-4 w-4" />}
            Ny fra mal
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {data.templates.map((t) => (
            <DropdownMenuItem key={t.id} onSelect={() => void createFromTemplate(t.id, t.name?.trim() || "Uten navn")}>
              {t.name?.trim() || "Uten navn"}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" className="rounded-full" onClick={createRecipe} disabled={creating}>
        {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
        Ny oppskrift
      </Button>
    </div>
  );

  return (
    <>
      <AppHeaderBanner title="Oppskrifter" subtitle="Bakerfaglige oppskrifter med bakerprosent og prosess" actions={headerActions} />
      <div className="space-y-4 px-4 py-6 sm:px-6">
        {data.staleCount > 0 && state.labeling !== "stale" && (
          <button
            type="button"
            onClick={() => update({ labeling: "stale" })}
            className="flex w-full items-center gap-3 rounded-lg border border-warning/50 bg-warning/10 px-4 py-3 text-left transition-colors hover:bg-warning/15 sm:w-auto"
          >
            <span className="text-lg font-semibold tabular-nums">{data.staleCount}</span>
            <span className="text-sm">
              {data.staleCount === 1 ? "deklarasjon er utdatert" : "deklarasjoner er utdaterte"} — vis dem
            </span>
          </button>
        )}

        <section aria-label="Søk og filtre" className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="min-w-0 flex-1 sm:max-w-sm">
              <Label htmlFor="recipe-search" className="text-caption text-muted-foreground">Søk</Label>
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input id="recipe-search" type="search" placeholder="Navn, kategori eller produkt" value={state.q} onChange={(e) => update({ q: e.target.value })} className="pl-8" />
              </div>
            </div>
            <FilterSelect id="recipe-status" label="Status" value={state.status} onChange={(v) => update({ status: v as RecipeStatusFilter })}>
              <option value="all">Alle statuser</option>
              <option value="draft">Utkast</option>
              <option value="active">Aktiv</option>
              <option value="archived">Arkivert</option>
            </FilterSelect>
            <FilterSelect id="recipe-labeling" label="Merking" value={state.labeling} onChange={(v) => update({ labeling: v as "all" | LabelingStatus })}>
              <option value="all">All merking</option>
              <option value="approved">Godkjent</option>
              <option value="stale">Utdatert</option>
              <option value="missing">Mangler</option>
            </FilterSelect>
            <FilterSelect id="recipe-category" label="Kategori" value={state.category} onChange={(v) => update({ category: v })}>
              <option value="all">Alle kategorier</option>
              {data.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              {state.category !== "all" && state.category !== "none" && !data.categories.includes(state.category) && (
                <option value={state.category}>{state.category}</option>
              )}
              <option value="none">Uten kategori</option>
            </FilterSelect>
          </div>
          <div role="group" aria-label="Avdeling" className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-muted/30 p-0.5">
            {DEPARTMENT_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => update({ dept: f.value })}
                aria-pressed={state.dept === f.value}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
                  state.dept === f.value ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <ListResultSummary
            count={rows.length}
            noun={["oppskrift", "oppskrifter"]}
            isLoading={data.isLoading}
            isError={data.isError}
            filters={activeFilters}
            onReset={resetFilters}
          />
        </section>

        <Card className="overflow-hidden">
          <QueryState
            scope="varer:oppskriftsliste"
            isLoading={data.isLoading}
            isError={data.isError}
            error={data.error}
            onRetry={data.refetch}
            isEmpty={rows.length === 0}
            emptyIcon={ChefHat}
            emptyTitle={data.rows.length > 0 ? "Ingen oppskrifter passer filtrene." : "Ingen oppskrifter ennå."}
            emptyAction={activeFilters.length > 0 ? <Button variant="outline" size="sm" onClick={resetFilters}>Nullstill filtre</Button> : undefined}
            skeletonRows={6}
            className="m-4"
          >
            <div className="hidden lg:block">
              <RecipeListTable
                rows={pagedRows}
                sort={{ key: state.sort, dir: state.dir }}
                onSort={toggleSort}
                hrefFor={hrefFor}
                shareCounts={data.shareCounts}
                canWrite={canWrite}
                copyingId={copyingId}
                onCopy={(id) => void handleCopy(id)}
                onDelete={(id, name) => setDeleting({ id, name })}
              />
            </div>
            <div className="lg:hidden">
              <MobileSort sort={state.sort} dir={state.dir} onChange={(sort, dir) => update({ sort, dir })} />
              <div className="divide-y divide-border">
                {pagedRows.map((r) => (
                  <RecipeListCard
                    key={r.id}
                    recipe={r}
                    href={hrefFor(r.id)}
                    shareCount={data.shareCounts[r.id] ?? 0}
                    canWrite={canWrite}
                    copyingId={copyingId}
                    onCopy={() => void handleCopy(r.id)}
                    onDelete={() => setDeleting({ id: r.id, name: r.name?.trim() || "Uten navn" })}
                  />
                ))}
              </div>
            </div>

            <nav aria-label="Sidevalg" className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
              <Button variant="outline" size="sm" onClick={() => update({ page: Math.max(1, page - 1) })} disabled={page <= 1}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Forrige
              </Button>
              <span className="text-sm text-muted-foreground">Side {page} av {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => update({ page: Math.min(totalPages, page + 1) })} disabled={page >= totalPages}>
                Neste <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </nav>
          </QueryState>
        </Card>
      </div>

      <DeleteRecipeDialog target={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

function FilterSelect({
  id, label, value, onChange, children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-caption text-muted-foreground">{label}</Label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={`mt-1 ${SELECT_CLS}`}>
        {children}
      </select>
    </div>
  );
}

const SORT_LABEL: Record<RecipeSortKey, string> = {
  name: "Navn", category: "Kategori", department: "Avdeling", hydration: "Hydrering", dough: "Deigvekt",
  products: "Antall produkter", status: "Status", labeling: "Merking", updated: "Oppdatert",
};

/** Sortering på smal skjerm, der tabelloverskriftene ikke vises. */
function MobileSort({
  sort, dir, onChange,
}: {
  sort: RecipeSortKey;
  dir: "asc" | "desc";
  onChange: (sort: RecipeSortKey, dir: "asc" | "desc") => void;
}) {
  return (
    <div className="flex items-end gap-2 border-b border-border px-4 py-3">
      <div className="flex-1">
        <Label htmlFor="recipe-sort" className="text-caption text-muted-foreground">Sorter etter</Label>
        <select id="recipe-sort" value={sort} onChange={(e) => onChange(e.target.value as RecipeSortKey, dir)} className={`mt-1 ${SELECT_CLS}`}>
          {(Object.keys(SORT_LABEL) as RecipeSortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
        </select>
      </div>
      <Button variant="outline" size="sm" className="h-10" onClick={() => onChange(sort, dir === "asc" ? "desc" : "asc")}>
        {dir === "asc" ? "Stigende" : "Synkende"}
      </Button>
    </div>
  );
}
