import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";

import { logAudit } from "@/varer/lib/audit";
import { useAppContext } from "@/varer/context/AppContext";
import { AppHeaderBanner } from "@/varer/components/layout/AppHeaderBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Calendar as CalendarIcon,
  ChevronDown,
  Download,
  LayoutGrid,
  Layers,
  List,
  Loader2,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { toCsv, downloadCsv } from "@/varer/lib/pricing";
import { MatrixView, type ProductRow, type PriceListLite } from "@/varer/components/prices/MatrixView";
import { BatchAdjustDialog } from "@/varer/components/prices/BatchAdjustDialog";
import { OfferPriceListsDialog } from "@/varer/components/prices/OfferPriceListsDialog";
import { ImportPricesDialog } from "@/varer/components/prices/ImportPricesDialog";
import { ReturView } from "@/varer/components/prices/ReturView";
import { osloTodayISO, osloDateISO } from "@/lib/osloDate";

type ViewMode = "simple" | "matrix" | "retur";

const TODAY = () => osloTodayISO();
const SHOW_MVA_KEY = "varer_show_mva";

function formatNb(date: string): string {
  // YYYY-MM-DD → DD.MM.YYYY
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return date;
  return `${d}.${m}.${y}`;
}

export default function PriceLists() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canWrite, legalEntityId } = useAppContext();
  const [searchParams, setSearchParams] = useSearchParams();

  const view: ViewMode =
    searchParams.get("view") === "simple"
      ? "simple"
      : searchParams.get("view") === "retur"
      ? "retur"
      : "matrix";
  const highlight = searchParams.get("highlight");
  const priceDateParam = searchParams.get("pricedate");

  const [priceDate, setPriceDate] = useState<string>(priceDateParam || TODAY());
  const [search, setSearch] = useState("");
  const [includeNotForSale, setIncludeNotForSale] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [offerListsOpen, setOfferListsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);

  // Pending celle-endringer (ikke lagret enda). cellekey -> ny pris.
  const [pendingEdits, setPendingEdits] = useState<Map<string, number>>(new Map());
  const [savingBatch, setSavingBatch] = useState(false);

  // Resett pending edits hvis prisdato endres (forskjellig kontekst)
  useEffect(() => {
    setPendingEdits(new Map());
  }, [priceDate]);

  function handleCellChange(productId: string, priceListId: string, value: number | null) {
    const key = `${productId}::${priceListId}`;
    setPendingEdits((prev) => {
      const next = new Map(prev);
      if (value == null) next.delete(key);
      else next.set(key, value);
      return next;
    });
  }

  async function saveAllPending() {
    if (pendingEdits.size === 0) return;
    setSavingBatch(true);
    let ok = 0;
    let failed = 0;
    try {
      // priceDate - 1 dag (for å lukke forrige periode)
      const prevDate = (() => {
        const d = new Date(priceDate + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - 1);
        return osloDateISO(d);
      })();
      for (const [key, newPrice] of pendingEdits.entries()) {
        const [productId, priceListId] = key.split("::");
        const productName = productNames[productId] ?? productId;
        // Finn aktiv rad på priceDate (kan ha valid_from < priceDate)
        const { data: activeRows, error: selErr } = await supabase
          .from("price_list_items")
          .select("id, price, valid_from, valid_to")
          .eq("price_list_id", priceListId)
          .eq("product_id", productId)
          .lte("valid_from", priceDate)
          .or(`valid_to.is.null,valid_to.gte.${priceDate}`)
          .order("valid_from", { ascending: false })
          .limit(1);
        if (selErr) {
          toast.error(`${productName}: ${selErr.message}`);
          failed++;
          continue;
        }
        const existing = activeRows?.[0] ?? null;
        if (existing && existing.valid_from === priceDate) {
          const { error } = await supabase
            .from("price_list_items")
            .update({ price: newPrice })
            .eq("id", existing.id);
          if (error) {
            toast.error(`${productName}: ${error.message}`);
            failed++;
            continue;
          }
          await logAudit({
            action: "update",
            entity_type: "price_list_item",
            entity_id: existing.id,
            entity_display_reference: productName,
            changes: { price: newPrice, valid_from: priceDate },
          });
        } else {
          // Lukk forrige periode hvis den finnes (valid_from < priceDate)
          if (existing && existing.valid_from < priceDate) {
            const { error: closeErr } = await supabase
              .from("price_list_items")
              .update({ valid_to: prevDate })
              .eq("id", existing.id);
            if (closeErr) {
              toast.error(`${productName}: ${closeErr.message}`);
              failed++;
              continue;
            }
          }
          const { data, error } = await supabase
            .from("price_list_items")
            .insert({
              price_list_id: priceListId,
              product_id: productId,
              price: newPrice,
              valid_from: priceDate,
            })
            .select("id")
            .single();
          if (error) {
            toast.error(`${productName}: ${error.message}`);
            failed++;
            continue;
          }
          await logAudit({
            action: "create",
            entity_type: "price_list_item",
            entity_id: data.id,
            entity_display_reference: productName,
            changes: { price: newPrice, valid_from: priceDate },
          });
        }
        ok++;
      }
      if (ok > 0) {
        toast.success(`${ok} pris${ok === 1 ? "" : "er"} lagret${failed > 0 ? ` (${failed} feilet)` : ""}`);
        setPendingEdits(new Map());
        qc.invalidateQueries({ queryKey: ["matrix-prices"] });
      } else if (failed > 0) {
        toast.error(`Ingen lagret — ${failed} feil`);
      }
    } finally {
      setSavingBatch(false);
    }
  }

  function discardPending() {
    setPendingEdits(new Map());
    toast.info("Endringer forkastet");
  }

  // MVA-toggle persistert i localStorage
  const [showInclMva, setShowInclMva] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SHOW_MVA_KEY) === "true";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SHOW_MVA_KEY, String(showInclMva));
  }, [showInclMva]);

  // Synk priceDate ↔ URL
  useEffect(() => {
    const sp = new URLSearchParams(searchParams);
    if (priceDate === TODAY()) sp.delete("pricedate");
    else sp.set("pricedate", priceDate);
    setSearchParams(sp, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceDate]);

  function setView(v: ViewMode) {
    const sp = new URLSearchParams(searchParams);
    if (v === "matrix") sp.delete("view");
    else sp.set("view", v);
    setSearchParams(sp, { replace: true });
  }

  /* ----- Prislister ----- */
  const listsQuery = useQuery({
    queryKey: ["price-lists-full", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_lists")
        .select(
          "id, code, display_name, is_default, prices_include_mva, status, list_number, price_list_type, updated_at",
        )
        .eq("legal_entity_id", legalEntityId!)
        .order("list_number", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const activeLists: PriceListLite[] = useMemo(
    () =>
      (listsQuery.data ?? [])
        .filter((p) => p.status === "active")
        .map((p) => ({
          id: p.id,
          code: p.code,
          display_name: p.display_name,
          is_default: p.is_default,
          list_number: p.list_number,
          price_list_type: (p.price_list_type as "base" | "offer") ?? "offer",
          prices_include_mva: p.prices_include_mva,
        })),
    [listsQuery.data],
  );

  /* ----- Varer + kategori-koder ----- */
  const productsQuery = useQuery({
    queryKey: ["matrix-products", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, display_number, display_name, unit_of_sale, is_for_sale, mva_rate, main_category_id, sub_category_id, status",
        )
        .eq("legal_entity_id", legalEntityId!)
        .neq("status", "discontinued")
        .order("display_number");
      if (error) throw error;
      return data ?? [];
    },
  });

  const mainCatsQuery = useQuery({
    queryKey: ["main-cats", legalEntityId],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_main_categories")
        .select("id, code, display_name")
        .eq("legal_entity_id", legalEntityId!);
      return data ?? [];
    },
  });

  const subCatsQuery = useQuery({
    queryKey: ["sub-cats", legalEntityId],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_sub_categories")
        .select("id, code, display_name, main_category_id")
        .eq("legal_entity_id", legalEntityId!);
      return data ?? [];
    },
  });

  /* ----- Priser for matrix-visning (kun gyldig på priceDate) ----- */
  const pricesQuery = useQuery({
    queryKey: ["matrix-prices", legalEntityId, priceDate],
    enabled: view === "matrix",
    queryFn: async () => {
      const all = await fetchAllRows<{ price_list_id: string; product_id: string; price: number; valid_from: string; valid_to: string | null }>(
        (from, to) =>
          supabase
            .from("price_list_items")
            .select("price_list_id, product_id, price, valid_from, valid_to")
            .lte("valid_from", priceDate)
            .range(from, to),
      );
      const filtered = all.filter(
        (it) => it.valid_to == null || it.valid_to >= priceDate,
      );
      const map = new Map<string, { price: number; valid_from: string }>();
      for (const it of filtered) {
        const key = `${it.product_id}::${it.price_list_id}`;
        const cur = map.get(key);
        if (!cur || it.valid_from > cur.valid_from) {
          map.set(key, { price: Number(it.price), valid_from: it.valid_from });
        }
      }
      const priceMap = new Map<string, number>();
      for (const [k, v] of map) priceMap.set(k, v.price);
      return priceMap;
    },
  });

  /* ----- Aggregater for enkel-visning ----- */
  const itemsAggQuery = useQuery({
    queryKey: ["price-list-items-agg", legalEntityId],
    enabled: view === "simple",
    queryFn: async () => {
      const all = await fetchAllRows<{ price_list_id: string; product_id: string; updated_at: string }>(
        (from, to) =>
          supabase
            .from("price_list_items")
            .select("price_list_id, product_id, updated_at")
            .range(from, to),
      );
      const counts = new Map<string, Set<string>>();
      const updated = new Map<string, string>();
      for (const it of all) {
        if (!counts.has(it.price_list_id)) counts.set(it.price_list_id, new Set());
        counts.get(it.price_list_id)!.add(it.product_id);
        const cur = updated.get(it.price_list_id);
        if (!cur || it.updated_at > cur) updated.set(it.price_list_id, it.updated_at);
      }
      const agg: Record<string, { count: number; updated_at: string | null }> = {};
      for (const pl of counts.keys()) {
        agg[pl] = { count: counts.get(pl)!.size, updated_at: updated.get(pl) ?? null };
      }
      return agg;
    },
  });

  /* ----- Spesialpris-flagg for matrix ----- */
  const specialFlagsQuery = useQuery({
    queryKey: ["matrix-special-flags", legalEntityId, priceDate],
    enabled: view === "matrix",
    queryFn: async () => {
      const data = await fetchAllRows((from, to) =>
        supabase
          .from("special_prices")
          .select("product_id, price_list_id, customer_id, customer:customers(display_name)")
          .eq("legal_entity_id", legalEntityId!)
          .or(`valid_from.is.null,valid_from.lte.${priceDate}`)
          .or(`valid_to.is.null,valid_to.gte.${priceDate}`)
          .range(from, to),
      );
      const general = new Set<string>();
      const customerMap = new Map<string, string[]>();
      for (const sp of data) {
        if (!sp.price_list_id) continue;
        const key = `${sp.product_id}::${sp.price_list_id}`;
        if (sp.customer_id == null) {
          general.add(key);
        } else {
          const arr = customerMap.get(key) ?? [];
          const name =
            (sp as { customer?: { display_name?: string } | null }).customer?.display_name ??
            "Ukjent";
          if (!arr.includes(name)) arr.push(name);
          customerMap.set(key, arr);
        }
      }
      return { general, customerMap };
    },
  });

  /* ----- Filtrert produktliste ----- */
  const mainMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of mainCatsQuery.data ?? []) m.set(c.id, c.code);
    return m;
  }, [mainCatsQuery.data]);
  const subMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of subCatsQuery.data ?? []) m.set(c.id, c.code);
    return m;
  }, [subCatsQuery.data]);

  const products: ProductRow[] = useMemo(() => {
    let rows = (productsQuery.data ?? []).map((p) => ({
      id: p.id,
      display_number: p.display_number,
      display_name: p.display_name,
      unit_of_sale: p.unit_of_sale,
      is_for_sale: p.is_for_sale,
      mva_rate: Number(p.mva_rate ?? 0),
      main_category_id: p.main_category_id,
      sub_category_id: p.sub_category_id,
      main_code: p.main_category_id ? mainMap.get(p.main_category_id) : undefined,
      sub_code: p.sub_category_id ? subMap.get(p.sub_category_id) : undefined,
    }));
    if (!includeNotForSale) rows = rows.filter((p) => p.is_for_sale);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (p) =>
          p.display_name.toLowerCase().includes(q) ||
          String(p.display_number).includes(q),
      );
    }
    return rows;
  }, [productsQuery.data, includeNotForSale, search, mainMap, subMap]);

  const productNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of products) m[p.id] = p.display_name;
    return m;
  }, [products]);

  /* ----- Selection ----- */
  const visibleIds = useMemo(() => products.map((p) => p.id), [products]);
  function toggle(id: string, checked: boolean) {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (checked) n.add(id);
      else n.delete(id);
      return n;
    });
  }
  function toggleAll(checked: boolean) {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (checked) for (const id of visibleIds) n.add(id);
      else for (const id of visibleIds) n.delete(id);
      return n;
    });
  }

  /* ----- Batch-juster: skriv ----- */
  async function applyAdjustments(
    changes: { productId: string; productName: string; priceListId: string; priceListName: string }[],
    next: Map<string, number>,
  ) {
    let ok = 0;
    for (const ch of changes) {
      const newPrice = next.get(`${ch.productId}::${ch.priceListId}`);
      if (newPrice == null) continue;
      const { data: existing } = await supabase
        .from("price_list_items")
        .select("id")
        .eq("price_list_id", ch.priceListId)
        .eq("product_id", ch.productId)
        .eq("valid_from", priceDate)
        .maybeSingle();
      if (existing) {
        const { error } = await supabase
          .from("price_list_items")
          .update({ price: newPrice })
          .eq("id", existing.id);
        if (error) {
          toast.error(`${ch.productName} → ${ch.priceListName}: ${error.message}`);
          continue;
        }
      } else {
        const { error } = await supabase.from("price_list_items").insert({
          price_list_id: ch.priceListId,
          product_id: ch.productId,
          price: newPrice,
          valid_from: priceDate,
        });
        if (error) {
          toast.error(`${ch.productName} → ${ch.priceListName}: ${error.message}`);
          continue;
        }
      }
      ok++;
    }
    if (ok > 0) {
      await logAudit({
        action: "price_adjusted",
        entity_type: "price_list_item",
        entity_id: null,
        entity_display_reference: `Bulk-justering ${ok} celler · ${priceDate}`,
        changes: { count: ok, valid_from: priceDate },
      });
      toast.success(`${ok} pris(er) lagret`);
      qc.invalidateQueries({ queryKey: ["matrix-prices"] });
    }
  }

  /* ----- CSV-eksport (alltid netto) ----- */
  function exportCsv() {
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : visibleIds;
    const productById = new Map(products.map((p) => [p.id, p]));
    const header = ["varenummer", "varenavn", ...activeLists.map((p) => p.display_name)];
    const rows = ids
      .map((id) => productById.get(id))
      .filter((p): p is ProductRow => !!p)
      .map((p) => [
        p.display_number,
        p.display_name,
        ...activeLists.map((pl) => {
          const v = pricesQuery.data?.get(`${p.id}::${pl.id}`);
          return v != null ? v.toFixed(2).replace(".", ",") : "";
        }),
      ]);
    downloadCsv(`prislister_${priceDate}.csv`, toCsv([header, ...rows]));
    toast.success(`${rows.length} rader eksportert`);
  }

  return (
    <>
      <AppHeaderBanner title="Priser" subtitle="Prislister for Nøtterø Bakeri AS" />

      <div className="px-6 py-5 space-y-4">
        {/* VISNING-VELGER (prominent, egen rad) */}
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1 shadow-sm">
            <button
              onClick={() => setView("matrix")}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition",
                view === "matrix"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={view === "matrix"}
            >
              <LayoutGrid className="h-4 w-4" />
              Tabell
            </button>
            <button
              onClick={() => setView("simple")}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition",
                view === "simple"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={view === "simple"}
            >
              <List className="h-4 w-4" />
              Enkel
            </button>
            <button
              onClick={() => setView("retur")}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition",
                view === "retur"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={view === "retur"}
            >
              <RotateCcw className="h-4 w-4" />
              Retur
            </button>
          </div>

          <Badge className="bg-app-dark text-app-foreground hover:bg-app-dark">
            {products.length} treff
          </Badge>
        </div>

        {/* HEADER-RAD: Handling + søk + flagg + mva-toggle */}
        <div className="flex flex-wrap items-center gap-3">
          {canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="bg-app hover:bg-app-dark text-app-foreground">
                  Handling <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem
                  onClick={() => {
                    if (selectedIds.size === 0) {
                      toast.info("Velg minst én vare først (checkbox til venstre)");
                      return;
                    }
                    setAdjustOpen(true);
                  }}
                >
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  Justere priser
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setOfferListsOpen(true)}>
                  <Layers className="mr-2 h-4 w-4" />
                  Tilbudsprislister
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDatePopoverOpen(true)}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  Velg prisdato
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={exportCsv}>
                  <Download className="mr-2 h-4 w-4" />
                  Last ned prisliste
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setImportOpen(true)}>
                  <Upload className="mr-2 h-4 w-4" />
                  Importer priser
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {!canWrite && (
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <Download className="mr-1.5 h-4 w-4" /> Last ned prisliste
            </Button>
          )}

          <div className="relative w-72 max-w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="navn eller nr…"
              className="pl-9 h-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={includeNotForSale}
              onChange={(e) => setIncludeNotForSale(e.target.checked)}
            />
            vis også varer som ikke er til salgs
          </label>

          <label className="ml-auto flex items-center gap-2 text-sm">
            <Switch checked={showInclMva} onCheckedChange={setShowInclMva} />
            <span className="text-muted-foreground">Vis inkl. mva</span>
          </label>
        </div>

        {/* Sentral prisdato (F82-stil, grønn tekst) */}
        {view === "matrix" && (
          <div className="flex items-center justify-center">
            <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  className="text-sm font-medium text-app-dark hover:underline"
                  type="button"
                >
                  Prisdato: {formatNb(priceDate)}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="center">
                <Calendar
                  mode="single"
                  selected={new Date(priceDate)}
                  onSelect={(d) => {
                    if (d) {
                      setPriceDate(osloDateISO(d));
                      setDatePopoverOpen(false);
                    }
                  }}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Batch-info-stripe når noe er valgt */}
        {view === "matrix" && selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-app/30 bg-app/5 px-3 py-2 text-sm">
            <span className="font-medium text-app-dark">{selectedIds.size} valgt</span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => setSelectedIds(new Set())}
            >
              Fjern valg
            </Button>
          </div>
        )}

        {/* INNHOLD */}
        {listsQuery.isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : view === "simple" ? (
          <SimpleView
            lists={listsQuery.data ?? []}
            agg={itemsAggQuery.data}
            onOpen={(id) => navigate(`/varer/priser/${id}`)}
          />
        ) : view === "retur" ? (
          <ReturView priceDate={priceDate} search={search} />
        ) : (
          <>
            {pricesQuery.isLoading || productsQuery.isLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <MatrixView
                products={products}
                priceLists={activeLists}
                prices={pricesQuery.data ?? new Map()}
                pendingEdits={pendingEdits}
                onCellChange={handleCellChange}
                generalSpecialFlags={specialFlagsQuery.data?.general ?? new Set()}
                customerSpecialFlags={specialFlagsQuery.data?.customerMap ?? new Map()}
                selectedIds={selectedIds}
                onToggleSelect={toggle}
                onToggleSelectAll={toggleAll}
                highlightPriceListId={highlight}
                showInclMva={showInclMva}
              />
            )}
            <div className="text-xs text-muted-foreground">
              Viser {products.length} varer × {activeLists.length} prislister.
              Gul prikk = aktiv generell spesialpris. Blå prikk = kunde-spesifikk spesialpris.
              {showInclMva && " · MVA-tillegg vises basert på vares mva-sats."}
            </div>
          </>
        )}
      </div>

      {/* Sticky save-bar når det finnes ulagrede endringer */}
      {pendingEdits.size > 0 && (
        <div className="sticky bottom-0 left-0 right-0 z-40 border-t border-app/40 bg-warning/10 backdrop-blur supports-[backdrop-filter]:bg-warning/15">
          <div className="flex flex-wrap items-center gap-3 px-6 py-3">
            <span className="text-sm font-medium text-foreground">
              {pendingEdits.size} ulagret{pendingEdits.size === 1 ? "" : "e"} prisendring{pendingEdits.size === 1 ? "" : "er"}
            </span>
            <span className="text-xs text-muted-foreground">
              Trykk Lagre for å skrive til database, eller Forkast for å angre.
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={discardPending}
                disabled={savingBatch}
              >
                Forkast
              </Button>
              <Button
                size="sm"
                onClick={saveAllPending}
                disabled={savingBatch}
                className="bg-app hover:bg-app-dark text-app-foreground"
              >
                {savingBatch && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Lagre {pendingEdits.size} endring{pendingEdits.size === 1 ? "" : "er"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <BatchAdjustDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        selectedProductIds={Array.from(selectedIds)}
        productNames={productNames}
        priceLists={activeLists}
        getCurrentPrice={(p, pl) => pricesQuery.data?.get(`${p}::${pl}`) ?? null}
        onApply={applyAdjustments}
      />

      <OfferPriceListsDialog open={offerListsOpen} onOpenChange={setOfferListsOpen} />

      <ImportPricesDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onComplete={() => {
          qc.invalidateQueries({ queryKey: ["matrix-products"] });
          qc.invalidateQueries({ queryKey: ["matrix-prices"] });
        }}
      />
    </>
  );
}

/* ----------------- Enkel-visning som kort-grid ----------------- */
function SimpleView({
  lists,
  agg,
  onOpen,
}: {
  lists: {
    id: string;
    code: string;
    display_name: string;
    is_default: boolean;
    prices_include_mva: boolean;
    list_number: number | null;
    price_list_type: string;
    status: string;
    updated_at: string;
  }[];
  agg: Record<string, { count: number; updated_at: string | null }> | undefined;
  onOpen: (id: string) => void;
}) {
  if (lists.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Ingen prislister ennå.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {lists
        .filter((l) => l.status === "active")
        .map((pl) => {
          const a = agg?.[pl.id];
          const updated = a?.updated_at ?? pl.updated_at;
          const isBase = pl.price_list_type === "base";
          return (
            <Card
              key={pl.id}
              className="cursor-pointer transition hover:border-app hover:shadow-sm"
              onClick={() => onOpen(pl.id)}
            >
              <CardContent className="pt-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{pl.display_name}</h3>
                    <p className="text-xs font-mono text-muted-foreground">{pl.code}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {isBase && (
                      <Badge className="bg-muted text-muted-foreground hover:bg-muted">Base</Badge>
                    )}
                    {pl.is_default && (
                      <Badge className="bg-app/15 text-app-dark hover:bg-app/15">Default</Badge>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  {pl.list_number != null && <span>nr {pl.list_number}</span>}
                  {pl.list_number != null && <span>·</span>}
                  <span>{pl.prices_include_mva ? "inkl." : "ekskl."} MVA</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{a?.count ?? 0} varer</span>
                  <span className="text-muted-foreground">
                    Sist endret {formatDate(updated)}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
    </div>
  );
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("nb-NO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}
