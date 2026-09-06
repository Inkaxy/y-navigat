import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ArrowUpDown, Columns3, Loader2, Package, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { QueryState } from "@/components/common/QueryState";
import { RavarerHeaderBanner, NewRawMaterialButton } from "@/ravarer/components/RavarerHeaderBanner";
import { NewRawMaterialDialog } from "@/ravarer/components/NewRawMaterialDialog";
import { CategorySelectItems } from "@/ravarer/components/CategorySelectItems";
import { VarelisteRow, type InlineField } from "@/ravarer/components/vareliste/VarelisteRow";
import { VarelisteBulkBar } from "@/ravarer/components/vareliste/VarelisteBulkBar";
import { SetPackageDialog } from "@/ravarer/components/packages/SetPackageDialog";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useVarelisteItems } from "@/ravarer/hooks/useVarelisteItems";
import { useUpdateRawMaterial } from "@/ravarer/hooks/useRawMaterials";
import { useAddPriceHistory } from "@/ravarer/hooks/useRmSuppliers";
import { usePackageWorklist } from "@/ravarer/hooks/usePackageSizes";
import { useBulkUpdateRawMaterials, type BulkPatch } from "@/ravarer/hooks/useBulkUpdateRawMaterials";
import { useUiPreference } from "@/hooks/useUiPreference";
import { todayOslo } from "@/lib/osloDate";
import { formatNok, formatNumber, formatDate } from "@/ravarer/lib/constants";
import { categoryOptions } from "@/ravarer/lib/categories";
import {
  BUILTIN_VIEWS,
  DEFAULT_DEVIATION_TOLERANCE,
  applyView,
  matchesSearch,
  normalizeSearch,
  sortItems,
  type ListSortKey,
  type RawMaterialListItem,
} from "@/ravarer/lib/rawMaterialViews";
import { LIST_COLUMNS, isColumnVisible } from "@/ravarer/lib/varelisteColumns";

interface SavedView {
  id: string;
  name: string;
  q: string;
  kat: string;
  type: string;
  status: string;
  sort: string;
}

const SORT_KEYS: ListSortKey[] = [
  "sku",
  "name",
  "category",
  "supplier",
  "cost",
  "agreed",
  "deviation",
  "package",
  "volume_12m",
  "last_invoice",
  "active",
];

function parseSort(value: string | null): { key: ListSortKey; dir: "asc" | "desc" } {
  const [rawKey, rawDir] = (value ?? "name:asc").split(":");
  const key = SORT_KEYS.includes(rawKey as ListSortKey) ? (rawKey as ListSortKey) : "name";
  return { key, dir: rawDir === "desc" ? "desc" : "asc" };
}

function csvCell(value: string): string {
  return /[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export default function VarelistePage() {
  const { canWrite } = useRavarer();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  const { items, suppliers, isLoading, isError, error, refetch } = useVarelisteItems();
  const updateMut = useUpdateRawMaterial();
  const addPrice = useAddPriceHistory();
  const bulkMut = useBulkUpdateRawMaterials();
  const { data: packageWorklist = [] } = usePackageWorklist();

  const [newOpen, setNewOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; field: InlineField } | null>(null);
  const [packageQueue, setPackageQueue] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const hiddenColumnsPref = useUiPreference<string[]>("ravarer:vareliste:columns", []);
  const savedViewsPref = useUiPreference<SavedView[]>("ravarer:vareliste:views", []);

  const q = params.get("q") ?? "";
  const kat = params.get("kat") ?? "all";
  const type = params.get("type") ?? "all";
  const status = params.get("status") ?? "active";
  const view = params.get("view") ?? "all";
  const sort = parseSort(params.get("sort"));

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === "" || v === "all") next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const existingCategories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => i.categories.forEach((c) => set.add(c)));
    return Array.from(set);
  }, [items]);

  const allCategoryOptions = useMemo(
    () => categoryOptions(existingCategories),
    [existingCategories],
  );

  const filtered = useMemo(() => {
    const needle = normalizeSearch(q);
    const base = items.filter((i) => {
      if (status === "active" && !i.isActive) return false;
      if (status === "inactive" && i.isActive) return false;
      if (type !== "all" && i.itemType !== type) return false;
      if (kat !== "all" && !i.categories.includes(kat)) return false;
      if (needle && !matchesSearch(i.searchText, q)) return false;
      return true;
    });

    const withAlias =
      needle.length === 0
        ? base
        : base.map((i) => {
            const inName = normalizeSearch(`${i.name} ${i.sku}`).includes(needle);
            if (inName) return i;
            const hit =
              [i.supplierSku, ...i.aliases].find(
                (v) => v && normalizeSearch(v).includes(needle),
              ) ?? null;
            return hit ? { ...i, matchedAlias: hit } : i;
          });

    return sortItems(applyView(withAlias, view, DEFAULT_DEVIATION_TOLERANCE), sort.key, sort.dir);
  }, [items, q, kat, type, status, view, sort.key, sort.dir]);

  const hiddenColumns = hiddenColumnsPref.value;
  const visibleColumns = useMemo(
    () => LIST_COLUMNS.filter((c) => isColumnVisible(c.id, hiddenColumns)),
    [hiddenColumns],
  );

  const toggleSort = useCallback(
    (key: ListSortKey) => {
      const dir = sort.key === key && sort.dir === "asc" ? "desc" : "asc";
      setParam({ sort: `${key}:${dir}` });
    },
    [setParam, sort.key, sort.dir],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allVisibleSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id));

  const commitPrice = useCallback(
    (item: RawMaterialListItem, field: "cost" | "agreed", value: number, reason: string) => {
      setEditing(null);
      if (field === "agreed") {
        if (value === item.agreedPrice) return;
        updateMut.mutate({ id: item.id, agreed_price: value });
        return;
      }
      if (value === item.costPrice) return;
      addPrice.mutate({
        raw_material_id: item.id,
        supplier_id: item.supplierId,
        price: value,
        effective_date: todayOslo(),
        source: "manual",
        notes: reason || null,
        set_as_current: true,
      });
    },
    [addPrice, updateMut],
  );

  const commitCategory = useCallback(
    (item: RawMaterialListItem, value: string) => {
      setEditing(null);
      if (item.categories[0] === value) return;
      const rest = item.categories.slice(1).filter((c) => c !== value);
      updateMut.mutate({ id: item.id, category: value, categories: [value, ...rest] });
    },
    [updateMut],
  );

  const applyBulk = useCallback(
    (patch: BulkPatch) => {
      bulkMut.mutate(
        { ids: Array.from(selected), patch },
        { onSuccess: () => setSelected(new Set()) },
      );
    },
    [bulkMut, selected],
  );

  const exportCsv = useCallback(() => {
    const rows = filtered.filter((i) => selected.has(i.id));
    const header = visibleColumns.map((c) => c.label);
    const lines = [header.join(";")];
    for (const i of rows) {
      const cells: string[] = [];
      for (const c of visibleColumns) {
        switch (c.id) {
          case "sku":
            cells.push(i.sku);
            break;
          case "name":
            cells.push(i.name);
            break;
          case "category":
            cells.push(i.categories.join(", "));
            break;
          case "supplier":
            cells.push(i.supplierName ?? "");
            break;
          case "cost":
            cells.push(formatNok(i.costPrice));
            break;
          case "agreed":
            cells.push(i.agreedPrice != null ? formatNok(i.agreedPrice) : "");
            break;
          case "deviation":
            cells.push(i.deviation != null ? formatNumber(i.deviation, 1) : "");
            break;
          case "package":
            cells.push(i.packageState);
            break;
          case "volume_12m":
            cells.push(formatNumber(i.volume12m, 0));
            break;
          case "last_invoice":
            cells.push(formatDate(i.lastInvoiceDate));
            break;
          case "status":
            cells.push(
              [
                i.declarationName ? "dekl" : "",
                i.hasDatasheet ? "datablad" : "",
                i.hasAllergens ? "allergen" : "",
                i.hasNutrition ? "næring" : "",
              ]
                .filter(Boolean)
                .join(" "),
            );
            break;
          case "active":
            cells.push(i.isActive ? "Aktiv" : "Inaktiv");
            break;
          default:
            cells.push("");
        }
      }
      lines.push(cells.map(csvCell).join(";"));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vareliste-${todayOslo()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${rows.length} rader eksportert`);
  }, [filtered, selected, visibleColumns]);

  const saveCurrentView = useCallback(() => {
    const name = window.prompt("Navn på visningen");
    if (!name?.trim()) return;
    const next: SavedView = {
      id: `${Date.now()}`,
      name: name.trim(),
      q,
      kat,
      type,
      status,
      sort: `${sort.key}:${sort.dir}`,
    };
    savedViewsPref.setValue([...savedViewsPref.value, next]);
    toast.success("Visning lagret");
  }, [q, kat, type, status, sort.key, sort.dir, savedViewsPref]);

  const applySavedView = useCallback(
    (v: SavedView) => {
      setParam({ q: v.q, kat: v.kat, type: v.type, status: v.status, sort: v.sort, view: "all" });
    },
    [setParam],
  );

  // Hurtigtaster: «/» søk, ↑/↓ markering, Enter åpner, «e» kostpris, «n» ny, Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Escape") {
        if (typing && document.activeElement === searchRef.current) {
          setParam({ q: null });
          return;
        }
        setEditing(null);
        return;
      }
      if (typing) return;

      if (e.key === "n") {
        if (canWrite) {
          e.preventDefault();
          setNewOpen(true);
        }
        return;
      }
      if (filtered.length === 0) return;
      const idx = filtered.findIndex((i) => i.id === focusedId);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedId(filtered[Math.min(idx + 1, filtered.length - 1)]?.id ?? filtered[0].id);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedId(filtered[Math.max(idx - 1, 0)]?.id ?? filtered[0].id);
      } else if (e.key === "Enter" && focusedId) {
        e.preventDefault();
        window.location.assign(`/ravarer/vareliste/${focusedId}`);
      } else if (e.key === "e" && focusedId && canWrite) {
        e.preventDefault();
        setEditing({ id: focusedId, field: "cost" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, focusedId, canWrite, setParam]);

  const packageRow = useMemo(
    () => packageWorklist.find((r) => r.id === packageQueue[0]) ?? null,
    [packageWorklist, packageQueue],
  );

  const filterControls = (
    <>
      <Select value={kat} onValueChange={(v) => setParam({ kat: v })}>
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Alle kategorier</SelectItem>
          <CategorySelectItems existing={existingCategories} />
        </SelectContent>
      </Select>
      <Select value={type} onValueChange={(v) => setParam({ type: v })}>
        <SelectTrigger className="w-[170px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Alle varetyper</SelectItem>
          <SelectItem value="ravare">Råvarer</SelectItem>
          <SelectItem value="emballasje">Emballasje</SelectItem>
          <SelectItem value="forbruksvare">Forbruksvarer</SelectItem>
          <SelectItem value="videresalg">Videresalg</SelectItem>
        </SelectContent>
      </Select>
      <Select value={status} onValueChange={(v) => setParam({ status: v })}>
        <SelectTrigger className="w-[150px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Aktive</SelectItem>
          <SelectItem value="inactive">Inaktive</SelectItem>
          <SelectItem value="all">Alle</SelectItem>
        </SelectContent>
      </Select>
    </>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-5">
        <RavarerHeaderBanner
          actions={canWrite && <NewRawMaterialButton onClick={() => setNewOpen(true)} />}
        />

        <Card className="sticky top-0 z-10 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={q}
                onChange={(e) => setParam({ q: e.target.value })}
                placeholder="Søk navn, SKU, leverandørnummer eller alias…"
                className="pl-9"
                aria-label="Søk i varelisten"
              />
            </div>

            <div className="hidden items-center gap-3 md:flex">{filterControls}</div>

            <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 md:hidden">
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filtre
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom">
                <SheetHeader>
                  <SheetTitle>Filtre</SheetTitle>
                </SheetHeader>
                <div className="mt-4 flex flex-col gap-3">{filterControls}</div>
              </SheetContent>
            </Sheet>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="hidden gap-1.5 md:inline-flex">
                  <Columns3 className="h-4 w-4" aria-hidden="true" /> Kolonner
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Vis kolonner</DropdownMenuLabel>
                {LIST_COLUMNS.filter((c) => !c.alwaysVisible).map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={!hiddenColumns.includes(c.id)}
                    onCheckedChange={(checked) =>
                      hiddenColumnsPref.setValue(
                        checked
                          ? hiddenColumns.filter((h) => h !== c.id)
                          : [...hiddenColumns, c.id],
                      )
                    }
                  >
                    {c.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <span className="text-sm text-muted-foreground">
              {filtered.length} av {items.length}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {BUILTIN_VIEWS.map((v) => (
              <Button
                key={v.id}
                size="sm"
                variant={view === v.id ? "default" : "outline"}
                className="h-7 rounded-full px-3 text-xs"
                onClick={() => setParam({ view: v.id })}
              >
                {v.label}
              </Button>
            ))}
            {savedViewsPref.value.map((v) => (
              <Button
                key={v.id}
                size="sm"
                variant="outline"
                className="h-7 rounded-full px-3 text-xs"
                onClick={() => applySavedView(v)}
                onDoubleClick={() =>
                  savedViewsPref.setValue(savedViewsPref.value.filter((x) => x.id !== v.id))
                }
                title="Klikk for å bruke, dobbeltklikk for å slette"
              >
                {v.name}
              </Button>
            ))}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={saveCurrentView}>
              Lagre visning
            </Button>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            Hurtigtaster: <kbd>/</kbd> søk · <kbd>↑</kbd>/<kbd>↓</kbd> velg rad · <kbd>Enter</kbd>{" "}
            åpne · <kbd>e</kbd> rediger kostpris · <kbd>n</kbd> ny vare · <kbd>Esc</kbd> tøm
          </p>
        </Card>

        <Card className="overflow-hidden">
          <QueryState
            isLoading={isLoading}
            isError={isError}
            error={error}
            onRetry={refetch}
            scope="ravarer:vareliste"
            isEmpty={!isLoading && !isError && filtered.length === 0}
            emptyTitle={items.length === 0 ? "Ingen varer ennå." : "Ingen treff."}
            emptyDescription={
              items.length === 0 ? undefined : "Juster søket eller filtrene for å se flere varer."
            }
            emptyIcon={Package}
            loadingFallback={
              <div className="flex items-center justify-center p-12 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Laster…
              </div>
            }
          >
            {/* Tabell fra md og opp */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="w-9 px-3 py-2">
                      <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={(checked) =>
                          setSelected(checked ? new Set(filtered.map((i) => i.id)) : new Set())
                        }
                        aria-label="Velg alle synlige"
                      />
                    </th>
                    {visibleColumns.map((c) => (
                      <th
                        key={c.id}
                        className={`px-3 py-2 font-medium ${c.numeric ? "text-right" : ""}`}
                      >
                        {c.sortKey ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:text-foreground"
                            onClick={() => toggleSort(c.sortKey as ListSortKey)}
                          >
                            {c.label}
                            <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                          </button>
                        ) : (
                          c.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <VarelisteRow
                      key={item.id}
                      item={item}
                      hiddenColumns={hiddenColumns}
                      categoryOptions={allCategoryOptions}
                      selected={selected.has(item.id)}
                      focused={focusedId === item.id}
                      canWrite={canWrite}
                      tolerance={DEFAULT_DEVIATION_TOLERANCE}
                      editing={editing?.id === item.id ? editing.field : null}
                      onToggleSelect={toggleSelect}
                      onStartEdit={(id, field) => setEditing({ id, field })}
                      onCancelEdit={() => setEditing(null)}
                      onCommitPrice={commitPrice}
                      onCommitCategory={commitCategory}
                      onFocusRow={setFocusedId}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Kortliste under md */}
            <ul className="divide-y divide-border md:hidden">
              {filtered.map((item) => (
                <li key={item.id} className="p-3">
                  <a href={`/ravarer/vareliste/${item.id}`} className="block">
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.supplierName ?? "Uten leverandør"} · {formatNok(item.costPrice)} /{" "}
                      {item.baseUnit}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.deviation != null &&
                        Math.abs(item.deviation) > DEFAULT_DEVIATION_TOLERANCE && (
                          <Badge variant="outline" className="border-destructive/40 text-destructive">
                            Avvik {formatNumber(item.deviation, 1)} %
                          </Badge>
                        )}
                      {!item.declarationName && <Badge variant="outline">Mangler deklarasjon</Badge>}
                      {!item.isActive && <Badge variant="outline">Inaktiv</Badge>}
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </QueryState>
        </Card>

        <VarelisteBulkBar
          count={selected.size}
          suppliers={suppliers}
          existingCategories={existingCategories}
          busy={bulkMut.isPending}
          onApply={applyBulk}
          onConfirmPackages={() => setPackageQueue(Array.from(selected))}
          onExport={exportCsv}
          onClear={() => setSelected(new Set())}
        />

        <NewRawMaterialDialog open={newOpen} onOpenChange={setNewOpen} />

        <SetPackageDialog
          key={packageQueue[0] ?? "none"}
          row={packageRow}
          open={packageQueue.length > 0 && !!packageRow}
          onOpenChange={(open) => {
            if (!open) {
              setPackageQueue((prev) => prev.slice(1));
              void qc.invalidateQueries({ queryKey: ["raw_material_package_worklist"] });
            }
          }}
        />
      </div>
    </TooltipProvider>
  );
}
