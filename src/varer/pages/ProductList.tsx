import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import { AppHeaderBanner, NewProductActionButton } from "@/varer/components/layout/AppHeaderBanner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LABELING_STATUS_LABEL, deriveLabelingStatusFromDb, type LabelingStatus } from "@/varer/lib/labelStaleness";
import type { ProductCalcReadinessRow } from "@/varer/lib/readinessChips";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { QuickCreateProductDialog } from "@/varer/components/products/QuickCreateProductDialog";
import { BulkImageUploadDialog } from "@/varer/components/products/BulkImageUploadDialog";
import { ColumnPicker, type ColumnOption } from "@/varer/components/products/ColumnPicker";
import { Button } from "@/components/ui/button";
import { Search, Loader2, Images, Pencil, Check, X, RefreshCw, Package } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PRODUCT_STATUS_LABEL, type ProductStatus, CAKE_ROLE_LABEL, type CakeRole } from "@/varer/lib/constants";
import { useAppContext } from "@/varer/context/AppContext";
import { useUiPreference } from "@/hooks/useUiPreference";
import { toast } from "sonner";
import { osloTodayISO } from "@/lib/osloDate";
import { QueryState } from "@/components/common/QueryState";
import {
  parseProductListParams, writeProductListParams,
  type ProductStatusFilter, type ProductVariantFilter,
} from "@/varer/lib/listUrlState";
import { detailHref } from "@/varer/lib/listReturn";
import { filterProducts } from "@/varer/lib/productListFilter";
import { useListUrlState, useReturnFocus } from "@/varer/hooks/useListUrlState";
import { ListResultSummary, type ActiveFilter } from "@/varer/components/lists/ActiveFilterChips";
import {
  buildProductColumns, BULK_EDITABLE,
  type BulkEditableField, type CostCacheRow, type ProductRow, type RowCtx,
} from "@/varer/components/products/list/productListColumns";
import { ProductListCard } from "@/varer/components/products/list/ProductListCard";

export type { ProductRow } from "@/varer/components/products/list/productListColumns";

/** Merkestatus for produktlista — basert på databasens `recipe_label_calculated.is_stale`. */
export function productLabelingStatus(
  p: ProductRow,
  labelRow: { computed_at: string | null; is_stale: boolean } | undefined,
): LabelingStatus {
  if (!p.manual_ingredient_declaration) return "missing";
  if (p.declaration_needs_review) return "stale";
  // En godkjent versjon er et eksplisitt snapshot. Det gjelder også manuelle
  // deklarasjoner og skal ikke nedgraderes av en eldre beregningsrad.
  if (p.declaration_version_id) return "approved";
  if (!labelRow) return p.declaration_needs_review ? "stale" : "approved";
  return deriveLabelingStatusFromDb({
    // Ingen eget godkjenningstidspunkt på produktet ennå — deklarasjonen regnes
    // som godkjent på beregningstidspunktet, med mindre basen selv sier utdatert.
    approvedAt: labelRow.computed_at,
    computedAt: labelRow.computed_at,
    isStale: labelRow.is_stale,
    blocked: !!p.declaration_needs_review,
  });
}

const COLUMN_PREF_SCOPE = "varer.product_list.columns.v1";
const PRICE_LIST_PREF_KEY = "varer.product_list.price_list.v1";
const DEFAULT_VISIBLE = ["variant_of", "main_category", "sub_category", "unit", "price", "in_web_shop", "in_pos"];
const VARIANT_LABEL: Record<ProductVariantFilter, string> = { all: "Alle", parents: "Kun mor-varer", variants: "Kun varianter" };

export default function ProductList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canWrite, legalEntityId } = useAppContext();
  const { state, update, search } = useListUrlState(parseProductListParams, writeProductListParams);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [bulkImagesOpen, setBulkImagesOpen] = useState(false);
  const [editingCol, setEditingCol] = useState<BulkEditableField | null>(null);
  const [pendingEdits, setPendingEdits] = useState<Record<string, boolean>>({});

  const productsQuery = useQuery({
    queryKey: ["products", legalEntityId],
    queryFn: async () => {
      // Databasetypen gir `status` og `cake_role` som frie tekster; vi smalner dem etter henting.
      type DbProductRow = Omit<ProductRow, "status" | "cake_role"> & { status: string; cake_role: string | null };
      const rows = await fetchAllRows<DbProductRow>((from, to) =>
        supabase
          .from("products")
          .select(
            "id, display_number, code, display_name, product_category, product_subcategory, unit_of_sale, status, variant_of_product_id, variant_label, label_mode, is_cake_component, cake_role, image_url, mva_rate, pieces_per_tray, in_web_shop, in_pos, manual_ingredient_declaration, declaration_needs_review, declaration_version_id, calc_type, manual_cost_price, main_category:product_main_categories(code, display_name), sub_category:product_sub_categories(code, display_name)",
          )
          .eq("legal_entity_id", legalEntityId!)
          .order("display_number", { ascending: true })
          .range(from, to),
      );
      const isStatus = (v: string): v is ProductStatus => v in PRODUCT_STATUS_LABEL;
      const isCakeRole = (v: string): v is CakeRole => v in CAKE_ROLE_LABEL;
      return rows.map<ProductRow>((r) => ({
        ...r,
        status: isStatus(r.status) ? r.status : "draft",
        cake_role: r.cake_role && isCakeRole(r.cake_role) ? r.cake_role : null,
      }));
    },
  });

  const all = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const parentMap = useMemo(() => new Map(all.map((p) => [p.id, p])), [all]);
  const categories = useMemo(() => Array.from(new Set(all.map((p) => p.product_category).filter(Boolean))).sort(), [all]);

  /** Prislista priskolonnen viser — huskes lokalt per bruker. */
  const priceListsQuery = useQuery({
    queryKey: ["product-list-price-lists", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_lists")
        .select("id, display_name, code, is_default, status")
        .eq("legal_entity_id", legalEntityId!)
        .order("display_name");
      if (error) throw error;
      return (data ?? []).filter((l) => l.status !== "archived");
    },
  });

  const [priceListId, setPriceListId] = useState<string | null>(() => localStorage.getItem(PRICE_LIST_PREF_KEY));

  useEffect(() => {
    const lists = priceListsQuery.data;
    if (!lists || lists.length === 0) return;
    if (priceListId && lists.some((l) => l.id === priceListId)) return;
    const preferred = lists.find((l) => l.code === "utsalg_base") ?? lists.find((l) => l.is_default) ?? lists[0];
    setPriceListId(preferred.id);
  }, [priceListsQuery.data, priceListId]);

  useEffect(() => {
    if (priceListId) localStorage.setItem(PRICE_LIST_PREF_KEY, priceListId);
  }, [priceListId]);

  const priceItems = useQuery({
    queryKey: ["pricelist-items", priceListId],
    enabled: !!priceListId,
    queryFn: async () =>
      fetchAllRows<{ product_id: string; price: number; valid_from: string; valid_to: string | null }>((from, to) =>
        supabase.from("price_list_items").select("product_id, price, valid_from, valid_to").eq("price_list_id", priceListId!).range(from, to),
      ),
  });

  /** Kalkylekvalitet leses fra kostbufferen i databasen. */
  const costCacheQuery = useQuery({
    queryKey: ["product-cost-cache", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () =>
      fetchAllRows<CostCacheRow>((from, to) =>
        supabase.from("product_cost_cache").select("product_id, cost_per_unit, has_cost, quality, is_stale").range(from, to),
      ),
  });
  const costCacheMap = useMemo(() => new Map((costCacheQuery.data ?? []).map((r) => [r.product_id, r])), [costCacheQuery.data]);

  /** Kalkylestatus A/B/C og manglende felt — leses fra viewet `product_calc_readiness`. */
  const readinessQuery = useQuery({
    queryKey: ["product-calc-readiness", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () =>
      fetchAllRows<{ product_id: string | null; recipe_id: string | null; status: string | null; mangler: string[] | null }>((from, to) =>
        supabase.from("product_calc_readiness").select("product_id, recipe_id, status, mangler").eq("legal_entity_id", legalEntityId!).range(from, to),
      ),
  });
  const readinessMap = useMemo(() => {
    const m = new Map<string, ProductCalcReadinessRow & { recipe_id: string | null }>();
    (readinessQuery.data ?? []).forEach((r) => {
      if (r.product_id) m.set(r.product_id, { status: r.status, mangler: r.mangler, recipe_id: r.recipe_id });
    });
    return m;
  }, [readinessQuery.data]);

  /** Merkingsstatus per oppskrift — hentes for alle koblede oppskrifter under ett. */
  const recipeIdsForLabeling = useMemo(
    () => Array.from(new Set((readinessQuery.data ?? []).map((r) => r.recipe_id).filter((id): id is string => !!id))),
    [readinessQuery.data],
  );
  const labelCalcQuery = useQuery({
    queryKey: ["recipe-label-calculated-list", recipeIdsForLabeling],
    enabled: recipeIdsForLabeling.length > 0,
    queryFn: async () =>
      fetchAllRows<{ recipe_id: string; computed_at: string | null; is_stale: boolean }>((from, to) =>
        supabase.from("recipe_label_calculated").select("recipe_id, computed_at, is_stale").in("recipe_id", recipeIdsForLabeling).range(from, to),
      ),
  });
  const labelCalcMap = useMemo(() => new Map((labelCalcQuery.data ?? []).map((r) => [r.recipe_id, r])), [labelCalcQuery.data]);
  const labelingOf = useMemo(
    () => (p: ProductRow) => productLabelingStatus(p, labelCalcMap.get(readinessMap.get(p.id)?.recipe_id ?? "")),
    [labelCalcMap, readinessMap],
  );

  const filtered = useMemo(() => filterProducts(all, state, labelingOf), [all, state, labelingOf]);

  /** «Beregn nå» — kjører batch-jobben på kostbufferen og oppsummerer på norsk. */
  const [recalculating, setRecalculating] = useState(false);
  async function recalcCostCache() {
    setRecalculating(true);
    try {
      const { data, error } = await supabase.rpc("refresh_product_cost_cache", { p_limit: 50 });
      if (error) throw error;
      const r = (data ?? {}) as { computed?: number; errors?: number; alerts?: number; remaining_stale?: number; ms?: number };
      toast.success(
        `Beregnet ${r.computed ?? 0} varer på ${r.ms ?? 0} ms` +
          (r.errors ? ` — ${r.errors} feilet` : "") +
          (r.alerts ? `, ${r.alerts} varsler` : "") +
          (r.remaining_stale ? `. ${r.remaining_stale} venter fortsatt` : ""),
      );
      qc.invalidateQueries({ queryKey: ["product-cost-cache", legalEntityId] });
      qc.invalidateQueries({ queryKey: ["product-calc-readiness", legalEntityId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke beregne kostbufferen");
    } finally {
      setRecalculating(false);
    }
  }

  const today = osloTodayISO();
  const priceMap = useMemo(() => {
    const m = new Map<string, number>();
    (priceItems.data ?? []).forEach((it) => {
      if (it.valid_from > today) return;
      if (it.valid_to && it.valid_to < today) return;
      m.set(it.product_id, Number(it.price));
    });
    return m;
  }, [priceItems.data, today]);

  // ---- Bulk-redigering ----
  const cancelEdit = () => {
    setEditingCol(null);
    setPendingEdits({});
  };
  const toggleCell = (id: string, current: boolean) => {
    setPendingEdits((prev) => {
      const next = { ...prev };
      const newVal = !(prev[id] ?? current);
      if (newVal === current) delete next[id];
      else next[id] = newVal;
      return next;
    });
  };
  const pendingCount = Object.keys(pendingEdits).length;

  const bulkSave = useMutation({
    mutationFn: async () => {
      if (!editingCol) return;
      const entries = Object.entries(pendingEdits);
      // Gruppér per ny verdi → maks to update-kall (true / false)
      for (const value of [true, false]) {
        const ids = entries.filter(([, v]) => v === value).map(([id]) => id);
        if (ids.length === 0) continue;
        const patch = editingCol === "in_web_shop" ? { in_web_shop: value } : { in_pos: value };
        const { error } = await supabase.from("products").update(patch).in("id", ids);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(`Lagret ${pendingCount} endring${pendingCount === 1 ? "" : "er"}`);
      cancelEdit();
      qc.invalidateQueries({ queryKey: ["products", legalEntityId] });
    },
    onError: () => toast.error("Kunne ikke lagre endringene. Prøv igjen."),
  });

  function renderBoolCell(p: ProductRow, field: BulkEditableField) {
    const isEditing = editingCol === field;
    const val = isEditing && p.id in pendingEdits ? pendingEdits[p.id] : !!p[field];
    if (isEditing) {
      return (
        <div onClick={(e) => { e.stopPropagation(); toggleCell(p.id, !!p[field]); }} className="flex items-center justify-center">
          <Checkbox checked={val} className={p.id in pendingEdits ? "ring-2 ring-app ring-offset-1" : ""} aria-label={`${p.display_name}: ${field === "in_pos" ? "I kasse" : "I nettbutikken"}`} />
        </div>
      );
    }
    return val ? <Check className="mx-auto h-4 w-4 text-success" aria-label="Ja" /> : <span className="text-muted-foreground">—</span>;
  }

  const hrefFor = (id: string) => detailHref("products", id, search);
  const columns = buildProductColumns({ hrefFor, renderBoolCell });
  const { value: pref, setValue: setPref } = useUiPreference<{ visible: string[] }>(COLUMN_PREF_SCOPE, { visible: DEFAULT_VISIBLE });
  const visibleSet = new Set(pref.visible ?? DEFAULT_VISIBLE);
  const visibleCols = columns.filter((c) => c.fixed || visibleSet.has(c.key));
  const pickerOptions: ColumnOption[] = columns.map((c) => ({ key: c.key, label: c.label, fixed: c.fixed }));
  const ctxFor = (p: ProductRow): RowCtx => ({
    parent: p.variant_of_product_id ? parentMap.get(p.variant_of_product_id) ?? null : null,
    price: priceMap.get(p.id),
    costCache: costCacheMap.get(p.id),
    readiness: readinessMap.get(p.id),
    labeling: labelingOf(p),
  });

  useReturnFocus(!productsQuery.isLoading && !productsQuery.isError);

  function onRowClick(e: MouseEvent, id: string) {
    if (editingCol) return; // ikke navigér i redigeringsmodus
    if (e.target instanceof Element && e.target.closest("a, button, input, [role='checkbox']")) return;
    if (e.metaKey || e.ctrlKey) {
      window.open(hrefFor(id), "_blank", "noopener");
      return;
    }
    navigate(hrefFor(id));
  }

  const activeFilters: ActiveFilter[] = [
    state.q.trim() && { key: "q", label: `Søk: «${state.q.trim()}»`, onRemove: () => update({ q: "" }) },
    state.category !== "all" && { key: "kategori", label: `Kategori: ${state.category}`, onRemove: () => update({ category: "all" }) },
    state.labeling !== "all" && { key: "merking", label: `Merking: ${LABELING_STATUS_LABEL[state.labeling].toLowerCase()}`, onRemove: () => update({ labeling: "all" }) },
    state.status !== "all" && { key: "status", label: `Status: ${PRODUCT_STATUS_LABEL[state.status]}`, onRemove: () => update({ status: "all" }) },
    state.variant !== "all" && { key: "variant", label: VARIANT_LABEL[state.variant], onRemove: () => update({ variant: "all" }) },
  ].filter((f): f is ActiveFilter => !!f);
  const resetFilters = () => update({ q: "", category: "all", labeling: "all", status: "all", variant: "all" });

  const isError = productsQuery.isError || readinessQuery.isError || labelCalcQuery.isError;
  const retry = () => {
    for (const q of [productsQuery, readinessQuery, labelCalcQuery, costCacheQuery, priceItems]) if (q.isError) void q.refetch();
  };

  return (
    <>
      <AppHeaderBanner actions={canWrite && <NewProductActionButton onClick={() => setWizardOpen(true)} />} />

      <div className="px-4 py-6 sm:px-6">
        <Card className="overflow-hidden">
          {editingCol && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app/30 bg-app/10 px-4 py-2.5">
              <div className="text-sm">
                <span className="font-medium">Redigerer kolonne:</span>{" "}
                <span className="font-semibold text-app">{columns.find((c) => c.key === editingCol)?.label}</span>
                <span className="ml-3 text-muted-foreground">
                  {pendingCount === 0 ? "Ingen endringer ennå" : `${pendingCount} endring${pendingCount === 1 ? "" : "er"} venter`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={bulkSave.isPending}>
                  <X className="mr-1 h-4 w-4" /> Avbryt
                </Button>
                <Button size="sm" onClick={() => bulkSave.mutate()} disabled={pendingCount === 0 || bulkSave.isPending}>
                  {bulkSave.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
                  Ferdig med endringer
                </Button>
              </div>
            </div>
          )}

          <section aria-label="Søk og filtre" className="space-y-3 border-b border-border bg-muted/30 px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="min-w-0 flex-1 sm:min-w-[220px] sm:max-w-md">
                <Label htmlFor="product-search" className="text-caption text-muted-foreground">Søk</Label>
                <div className="relative mt-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input id="product-search" type="search" placeholder="Navn, kode, nr, 1791-1800 eller 12, 15" value={state.q} onChange={(e) => update({ q: e.target.value })} className="pl-8" />
                </div>
              </div>
              <LabeledSelect id="product-category" label="Kategori" value={state.category} onChange={(v) => update({ category: v })}>
                <SelectItem value="all">Alle kategorier</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                {state.category !== "all" && !categories.includes(state.category) && <SelectItem value={state.category}>{state.category}</SelectItem>}
              </LabeledSelect>
              <LabeledSelect id="product-labeling" label="Merking" value={state.labeling} onChange={(v) => update({ labeling: v as "all" | LabelingStatus })}>
                <SelectItem value="all">All merking</SelectItem>
                <SelectItem value="approved">Godkjent</SelectItem>
                <SelectItem value="stale">Utdatert</SelectItem>
                <SelectItem value="missing">Mangler</SelectItem>
              </LabeledSelect>
              <LabeledSelect id="product-status" label="Status" value={state.status} onChange={(v) => update({ status: v as ProductStatusFilter })}>
                <SelectItem value="all">Alle</SelectItem>
                <SelectItem value="active">Aktiv</SelectItem>
                <SelectItem value="paused">På pause</SelectItem>
                <SelectItem value="discontinued">Utgått</SelectItem>
                <SelectItem value="draft">Utkast</SelectItem>
              </LabeledSelect>
              <LabeledSelect id="product-variant" label="Varianter" value={state.variant} onChange={(v) => update({ variant: v as ProductVariantFilter })}>
                {(Object.keys(VARIANT_LABEL) as ProductVariantFilter[]).map((k) => <SelectItem key={k} value={k}>{VARIANT_LABEL[k]}</SelectItem>)}
              </LabeledSelect>
              <LabeledSelect id="product-pricelist" label="Prisliste for priskolonnen" value={priceListId ?? ""} onChange={setPriceListId} disabled={(priceListsQuery.data ?? []).length === 0}>
                {(priceListsQuery.data ?? []).map((l) => <SelectItem key={l.id} value={l.id}>{l.display_name}</SelectItem>)}
              </LabeledSelect>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <ListResultSummary count={filtered.length} noun={["vare", "varer"]} isLoading={productsQuery.isLoading} isError={isError} filters={activeFilters} onReset={resetFilters} />
              <div className="flex flex-wrap items-center gap-2">
                <div className="hidden lg:block">
                  <ColumnPicker columns={pickerOptions} visible={pref.visible ?? DEFAULT_VISIBLE} onChange={(next) => setPref({ visible: next })} onReset={() => setPref({ visible: DEFAULT_VISIBLE })} />
                </div>
                {canWrite && (
                  <Button variant="outline" size="sm" onClick={() => setBulkImagesOpen(true)} className="gap-1.5">
                    <Images className="h-4 w-4" /> Massimport bilder
                  </Button>
                )}
                {canWrite && (
                  <Button variant="outline" size="sm" onClick={recalcCostCache} disabled={recalculating} className="gap-1.5">
                    {recalculating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Beregn nå
                  </Button>
                )}
              </div>
            </div>
          </section>

          <QueryState
            scope="varer:vareliste"
            isLoading={productsQuery.isLoading}
            isError={isError}
            error={productsQuery.error ?? readinessQuery.error ?? labelCalcQuery.error}
            onRetry={retry}
            isEmpty={filtered.length === 0}
            emptyIcon={Package}
            emptyTitle={all.length === 0 ? "Ingen varer ennå" : "Ingen varer passer filtrene."}
            emptyDescription={all.length === 0 && canWrite ? "Trykk «Ny vare» øverst for å komme i gang." : undefined}
            emptyAction={activeFilters.length > 0 ? <Button variant="outline" size="sm" onClick={resetFilters}>Nullstill filtre</Button> : undefined}
            skeletonRows={8}
            className="m-4"
          >
            <div className={editingCol ? "overflow-x-auto" : "hidden overflow-x-auto lg:block"}>
              <table className="w-full text-sm">
                <caption className="sr-only">Varer</caption>
                <thead className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {visibleCols.map((c) => {
                      const editable = BULK_EDITABLE[c.key];
                      return (
                        <th key={c.key} className={`whitespace-nowrap px-4 py-2.5 text-left font-medium ${c.headerClassName ?? ""}`}>
                          <span className="inline-flex items-center gap-1.5">
                            {c.label}
                            {editable && canWrite && editingCol !== editable && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => { setEditingCol(editable); setPendingEdits({}); }}
                                    className="rounded p-0.5 text-muted-foreground hover:bg-app/10 hover:text-app"
                                    aria-label={`Rediger ${c.label} for alle rader`}
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Rediger kolonne for alle rader</TooltipContent>
                              </Tooltip>
                            )}
                            {editable && editingCol === editable && (
                              <span className="rounded bg-app/20 px-1.5 py-0.5 text-[10px] font-semibold text-app">REDIGERER</span>
                            )}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const ctx = ctxFor(p);
                    return (
                      <tr key={p.id} onClick={(e) => onRowClick(e, p.id)} className={`border-t border-border ${editingCol ? "" : "cursor-pointer hover:bg-muted/30"}`}>
                        {visibleCols.map((c) => (
                          <td key={c.key} className={`px-4 py-2.5 ${c.cellClassName ?? ""}`}>{c.render(p, ctx)}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!editingCol && (
              <div className="divide-y divide-border lg:hidden">
                {filtered.map((p) => <ProductListCard key={p.id} product={p} ctx={ctxFor(p)} href={hrefFor(p.id)} />)}
              </div>
            )}
          </QueryState>
        </Card>
      </div>

      <QuickCreateProductDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        productOptions={all.map((p) => ({ id: p.id, display_name: p.display_name, display_number: p.display_number, code: p.code }))}
      />

      <BulkImageUploadDialog
        open={bulkImagesOpen}
        onOpenChange={setBulkImagesOpen}
        products={all.map((p) => ({ id: p.id, display_name: p.display_name, display_number: p.display_number, code: p.code, image_url: p.image_url }))}
        onComplete={() => productsQuery.refetch()}
      />
    </>
  );
}

function LabeledSelect({
  id, label, value, onChange, disabled, children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-caption text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="mt-1 w-full sm:w-44"><SelectValue /></SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}
