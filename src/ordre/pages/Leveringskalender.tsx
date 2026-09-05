import { useMemo, useState, useEffect, useCallback } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Grid3x3,
  ChevronLeft,
  ChevronRight,
  Save,
  Loader2,
  RotateCcw,
  Plus,
  StickyNote,
  ArrowRight,
  MoreHorizontal,
  Copy,
  MessageSquare,
  Trash2,
  PackageCheck,
  ChevronDown,
  Repeat,
  Eye,
  BookOpen,
  CalendarIcon,
  ShoppingCart,
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { format as fmtDate } from "date-fns";
import { nb } from "date-fns/locale";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { QueryEmptyState, QueryErrorState } from "@/components/common/QueryState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { AddProductDialog } from "@/ordre/components/orders/AddProductDialog";
import { MerknadDialog } from "@/ordre/components/orders/MerknadDialog";
import { useProductLabelProfiles } from "@/produksjon/features/etiketter/hooks/useProductLabelProfiles";
import { useLabelPrintProfiles } from "@/produksjon/features/utskriftsprofiler/hooks/useLabelPrintProfiles";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { ColumnCommentDialog } from "@/ordre/components/orders/matrix/ColumnCommentDialog";
import { CopyColumnDialog, type CopyColumnInput } from "@/ordre/components/orders/matrix/CopyColumnDialog";
import {
  SetForAllDaysDialog,
  RemoveProductDialog,
  MoveProductDialog,
  PauseDialog,
} from "@/ordre/components/orders/matrix/MatrixActionDialogs";
import { CorrectionsDialog } from "@/ordre/components/orders/matrix/CorrectionsDialog";
import { FlatLinesView } from "@/ordre/components/orders/matrix/FlatLinesView";
import { ProductInfoDialog } from "@/ordre/components/orders/matrix/ProductInfoDialog";
import { ProductWeekEditor } from "@/ordre/components/orders/matrix/ProductWeekEditor";
import { TourOrderDialog } from "@/ordre/components/orders/matrix/TourOrderDialog";
import {
  useColumnComments,
  useUpsertColumnComment,
  useDeleteMatrixColumn,
} from "@/ordre/hooks/useColumnComments";
import { useGenerateDeliveryNotes } from "@/ordre/hooks/useGenerateDeliveryNotes";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useNBCustomers, useCustomerById } from "@/ordre/hooks/useNBCustomers";
import {
  useMatrixData,
  useSaveMatrix,
  useAddableProducts,
  isoWeekMonday,
  addDays,
  tourActiveOnDate,
  type MatrixChange,
  type MatrixTour,
  type MatrixProduct,
  type AddableProduct,
} from "@/ordre/hooks/useMatrix";
import { useDebouncedValue } from "@/ordre/hooks/useDebouncedValue";
import { useProductsByIds } from "@/ordre/hooks/useProductsByIds";
import { useAuth } from "@/hooks/useAuth";
import { useUserAccess } from "@/ordre/hooks/useUserAccess";
import { useCustomerWeather, type WeatherMap } from "@/ordre/hooks/useCustomerWeather";
import { WeatherCell } from "@/ordre/components/orders/WeatherCell";
import { useRecurringGhost, type RecurringGhostMap } from "@/ordre/hooks/useRecurringGhost";
import { useOrdersLifecycle } from "@/ordre/hooks/useOrdersLifecycle";
import { OrderKindBadge } from "@/ordre/components/orders/OrderKindBadge";
import { LifecycleBadge } from "@/ordre/components/orders/LifecycleBadge";
import { getKindMeta, type OrderKind } from "@/ordre/lib/orderStatus";

/** Fargetone for en matrisekolonne — styrer bakgrunn i header og celler. */
type ColumnTone = {
  kind: OrderKind | null;
  deliveryNote: boolean;
  deliveryNoteNumber: string | null;
};

import { useRecurringSchedules, type RecurringScheduleWithCustomer } from "@/ordre/hooks/useRecurringOrders";
import { RecurringScheduleDialog } from "@/ordre/components/orders/RecurringScheduleDialog";
import {
  useDeliveryPausesForCustomer,
  isPaused,
  type PauseMap,
  type PauseInfo,
} from "@/ordre/hooks/useDeliveryPausesForCustomer";
import { formatNOK, todayISO } from "@/ordre/lib/format";
import { cn } from "@/lib/utils";
import { type Merknad, isMerknadEmpty, parseMerknad } from "@/ordre/lib/merknad";
import {
  type QuickRange,
  rangeFor,
  loadStoredRange,
  saveStoredRange,
  buildDateRange,
  formatKrNetto,
} from "@/ordre/lib/dateRanges";
import {
  type CellKey,
  type NoTourEntry,
  ckey,
  colKeyOf,
  aggregateExistingCells,
  computeDirtyChanges,
  computeTotals,
  effectiveCellQty,
  visibleGhostQty,
} from "@/ordre/lib/matrixEdits";
import { ChangeTourDialog } from "@/ordre/components/orders/ChangeTourDialog";

const DAY_LABELS = ["Ma", "Ti", "On", "To", "Fr", "Lø", "Sø"];

type CellTarget = {
  date: string;
  tourId: string;
  productId: string;
  productName: string;
  tourName: string;
  tourNumber: number;
  quantity: number;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function MatrixPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: access } = useUserAccess(user);
  const canEdit = access?.hasOrdreWrite ?? false;

  // Dyplenker fra dashbordet: ?date=YYYY-MM-DD og ?customer=<uuid>
  const [searchParams] = useSearchParams();
  const paramDate = searchParams.get("date");
  const paramCustomer = searchParams.get("customer");
  const initialDate = paramDate && ISO_DATE_RE.test(paramDate) ? paramDate : null;

  const [customerId, setCustomerId] = useState<string | null>(
    paramCustomer && UUID_RE.test(paramCustomer) ? paramCustomer : null,
  );

  // Date range driven by quick-filter chips OR by week navigation.
  const initialWeek = isoWeekMonday(initialDate ?? todayISO());
  const [dateFrom, setDateFrom] = useState<string>(initialWeek);
  const [dateTo, setDateTo] = useState<string>(addDays(initialWeek, 6));
  const [quickFilter, setQuickFilter] = useState<QuickRange | null>(
    initialDate ? null : "this_week",
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [fromDateOpen, setFromDateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);

  const days = useMemo(() => buildDateRange(dateFrom, dateTo), [dateFrom, dateTo]);

  const { data: customers } = useNBCustomers(debouncedSearch);
  const { data: selectedCustomer } = useCustomerById(customerId);
  const { data: customerSchedules = [] } = useRecurringSchedules(
    customerId ? { customer_id: customerId, status: "active" } : { customer_id: "__none__" },
  );
  const existingSchedule: RecurringScheduleWithCustomer | null =
    customerId && customerSchedules.length > 0 ? customerSchedules[0] : null;
  const {
    data: matrix,
    isLoading,
    isError: isMatrixError,
    error: matrixError,
    refetch: refetchMatrix,
  } = useMatrixData(customerId, dateFrom, dateTo);
  const { data: addableProducts } = useAddableProducts(customerId, !!customerId);
  // MVA-sats per produkt for varer som legges til lokalt (RPC-en returnerer ikke mva_rate)
  const addableIds = useMemo(() => (addableProducts ?? []).map((p) => p.id).sort(), [addableProducts]);
  const { data: addableMvaRates } = useQuery({
    queryKey: ["matrix", "addable-mva", addableIds],
    enabled: addableIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, mva_rate")
        .in("id", addableIds);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const r of (data ?? []) as { id: string; mva_rate: number | null }[]) {
        map.set(r.id, Number(r.mva_rate ?? 0));
      }
      return map;
    },
  });
  const mvaRateFor = useCallback(
    (productId: string) => addableMvaRates?.get(productId) ?? 0,
    [addableMvaRates],
  );
  const saveMatrix = useSaveMatrix();
  const upsertColumnComment = useUpsertColumnComment();
  const deleteMatrixColumn = useDeleteMatrixColumn();
  const generateNotes = useGenerateDeliveryNotes();
  const navigate = useNavigate();
  const { data: weatherMap } = useCustomerWeather(customerId, dateFrom, dateTo);
  const { data: ghostMap } = useRecurringGhost(customerId, dateFrom, dateTo);
  const { data: pauseMap } = useDeliveryPausesForCustomer(customerId, dateFrom, dateTo);
  const { data: columnComments } = useColumnComments(customerId, dateFrom, dateTo);

  const [edits, setEdits] = useState<Record<CellKey, string>>({});
  const [addedProducts, setAddedProducts] = useState<MatrixProduct[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  // Column action dialog state
  const [copyColCol, setCopyColCol] = useState<{ date: string; tour: MatrixTour } | null>(null);
  const [commentCol, setCommentCol] = useState<{ date: string; tour: MatrixTour } | null>(null);
  const [deleteColConfirm, setDeleteColConfirm] = useState<{ date: string; tour: MatrixTour } | null>(null);
  const [tourOrderCol, setTourOrderCol] = useState<{ date: string; tour: MatrixTour } | null>(null);
  const [weekEditorProduct, setWeekEditorProduct] = useState<MatrixProduct | null>(null);

  // Handling-meny dialog state
  const [setForAllOpen, setSetForAllOpen] = useState(false);
  const [removeProdOpen, setRemoveProdOpen] = useState(false);
  const [moveProdOpen, setMoveProdOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const [flatView, setFlatView] = useState(false);
  const [flatDayFilter, setFlatDayFilter] = useState<string | null>(null);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false);

  // Toolbar visning
  const [hiddenTourIds, setHiddenTourIds] = useState<Set<string>>(new Set());
  const [customerCardOpen, setCustomerCardOpen] = useState(false);

  const daysCount = useMemo(() => {
    const a = new Date(dateFrom + "T12:00:00").getTime();
    const b = new Date(dateTo + "T12:00:00").getTime();
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  }, [dateFrom, dateTo]);

  function setDaysCount(n: number) {
    const clamped = Math.max(1, Math.min(31, n));
    setDateTo(addDays(dateFrom, clamped - 1));
    setQuickFilter(null);
  }

  // Merknad dialog state
  const [merknadCell, setMerknadCell] = useState<CellTarget | null>(null);

  // Copy-to-next-day overwrite confirm
  const [copyConfirm, setCopyConfirm] = useState<
    | {
        source: CellTarget;
        targetDate: string;
        targetTourId: string;
        quantity: number;
        merknad: Merknad | null;
      }
    | null
  >(null);

  // When customer changes: load stored quick-filter (default this_week), apply.
  useEffect(() => {
    setEdits({});
    setAddedProducts([]);
    if (!customerId) return;
    const stored = loadStoredRange(customerId) ?? "this_week";
    const r = rangeFor(stored);
    setQuickFilter(stored);
    setDateFrom(r.from);
    setDateTo(r.to);
  }, [customerId]);

  // Reset edits when range changes too
  useEffect(() => {
    setEdits({});
    setAddedProducts([]);
  }, [dateFrom, dateTo]);

  function applyQuickFilter(kind: QuickRange) {
    if (!customerId) return;
    const r = rangeFor(kind);
    setQuickFilter(kind);
    setDateFrom(r.from);
    setDateTo(r.to);
    saveStoredRange(customerId, kind);
  }

  // Drop locally-added products that have arrived in the server response (after save+refresh)
  useEffect(() => {
    if (!matrix) return;
    setAddedProducts((prev) => prev.filter((p) => !matrix.products.some((mp) => mp.id === p.id)));
  }, [matrix]);

  // Ghost-only products: ids fra fastordre som ikke allerede er i matrix.products
  const ghostOnlyIds = useMemo(() => {
    if (!ghostMap || !matrix) return [] as string[];
    const known = new Set<string>([
      ...matrix.products.map((p) => p.id),
      ...addedProducts.map((p) => p.id),
    ]);
    const out = new Set<string>();
    for (const key of ghostMap.keys()) {
      const productId = key.split("|")[2];
      if (!known.has(productId)) out.add(productId);
    }
    return [...out];
  }, [ghostMap, matrix, addedProducts]);

  const { data: ghostProducts } = useProductsByIds(ghostOnlyIds);

  const allProducts = useMemo<MatrixProduct[]>(() => {
    if (!matrix) return [];
    return [...matrix.products, ...addedProducts, ...(ghostProducts ?? [])];
  }, [matrix, addedProducts, ghostProducts]);

  const productById = useMemo(() => {
    const m = new Map<string, MatrixProduct>();
    for (const p of allProducts) m.set(p.id, p);
    return m;
  }, [allProducts]);

  // Etikettprofiler pr produkt (matrise-celler)
  const allProductIds = useMemo(() => allProducts.map((p) => p.id), [allProducts]);
  const { data: labelProfileMap } = useProductLabelProfiles(allProductIds, NB_LEGAL_ENTITY_ID);
  const { data: labelProfiles } = useLabelPrintProfiles(NB_LEGAL_ENTITY_ID);
  const labelProfileByProduct = useMemo(() => {
    const byId = new Map<string, NonNullable<typeof labelProfiles>[number]>();
    for (const p of labelProfiles ?? []) byId.set(p.id, p);
    const out = new Map<string, NonNullable<typeof labelProfiles>[number]>();
    for (const pid of allProductIds) {
      const profId = labelProfileMap?.[pid];
      const prof = profId ? byId.get(profId) : null;
      if (prof) out.set(pid, prof);
    }
    return out;
  }, [allProductIds, labelProfileMap, labelProfiles]);

  const tourById = useMemo(() => {
    const m = new Map<string, MatrixTour>();
    for (const t of matrix?.tours ?? []) m.set(t.id, t);
    return m;
  }, [matrix]);

  const columns = useMemo(() => {
    const cols: { date: string; tour: MatrixTour }[] = [];
    if (!matrix) return cols;
    for (const date of days) {
      for (const tour of matrix.tours) {
        if (hiddenTourIds.has(tour.id)) continue;
        if (tourActiveOnDate(tour, date)) cols.push({ date, tour });
      }
    }
    return cols;
  }, [matrix, days, hiddenTourIds]);

  const visibleDates = useMemo(() => new Set(columns.map((c) => c.date)), [columns]);

  /** Ett samlet oppslag over lagrede celler — duplikate ordre summeres. */
  const existingIndex = useMemo(
    () => aggregateExistingCells(matrix?.existing_cells ?? []),
    [matrix],
  );

  const existingQty = existingIndex.qty;
  const existingMerknad = existingIndex.merknad;
  const fallbackCells = existingIndex.fallback;
  const cellOrderIds = existingIndex.orderIds;

  // Ordre-id per kolonne (dato|tur) → livssyklus/ordretype for kolonne-header
  const colOrderId = existingIndex.colOrderId;

  const hasColumnOrder = useCallback(
    (date: string, tourId: string) => colOrderId.has(colKeyOf(date, tourId)),
    [colOrderId],
  );
  const isPausedCol = useCallback(
    (date: string, tourId: string) => !!isPaused(pauseMap, date, tourId),
    [pauseMap],
  );

  const ghostRuleBase = useMemo(
    () => ({ edits, existingQty, ghostMap, hasColumnOrder, isPausedCol }),
    [edits, existingQty, ghostMap, hasColumnOrder, isPausedCol],
  );

  /**
   * Fastordre ER ordren: når cellen ikke har lagret linje og kolonnen ikke har
   * en materialisert ordre, vises spøkelsestallet fra fastordre-malen som verdi.
   * Brukeren kan skrive over; kun faktisk endrede celler sendes til lagring.
   */
  function getCellValue(key: CellKey): string {
    if (key in edits) return edits[key];
    const v = existingQty[key];
    if (v) return String(v);
    const g = visibleGhostQty({ key, ...ghostRuleBase });
    return g > 0 ? String(g) : "";
  }

  /** True når cellen viser et fastordre-tall som ennå ikke er materialisert. */
  function isGhostCell(key: CellKey): boolean {
    return visibleGhostQty({ key, ...ghostRuleBase }) > 0;
  }

  function getEffectiveQty(key: CellKey): number {
    if (key in edits) return Number(edits[key] || 0);
    return existingQty[key] ?? 0;
  }

  function isDirty(key: CellKey): boolean {
    if (!(key in edits)) return false;
    const editedNum = Number(edits[key] || 0);
    const existing = existingQty[key] ?? 0;
    return editedNum !== existing;
  }

  function setCellValue(key: CellKey, value: string) {
    const cleaned = value.replace(",", ".");
    if (cleaned !== "" && !/^\d*\.?\d*$/.test(cleaned)) return;
    setEdits((prev) => ({ ...prev, [key]: cleaned }));
  }

  const dirtyChanges = useMemo<MatrixChange[]>(
    () => computeDirtyChanges(edits, existingQty),
    [edits, existingQty],
  );

  const dirtyCount = dirtyChanges.length;

  // Effektive rader for "enkel tabell"-visning: lagrede celler + ulagrede endringer + nye rader.
  const flatRows = useMemo(() => {
    if (!matrix) return [] as import("@/ordre/components/orders/matrix/FlatLinesView").FlatLineRow[];
    type Row = import("@/ordre/components/orders/matrix/FlatLinesView").FlatLineRow;
    const productById = new Map(allProducts.map((p) => [p.id, p]));
    const rowMap = new Map<string, Row>();

    // 1) Lagrede celler (ta med ALLE bestilte linjer, også uten tur).
    //    Flere ordre på samme dato|tur|produkt summeres til én rad.
    for (const c of matrix.existing_cells) {
      const key = `${c.delivery_date}|${c.delivery_tour_id ?? ""}|${c.product_id}`;
      const prev = rowMap.get(key);
      if (prev) {
        prev.quantity += Number(c.quantity);
        prev.line_total_incl_vat += Number(c.line_total_incl_vat);
        if (c.order_id && !prev.order_ids?.includes(c.order_id)) {
          prev.order_ids = [...(prev.order_ids ?? []), c.order_id];
        }
        continue;
      }
      rowMap.set(key, {
        key,
        delivery_date: c.delivery_date,
        delivery_tour_id: c.delivery_tour_id,
        product_id: c.product_id,
        quantity: Number(c.quantity),
        unit_price: Number(c.unit_price),
        line_total_incl_vat: Number(c.line_total_incl_vat),
        order_ids: c.order_id ? [c.order_id] : [],
        order_number: c.order_number ?? null,
        readOnly: !c.delivery_tour_id,
      });
    }

    // 2) Fastordre — samme ghost-regel som i rutenettet
    if (ghostMap) {
      for (const [gkey, qty] of ghostMap.entries()) {
        if (!qty || qty <= 0) continue;
        const [date, tour_id, product_id] = gkey.split("|");
        if (!visibleDates.has(date)) continue;
        const key = `${date}|${tour_id}|${product_id}`;
        if (rowMap.has(key)) continue;
        if (visibleGhostQty({ key, ...ghostRuleBase }) <= 0) continue;
        const p = productById.get(product_id);
        const unitPrice = Number(p?.unit_price ?? 0);
        const mvaRate = Number(p?.mva_rate ?? 0);
        rowMap.set(key, {
          key,
          delivery_date: date,
          delivery_tour_id: tour_id,
          product_id,
          quantity: Number(qty),
          unit_price: unitPrice,
          line_total_incl_vat: Number(qty) * unitPrice * (1 + mvaRate / 100),
        });
      }
    }

    // 3) Overlay redigeringer (inkl. nye linjer)
    for (const [key, raw] of Object.entries(edits)) {
      const [date, tour_id, product_id] = key.split("|");
      const qty = Number(raw || 0);
      const existing = rowMap.get(key);
      if (qty <= 0) {
        if (existing) rowMap.delete(key);
        continue;
      }
      const p = productById.get(product_id);
      const unitPrice = existing?.unit_price ?? Number(p?.unit_price ?? 0);
      const mvaRate = Number(p?.mva_rate ?? 0);
      rowMap.set(key, {
        key,
        delivery_date: date,
        delivery_tour_id: tour_id,
        product_id,
        quantity: qty,
        unit_price: unitPrice,
        line_total_incl_vat: qty * unitPrice * (1 + mvaRate / 100),
        isDraft: true,
      });
    }

    // Filtrer bort qty 0
    return Array.from(rowMap.values()).filter((r) => r.quantity > 0);
  }, [matrix, edits, allProducts, ghostMap, visibleDates, ghostRuleBase]);

  const unsavedAddedCount = useMemo(() => {
    return addedProducts.filter((p) => {
      return !dirtyChanges.some((c) => c.product_id === p.id && c.quantity > 0);
    }).length;
  }, [addedProducts, dirtyChanges]);

  // ----- Totals (net kr) -----
  // Per-cell value = qty * (product.unit_price ?? 0). Per-row sum, per-col sum, grand total.
  const totals = useMemo(() => {
    const result = computeTotals({
      products: allProducts,
      columns: columns.map((c) => ({ date: c.date, tourId: c.tour.id })),
      ...ghostRuleBase,
    });
    // Dev-mode sanity check: row-sum total === col-sum total === grand
    if (import.meta.env.DEV) {
      const rowSumGrand = Object.values(result.rowTotals).reduce((a, b) => a + b, 0);
      const colSumGrand = Object.values(result.colTotals).reduce((a, b) => a + b, 0);
      console.assert(
        Math.abs(rowSumGrand - result.grand) < 0.005 &&
          Math.abs(colSumGrand - result.grand) < 0.005,
        "[Matrix totals] row/col/grand mismatch",
        { rowSumGrand, colSumGrand, grand: result.grand },
      );
    }
    return result;
  }, [allProducts, columns, ghostRuleBase]);

  async function handleSave() {
    if (!customerId || dirtyCount === 0) return;
    // Gule (fastordre-)kolonner som berøres blir datert ordre ved lagring.
    const fixedDates = [
      ...new Set(
        dirtyChanges
          .filter((c) => colTone(c.date, c.tour_id).kind === "fixed")
          .map((c) => c.date),
      ),
    ].sort();
    try {
      const result = await saveMatrix.mutateAsync({ customerId, changes: dirtyChanges });
      setEdits({});
      const r = result as {
        orders_created?: number;
        orders_deleted?: number;
        lines_created?: number;
        lines_updated?: number;
        lines_deleted?: number;
        has_zero_fallback_lines?: string[] | null;
      } | null;
      const description = r
        ? `${r.orders_created ?? 0} nye ordre, ${r.lines_created ?? 0} linjer opprettet, ${r.lines_updated ?? 0} oppdatert, ${r.lines_deleted ?? 0} slettet${
            r.orders_deleted ? `, ${r.orders_deleted} tomme ordre fjernet` : ""
          }`
        : undefined;
      if (fixedDates.length > 0) {
        toast.success(
          `Lagret — fastordren ble datert ordre for ${fixedDates.map(formatShortDate).join(", ")}`,
          { description },
        );
      } else {
        toast.success("Lagret", { description });
      }

      const fbCount = r?.has_zero_fallback_lines?.length ?? 0;
      if (fbCount > 0) {
        toast.warning(
          `${fbCount} linje(r) fikk pris 0 — mangler prisliste-rad eller spesialpris`,
          { description: "Sett opp pris i prisliste eller special_prices for å rydde." },
        );
      }
    } catch (err) {
      toast.error("Kunne ikke lagre", { description: (err as Error).message });
    }
  }

  function handleDiscardClick() {
    if (addedProducts.length > 0 || dirtyCount > 0) {
      setDiscardOpen(true);
    }
  }

  function confirmDiscard() {
    setEdits({});
    setAddedProducts([]);
    setDiscardOpen(false);
  }

  function handleAddProduct(p: AddableProduct) {
    if (allProducts.some((x) => x.id === p.id)) return;
    const newRow: MatrixProduct = {
      id: p.id,
      display_number: p.display_number,
      code: "",
      display_name: p.display_name,
      sales_unit: p.sales_unit,
      mva_rate: mvaRateFor(p.id),
      unit_price: p.unit_price,
      price_source: p.unit_price == null ? "none" : "default",
    };
    setAddedProducts((prev) => [...prev, newRow]);
  }

  function shiftWeek(delta: number) {
    // Manual nav clears chip selection but does NOT touch localStorage.
    setQuickFilter(null);
    const span = Math.max(1, daysCount);
    if (span >= 7) {
      // Uke-visning: hopp hele uker og hold mandag-justering.
      const baseMon = isoWeekMonday(dateFrom);
      const newMon = addDays(baseMon, delta * 7);
      setDateFrom(newMon);
      setDateTo(addDays(newMon, span - 1));
    } else {
      // Kortere visning: bla ett vindu (= span dager) om gangen.
      const newFrom = addDays(dateFrom, delta * span);
      setDateFrom(newFrom);
      setDateTo(addDays(newFrom, span - 1));
    }
  }

  function jumpToday() {
    setQuickFilter(null);
    const span = Math.max(1, daysCount);
    if (span >= 7) {
      const mon = isoWeekMonday(todayISO());
      setDateFrom(mon);
      setDateTo(addDays(mon, span - 1));
    } else {
      const today = todayISO();
      setDateFrom(today);
      setDateTo(addDays(today, span - 1));
    }
  }

  // ----- Cell action helpers -----

  const openMerknad = useCallback(
    (date: string, tour: MatrixTour, productId: string) => {
      const product = productById.get(productId);
      if (!product) return;
      const key = ckey(date, tour.id, productId);
      const qty = getEffectiveQty(key);
      if (qty <= 0) {
        toast.info("Legg inn mengde først.");
        return;
      }
      if (!labelProfileByProduct.get(productId)) {
        toast.info("Produktet er ikke koblet til en utskriftsprofil — ingen etikett-felter å fylle ut.");
        return;
      }
      setMerknadCell({
        date,
        tourId: tour.id,
        productId,
        productName: product.display_name,
        tourName: tour.display_name,
        tourNumber: tour.tour_number,
        quantity: qty,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productById, edits, existingQty],
  );

  async function saveMerknadForCell(target: CellTarget, merknad: Merknad | null) {
    if (!customerId) return;
    try {
      // First: persist any pending qty change for this cell
      const key = ckey(target.date, target.tourId, target.productId);
      const editedNum = key in edits ? Number(edits[key] || 0) : existingQty[key] ?? 0;
      const change: MatrixChange = {
        date: target.date,
        tour_id: target.tourId,
        product_id: target.productId,
        quantity: editedNum,
        merknad: merknad === null ? null : (merknad as unknown as Record<string, unknown>),
      };
      await saveMatrix.mutateAsync({ customerId, changes: [change] });
      // Clear edit for this cell so refreshed value takes over
      setEdits((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setMerknadCell(null);
      toast.success(merknad ? "Merknad lagret" : "Merknad fjernet");
    } catch (err) {
      toast.error("Kunne ikke lagre merknad", { description: (err as Error).message });
    }
  }

  function handleCopyToNextDay(date: string, tour: MatrixTour, productId: string) {
    const product = productById.get(productId);
    if (!product) return;
    const key = ckey(date, tour.id, productId);
    const qty = getEffectiveQty(key);
    const merknad = existingMerknad[key] ?? null;
    if (qty <= 0 && !merknad) {
      toast.info("Cellen er tom. Ingenting å kopiere.");
      return;
    }

    const targetDate = addDays(date, 1);
    if (!visibleDates.has(targetDate)) {
      toast.error("Neste dag er ikke synlig i matrisen", {
        description: `Endre datofilter for å inkludere ${formatDateNO(targetDate)}.`,
      });
      return;
    }
    if (!tourActiveOnDate(tour, targetDate)) {
      toast.error(`Turen "${tour.display_name}" går ikke på ${formatDateNO(targetDate)}.`);
      return;
    }

    const targetKey = ckey(targetDate, tour.id, productId);
    const targetQty = getEffectiveQty(targetKey);
    const targetMerknad = existingMerknad[targetKey] ?? null;
    const targetHasData = targetQty > 0 || (targetMerknad != null && !isMerknadEmpty(targetMerknad));

    const source: CellTarget = {
      date,
      tourId: tour.id,
      productId,
      productName: product.display_name,
      tourName: tour.display_name,
      tourNumber: tour.tour_number,
      quantity: qty,
    };

    if (targetHasData) {
      setCopyConfirm({ source, targetDate, targetTourId: tour.id, quantity: qty, merknad });
    } else {
      void executeCopy(source, targetDate, tour.id, qty, merknad);
    }
  }

  async function executeCopy(
    source: CellTarget,
    targetDate: string,
    targetTourId: string,
    quantity: number,
    merknad: Merknad | null,
  ) {
    if (!customerId) return;
    try {
      const change: MatrixChange = {
        date: targetDate,
        tour_id: targetTourId,
        product_id: source.productId,
        quantity,
        merknad: merknad === null ? null : (merknad as unknown as Record<string, unknown>),
      };
      await saveMatrix.mutateAsync({ customerId, changes: [change] });
      // Drop any local edit for the target cell so the refreshed value is shown
      const targetKey = ckey(targetDate, targetTourId, source.productId);
      setEdits((prev) => {
        if (!(targetKey in prev)) return prev;
        const next = { ...prev };
        delete next[targetKey];
        return next;
      });
      toast.success(`Kopiert til ${formatDateNO(targetDate)}.`);
    } catch (err) {
      toast.error("Kunne ikke kopiere", { description: (err as Error).message });
    } finally {
      setCopyConfirm(null);
    }
  }

  // === Per-kolonne aksjoner ===

  const visibleDatesArr = useMemo(() => [...new Set(columns.map((c) => c.date))], [columns]);

  const colHasAnyData = useCallback(
    (date: string, tourId: string): boolean => {
      if (!matrix) return false;
      for (const c of matrix.existing_cells) {
        if (c.delivery_date === date && c.delivery_tour_id === tourId && Number(c.quantity) > 0) return true;
      }
      return false;
    },
    [matrix],
  );


  const { map: colLifecycleMap } = useOrdersLifecycle(
    useMemo(() => [...new Set(colOrderId.values())], [colOrderId]),
  );

  const colMeta = useCallback(
    (date: string, tourId: string) => {
      const oid = colOrderId.get(`${date}|${tourId}`);
      return oid ? colLifecycleMap.get(oid) : undefined;
    },
    [colOrderId, colLifecycleMap],
  );

  /** Kolonner (dato|tur) som har fastordre-grunnlag fra malen. */
  const colGhostSet = useMemo(() => {
    const s = new Set<string>();
    for (const [gkey, qty] of ghostMap?.entries() ?? []) {
      if (!qty || qty <= 0) continue;
      const [date, tourId] = gkey.split("|");
      s.add(`${date}|${tourId}`);
    }
    return s;
  }, [ghostMap]);

  /**
   * Fargetone per kolonne: materialisert ordretype, ellers "fixed" når det
   * finnes fastordre-grunnlag. `deliveryNote` gir mørkeblå stripe i header.
   */
  const colTone = useCallback(
    (date: string, tourId: string): ColumnTone => {
      const meta = colMeta(date, tourId);
      const lifecycle = meta?.lifecycle;
      if (meta?.order_kind) {
        return {
          kind: meta.order_kind as OrderKind,
          deliveryNote: lifecycle === "delivery_note",
          deliveryNoteNumber: meta.delivery_note_number ?? null,
        };
      }
      if (colGhostSet.has(`${date}|${tourId}`)) {
        return { kind: "fixed", deliveryNote: false, deliveryNoteNumber: null };
      }
      return { kind: null, deliveryNote: false, deliveryNoteNumber: null };
    },
    [colMeta, colGhostSet],
  );



  async function executeColumnCopy(source: { date: string; tour: MatrixTour }, input: CopyColumnInput) {
    if (!customerId || !matrix) return;
    const sourceLines = matrix.existing_cells.filter(
      (c) => c.delivery_date === source.date && c.delivery_tour_id === source.tour.id,
    );
    if (sourceLines.length === 0) {
      toast.info("Kilde-kolonnen er tom.");
      return;
    }
    const existingTargetByProduct = new Map<string, number>();
    for (const c of matrix.existing_cells) {
      if (c.delivery_date === input.targetDate && c.delivery_tour_id === input.targetTourId) {
        existingTargetByProduct.set(c.product_id, Number(c.quantity));
      }
    }
    const changes: MatrixChange[] = sourceLines.map((c) => {
      const existing = existingTargetByProduct.get(c.product_id) ?? 0;
      const qty = input.mode === "sum" ? existing + Number(c.quantity) : Number(c.quantity);
      const change: MatrixChange = {
        date: input.targetDate,
        tour_id: input.targetTourId,
        product_id: c.product_id,
        quantity: qty,
      };
      if (input.includeMerknad && c.merknad) {
        change.merknad = c.merknad as Record<string, unknown>;
      }
      return change;
    });
    try {
      await saveMatrix.mutateAsync({ customerId, changes });
      toast.success(`Kopiert ${changes.length} linjer til ${input.targetDate}.`);
      setCopyColCol(null);
    } catch (err) {
      toast.error("Kunne ikke kopiere kolonne", { description: (err as Error).message });
    }
  }

  async function saveColumnComment(text: string) {
    if (!commentCol || !customerId) return;
    try {
      await upsertColumnComment.mutateAsync({
        customerId,
        date: commentCol.date,
        tourId: commentCol.tour.id,
        comment: text,
      });
      toast.success("Kommentar lagret");
      setCommentCol(null);
    } catch (err) {
      toast.error("Kunne ikke lagre kommentar", { description: (err as Error).message });
    }
  }

  async function confirmDeleteColumn() {
    if (!deleteColConfirm || !customerId) return;
    try {
      const r = await deleteMatrixColumn.mutateAsync({
        customerId,
        date: deleteColConfirm.date,
        tourId: deleteColConfirm.tour.id,
      });
      toast.success(`Slettet ${r.lines_deleted} linjer${r.order_deleted ? " (ordre fjernet)" : ""}.`);
      setDeleteColConfirm(null);
    } catch (err) {
      toast.error("Kunne ikke slette", { description: (err as Error).message });
    }
  }

  async function generatePackingNoteForColumn(date: string, tour: MatrixTour) {
    try {
      const r = await generateNotes.mutateAsync({ date, tourFilter: [tour.id], runType: "main" });
      toast.success(`Pakkseddel laget: ${r.notes_generated} stk for T${tour.tour_number} ${date}`);
    } catch (err) {
      toast.error("Kunne ikke lage pakkseddel", { description: (err as Error).message });
    }
  }

  // === Handling-meny aksjoner ===

  // localStorage-toggle for "Vis alle varer"
  useEffect(() => {
    if (!customerId) return;
    const stored = localStorage.getItem(`matrix_show_all_products_${customerId}`);
    setShowAllProducts(stored === "true");
  }, [customerId]);
  function toggleShowAllProducts() {
    if (!customerId) return;
    setShowAllProducts((prev) => {
      const next = !prev;
      localStorage.setItem(`matrix_show_all_products_${customerId}`, String(next));
      if (next && addableProducts) {
        // Legg alle addable inn som lokale rader (de filtres ut når de dukker i serverdata)
        setAddedProducts((existing) => {
          const knownIds = new Set([
            ...(matrix?.products.map((p) => p.id) ?? []),
            ...existing.map((p) => p.id),
          ]);
          const extra = addableProducts
            .filter((p) => !knownIds.has(p.id))
            .map((p) => ({
              id: p.id,
              display_number: p.display_number,
              code: "",
              display_name: p.display_name,
              sales_unit: p.sales_unit,
              mva_rate: mvaRateFor(p.id),
              unit_price: p.unit_price,
              price_source: p.unit_price == null ? "none" : "default",
            } as MatrixProduct));
          return [...existing, ...extra];
        });
      }
      return next;
    });
  }

  async function handleSetForAllDays(productId: string, qty: number) {
    if (!customerId) return;
    const changes: MatrixChange[] = columns.map((c) => ({
      date: c.date,
      tour_id: c.tour.id,
      product_id: productId,
      quantity: qty,
    }));
    try {
      await saveMatrix.mutateAsync({ customerId, changes });
      toast.success(`Satt ${qty} på ${changes.length} kolonner`);
      setSetForAllOpen(false);
    } catch (err) {
      toast.error("Kunne ikke sette mengde", { description: (err as Error).message });
    }
  }

  async function handleRemoveProduct(productId: string) {
    if (!customerId || !matrix) return;
    const targets = matrix.existing_cells.filter((c) => c.product_id === productId && c.delivery_tour_id);
    if (targets.length === 0) {
      toast.info("Ingen linjer å slette i synlig periode.");
      return;
    }
    const changes: MatrixChange[] = targets.map((c) => ({
      date: c.delivery_date,
      tour_id: c.delivery_tour_id,
      product_id: c.product_id,
      quantity: 0,
    }));
    try {
      await saveMatrix.mutateAsync({ customerId, changes });
      toast.success(`Slettet ${changes.length} linjer`);
      setRemoveProdOpen(false);
    } catch (err) {
      toast.error("Kunne ikke slette", { description: (err as Error).message });
    }
  }

  async function handleMoveProduct(input: { productId: string; sourceTourId: string; targetTourId: string }) {
    if (!customerId || !matrix) return;
    const sourceCells = matrix.existing_cells.filter(
      (c) => c.product_id === input.productId && c.delivery_tour_id === input.sourceTourId,
    );
    if (sourceCells.length === 0) {
      toast.info("Ingen linjer å flytte.");
      return;
    }
    // Bygg én combined batch: 0 i kilde + qty i mål for samme dato. save_matrix_changes kjører i én transaksjon.
    const changes: MatrixChange[] = [];
    for (const c of sourceCells) {
      changes.push({ date: c.delivery_date, tour_id: input.sourceTourId, product_id: c.product_id, quantity: 0 });
      changes.push({ date: c.delivery_date, tour_id: input.targetTourId, product_id: c.product_id, quantity: Number(c.quantity), ...(c.merknad ? { merknad: c.merknad as Record<string, unknown> } : {}) });
    }
    try {
      await saveMatrix.mutateAsync({ customerId, changes });
      toast.success(`Flyttet ${sourceCells.length} linjer`);
      setMoveProdOpen(false);
    } catch (err) {
      toast.error("Kunne ikke flytte", { description: (err as Error).message });
    }
  }

  const [savingPause, setSavingPause] = useState(false);

  async function handleCreatePause(input: { from: string; to: string; reason: string; tourFilter: string[] | null }) {
    if (!customerId || !selectedCustomer) return;
    setSavingPause(true);
    try {
      const { error } = await supabase
        .from("delivery_pauses")
        .insert({
          legal_entity_id: (selectedCustomer as unknown as { legal_entity_id: string }).legal_entity_id,
          customer_id: customerId,
          pause_from: input.from,
          pause_to: input.to || null,
          reason: input.reason || null,
          tour_filter: input.tourFilter,
        });
      if (error) throw error;
      toast.success("Leveransepause opprettet");
      setPauseOpen(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["delivery-pauses"] }),
        qc.invalidateQueries({ queryKey: ["active-pauses"] }),
        qc.invalidateQueries({ queryKey: ["preview-delivery-rules"] }),
        qc.invalidateQueries({ queryKey: ["matrix"] }),
      ]);
    } catch (err) {
      toast.error("Kunne ikke opprette pause", { description: (err as Error).message });
    } finally {
      setSavingPause(false);
    }
  }

  const hasAddable = (addableProducts?.length ?? 0) > 0;
  const isEmptyMatrix = !!matrix && allProducts.length === 0;

  return (
    <div className="-mt-8 -mb-12 flex h-full flex-col bg-background">

      {/* Kompakt, sticky hovedverktøylinje. Legger seg rett under topbaren (72px)
          slik at filtrene alltid er tilgjengelige mens matrisen scrolles. */}
      <div className="sticky top-[72px] z-30 w-full bg-background/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-2">
        <div className="rounded-[14px] border border-brand-bronze/40 bg-gradient-to-br from-card to-brand-cream/20 px-3 py-2.5 shadow-sm ring-1 ring-inset ring-brand-bronze/10">
        <div className="flex flex-wrap items-center gap-2">

          <Button
            variant="outline"
            size="icon"
            disabled={!selectedCustomer}
            aria-label="Vis kundekort"
            title="Vis kundekort"
            className="border-2 border-brand-bronze/30 hover:border-brand-bronze/60"
            onClick={() => setCustomerCardOpen(true)}
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Dialog open={customerCardOpen} onOpenChange={setCustomerCardOpen}>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle className="font-display text-xl">
                  {selectedCustomer
                    ? `Kunde: ${selectedCustomer.customer_number} ${selectedCustomer.display_name}`
                    : "Kundekort"}
                </DialogTitle>
              </DialogHeader>
              {selectedCustomer ? (
                <Tabs defaultValue="info" className="w-full">
                  <TabsList className="flex w-full flex-wrap justify-start">
                    <TabsTrigger value="info">Navn, nummer og kontaktinfo</TabsTrigger>
                    <TabsTrigger value="addresses">Adresser</TabsTrigger>
                    <TabsTrigger value="invoice">Faktura- og betalingsinfo</TabsTrigger>
                    <TabsTrigger value="notes">Notater</TabsTrigger>
                  </TabsList>

                  <TabsContent value="info" className="mt-4 grid gap-4 sm:grid-cols-2">
                    <CardField label="Kundenummer" value={selectedCustomer.customer_number} mono />
                    <CardField label="Navn" value={selectedCustomer.display_name} />
                    <CardField label="Organisasjonsnummer" value={selectedCustomer.organization_number} mono />
                    <CardField label="Kontaktperson" value={selectedCustomer.primary_contact_name} />
                    <CardField label="E-post" value={selectedCustomer.primary_contact_email} />
                    <CardField label="Referanse" value={selectedCustomer.custom_reference} />
                    <CardField label="Status" value={selectedCustomer.status} />
                    {selectedCustomer.credit_hold && (
                      <div className="sm:col-span-2">
                        <Badge variant="destructive">
                          Kredittsperre{selectedCustomer.credit_hold_reason ? `: ${selectedCustomer.credit_hold_reason}` : ""}
                        </Badge>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="addresses" className="mt-4 space-y-4">
                    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Leveringsadresse
                      </div>
                      {selectedCustomer.delivery_address_line1 && <div>{selectedCustomer.delivery_address_line1}</div>}
                      {selectedCustomer.delivery_address_line2 && <div>{selectedCustomer.delivery_address_line2}</div>}
                      <div>
                        {[selectedCustomer.delivery_postal_code, selectedCustomer.delivery_city]
                          .filter(Boolean)
                          .join(" ") || <span className="text-muted-foreground">—</span>}
                      </div>
                      {selectedCustomer.delivery_country && (
                        <div className="text-muted-foreground">{selectedCustomer.delivery_country}</div>
                      )}
                    </div>
                    {selectedCustomer.delivery_instructions && (
                      <div className="rounded-md border border-brand-bronze/30 bg-brand-bronze/5 p-3 text-sm">
                        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-bronze">
                          Leveringsinstruks
                        </div>
                        {selectedCustomer.delivery_instructions}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="invoice" className="mt-4 grid gap-4 sm:grid-cols-2">
                    <CardField
                      label="Fakturamottaker (kunde-ID)"
                      value={selectedCustomer.invoice_recipient_customer_id}
                      mono
                    />
                    <CardField
                      label="Standard prisliste"
                      value={selectedCustomer.default_price_list_id}
                      mono
                    />
                    <CardField
                      label="Påkrevd referanse på faktura"
                      value={selectedCustomer.enforce_custom_reference ? "Ja" : "Nei"}
                    />
                  </TabsContent>

                  <TabsContent value="notes" className="mt-4">
                    <p className="text-sm text-muted-foreground">
                      Notater redigeres på det fulle kundekortet.
                    </p>
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="text-sm text-muted-foreground">Velg en kunde først.</div>
              )}
              <DialogFooter>
                {selectedCustomer && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCustomerCardOpen(false);
                      navigate(`/kunder/kundeliste/${selectedCustomer.id}`);
                    }}
                  >
                    Åpne full side
                  </Button>
                )}
                <Button onClick={() => setCustomerCardOpen(false)}>Lukk</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>


          <div className="flex flex-col items-start gap-1.5">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="min-w-[240px] justify-start border-2 border-brand-bronze/30 text-sm font-semibold shadow-sm hover:border-brand-bronze/60 lg:min-w-[300px]">
                  {selectedCustomer
                    ? `${selectedCustomer.customer_number} — ${selectedCustomer.display_name}`
                    : "Velg kunde …"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[420px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput placeholder="Søk kunde …" value={search} onValueChange={setSearch} />
                  <CommandList>
                    <CommandEmpty>Ingen treff</CommandEmpty>
                    <CommandGroup>
                      {(customers ?? []).map((c) => (
                        <CommandItem
                          key={c.id}
                          value={c.id}
                          onSelect={() => {
                            setCustomerId(c.id);
                            setPickerOpen(false);
                          }}
                        >
                          <span className="text-muted-foreground tabular-nums mr-2">{c.customer_number}</span>
                          <span className="truncate">{c.display_name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {existingSchedule && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRecurringDialogOpen(true)}
                title="Klikk for å redigere fastordre"
                className="h-8 gap-1.5 px-3 text-sm font-semibold"
              >
                <Repeat className="h-3.5 w-3.5" />
                Fastordre aktiv
              </Button>
            )}
          </div>


          <div className="relative flex w-full max-w-full flex-col gap-0.5 self-start sm:w-auto">
            <div className="flex flex-wrap items-center gap-1 rounded-md border border-brand-bronze/30 bg-card/60 px-2 py-1 text-sm">
              <Popover open={fromDateOpen} onOpenChange={setFromDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!customerId}
                    className="h-7 gap-1.5 px-2 text-xs font-medium"
                    aria-label="Ordre fra dato"
                  >
                    <CalendarIcon className="h-3.5 w-3.5" />
                    Ordre fra dato
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    locale={nb}
                    selected={new Date(dateFrom + "T12:00:00")}
                    onSelect={(d) => {
                      if (!d) return;
                      const iso = fmtDate(d, "yyyy-MM-dd");
                      setDateFrom(iso);
                      setDateTo(addDays(iso, Math.max(daysCount, 1) - 1));
                      setQuickFilter(null);
                      setFromDateOpen(false);
                    }}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => shiftWeek(-1)} aria-label="Forrige uke">
                <ChevronLeft />
              </Button>
              <div className="px-2 text-xs font-medium tabular-nums whitespace-nowrap">
                {formatRangeLabel(dateFrom, dateTo)}
              </div>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => shiftWeek(1)} aria-label="Neste uke">
                <ChevronRight />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={jumpToday}>
                Hopp til i dag
              </Button>
            </div>
            <div className="flex items-center gap-3 px-3 text-xs">
              {([
                ["today", "I morgen"],
                ["this_week", "Denne uken"],
                ["next_week", "Neste uke"],
              ] as const).map(([val, label]) => {
                const active = quickFilter === val;
                return (
                  <button
                    key={val}
                    type="button"
                    disabled={!customerId}
                    onClick={() => applyQuickFilter(val)}
                    className={cn(
                      "transition-colors hover:text-brand-bronze disabled:opacity-50 disabled:hover:text-current",
                      active ? "font-semibold text-brand-bronze" : "text-muted-foreground",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>


          <div className="flex items-center gap-2 rounded-md border border-brand-bronze/30 bg-card/60 px-2 py-1 text-sm">
            <span className="text-muted-foreground">vis</span>
            <Select
              value={String(daysCount)}
              onValueChange={(v) => setDaysCount(parseInt(v, 10))}
              disabled={!customerId}
            >
              <SelectTrigger className="h-7 w-16 px-2 text-center tabular-nums">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground">dager</span>
          </div>

          <div className="flex items-center gap-2 rounded-md border border-brand-bronze/30 bg-card/60 px-2 py-1 text-sm">
            <span className="text-muted-foreground">vis turer</span>
            <div className="flex items-center gap-1">
              {(matrix?.tours ?? []).map((t) => {
                const checked = !hiddenTourIds.has(t.id);
                return (
                  <Button
                    key={t.id}
                    type="button"
                    size="sm"
                    variant={checked ? "brand" : "outline"}
                    className="h-7 px-2 text-xs tabular-nums"
                    onClick={() => {
                      setHiddenTourIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(t.id)) next.delete(t.id);
                        else next.add(t.id);
                        return next;
                      });
                    }}
                    title={t.display_name}
                  >
                    {checked ? "☑" : "☐"} {t.tour_number}
                  </Button>
                );
              })}
              {(matrix?.tours ?? []).length === 0 && (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          </div>

          <Button
            variant="brand"
            size="sm"
            disabled={!customerId}
            onClick={() => navigate(`/ordre/ordrer/ny?customer_id=${customerId}`)}
          >
            <Plus className="h-4 w-4" />
            Ny ordre
          </Button>

          <div className="ml-auto flex items-center gap-2">
            {(dirtyCount > 0 || addedProducts.length > 0) && (
              <>
                {dirtyCount > 0 && (
                  <Badge variant="secondary">{dirtyCount} endring{dirtyCount === 1 ? "" : "er"}</Badge>
                )}
                {addedProducts.length > 0 && (
                  <Badge variant="outline">+{addedProducts.length} ny rad{addedProducts.length === 1 ? "" : "er"}</Badge>
                )}
                <Button variant="ghost" size="sm" onClick={handleDiscardClick}>
                  <RotateCcw />
                  Forkast
                </Button>
              </>
            )}
            <Button onClick={handleSave} disabled={dirtyCount === 0 || saveMatrix.isPending || !canEdit}>
              {saveMatrix.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              Lagre
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={!customerId}>
                  Handling <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Opprette nytt</DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={!customerId}
                  onSelect={() => navigate(`/ordre/ordrer/ny?customer_id=${customerId}`)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Ny ordre
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    navigate(
                      customerId
                        ? `/ordre/kundeordrer?customerId=${customerId}`
                        : "/ordre/kundeordrer",
                    )
                  }
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Kundeordre
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!customerId}
                  onSelect={() => navigate(`/ordre/ordrer/ny?customer_id=${customerId}&is_return=true`)}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Lag ny returordre
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!customerId}
                  onSelect={() => setRecurringDialogOpen(true)}
                >
                  <Repeat className="h-4 w-4 mr-2" />
                  {existingSchedule ? "Rediger fastordre" : "Opprett fastordre"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Batch-operasjoner</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setSetForAllOpen(true)} disabled={!canEdit || allProducts.length === 0}>
                  <Copy className="h-4 w-4 mr-2" />
                  For alle dager
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); toggleShowAllProducts(); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Vis alle varer {showAllProducts ? "✓" : ""}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setRemoveProdOpen(true)} disabled={!canEdit || allProducts.length === 0}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Fjern produkt fra ordre
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMoveProdOpen(true)} disabled={!canEdit || allProducts.length === 0}>
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Flytt produkt mellom turer
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Kontekst</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setPauseOpen(true)} disabled={!canEdit}>
                  <PackageCheck className="h-4 w-4 mr-2" />
                  Leveransepause
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setCorrectionsOpen(true)}>
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Se korrigeringer
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Visning</DropdownMenuLabel>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setFlatView((v) => !v); }}>
                  <Grid3x3 className="h-4 w-4 mr-2" />
                  {flatView ? "Til matrise" : "Til enkel tabell"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled title="Ikke tilgjengelig">
                  Utsalgssteder
                </DropdownMenuItem>
                <DropdownMenuItem disabled title="Ikke tilgjengelig">
                  Importere ordre
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        </div>
      </div>

      {/* Innholdsområdet scroller ikke selv — matrisen har sin egen scroll-container. */}
      <div className="w-full flex-1 px-1 pt-3 sm:px-2">

        {!customerId ? (
          <div className="grid h-full place-items-center p-10 text-center text-muted-foreground">
            <div className="max-w-2xl">
              <Grid3x3 className="mx-auto mb-3 h-10 w-10 opacity-40" />
              <p className="font-medium text-foreground">Velg en kunde for å åpne matrisen</p>
              <p className="mt-1 text-sm">
                Du får da rader for hvert produkt kunden har bestilt før, og kolonner for hver
                (dato × aktiv tur) i den valgte uken.
              </p>
            </div>
          </div>
        ) : isMatrixError ? (
          <div className="mx-auto max-w-xl p-6">
            <QueryErrorState
              error={matrixError}
              scope="ordre:leveringskalender:matrise"
              onRetry={() => void refetchMatrix()}
              title="Kunne ikke hente matrisen"
            />
          </div>
        ) : isLoading ? (
          <div className="grid h-64 place-items-center text-muted-foreground">
            <Loader2 className="animate-spin" />
            <span className="sr-only">Laster matrisen</span>
          </div>
        ) : !matrix ? (
          <div className="mx-auto max-w-xl p-6">
            <QueryEmptyState
              title="Fant ingen matrisedata"
              description="Prøv en annen uke, eller last inn på nytt."
              action={
                <Button variant="outline" size="sm" onClick={() => void refetchMatrix()}>
                  Last inn på nytt
                </Button>
              }
            />
          </div>
        ) : columns.length === 0 ? (
          <div className="grid h-64 place-items-center p-6 text-center text-muted-foreground">
            <p>Ingen aktive turer denne uken.</p>
          </div>

        ) : isEmptyMatrix ? (
          <div className="grid h-full place-items-center p-10 text-center">
            <div className="max-w-md">
              <Plus className="mx-auto mb-3 h-10 w-10 text-muted-foreground opacity-40" />
              <p className="font-medium text-foreground">Ingen ordrehistorikk for denne kunden</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Legg til produkter for å bygge opp kundens matrise. Produkter kunden bestiller
                vises automatisk neste gang.
              </p>
              <Button className="mt-4" onClick={() => setAddOpen(true)} disabled={!hasAddable || !canEdit}>
                <Plus />
                Legg til produkt for å starte
              </Button>
            </div>
          </div>
        ) : flatView && matrix ? (
          <div className="space-y-4 p-1">
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card p-1.5">
              <button
                type="button"
                onClick={() => setFlatDayFilter(null)}
                className={
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                  (flatDayFilter === null
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-muted")
                }
              >
                Hele uken
              </button>
              {days.map((d) => {
                const dt = new Date(d + "T12:00:00");
                const wd = ["Søn", "Man", "Tir", "Ons", "Tor", "Fre", "Lør"][dt.getDay()];
                const label = `${wd} ${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}`;
                const active = flatDayFilter === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setFlatDayFilter(d)}
                    className={
                      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors tabular-nums " +
                      (active
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground hover:bg-muted")
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <FlatLinesView
              rows={flatDayFilter ? flatRows.filter((r) => r.delivery_date === flatDayFilter) : flatRows}
              products={allProducts}
              tours={matrix.tours}
              onQuantityChange={(date, tour_id, product_id, value) =>
                setCellValue(`${date}|${tour_id ?? ""}|${product_id}` as CellKey, value)
              }
            />
          </div>
        ) : (
          /* Én tydelig horisontal scroll-container rundt hele matrisen (inkl. summer og legende). */
          <div className="w-full overflow-x-auto">
            <MatrixGrid

              columns={columns}
              products={allProducts}
              addedIds={new Set(addedProducts.map((p) => p.id))}
              getValue={getCellValue}
              isDirty={isDirty}
              isFallback={(key) => !!fallbackCells[key]}
              onChange={setCellValue}
              hasMerknad={(key) => !!existingMerknad[key]}
              hasData={(key) => getEffectiveQty(key) > 0 || !!existingMerknad[key]}
              onOpenMerknad={openMerknad}
              onCopyNextDay={handleCopyToNextDay}
              rowTotals={totals.rowTotals}
              colTotals={totals.colTotals}
              grandTotal={totals.grand}
              weatherMap={weatherMap}
              ghostMap={ghostMap}
              pauseMap={pauseMap}
              columnComments={columnComments}
              onColCopy={(date, tour) => setCopyColCol({ date, tour })}
              onColComment={(date, tour) => setCommentCol({ date, tour })}
              onColDelete={(date, tour) => setDeleteColConfirm({ date, tour })}
              onColPackingNote={(date, tour) => generatePackingNoteForColumn(date, tour)}
              colHasData={colHasAnyData}
              colMeta={colMeta}
              colTone={colTone}
              isGhostCell={isGhostCell}
              canEdit={canEdit}
              onOpenTourOrder={(date, tour) => {
                if (!colOrderId.has(`${date}|${tour.id}`)) {
                  toast.info("Fastordre", {
                    description:
                      "Skriv i cellene og lagre for å lage datert ordre.",
                  });
                  return;
                }
                setTourOrderCol({ date, tour });
              }}

              onOpenWeekEditor={(p) => setWeekEditorProduct(p)}
            />
            <div className="sticky left-0 flex flex-wrap items-center gap-2 border-t border-border bg-card px-4 py-3 sm:px-6">
              {hasAddable ? (
                <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} disabled={!canEdit}>
                  <Plus />
                  Legg til produkt
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Alle aktive produkter er i matrisen.</span>
              )}
              <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                <span className="font-medium uppercase tracking-wide text-muted-foreground/70">Forklaring:</span>
                <KindSwatch tokenVar={getKindMeta("dated").tokenVar} label="Datert" />
                <KindSwatch tokenVar={getKindMeta("fixed").tokenVar} label="Fastordre" />
                <KindSwatch tokenVar={getKindMeta("extra").tokenVar} label="Ekstraordre" />
                <KindSwatch tokenVar={getKindMeta("return").tokenVar} label="Retur" />
                <KindSwatch tokenVar="--lifecycle-delivery-note" label="Pakkseddel kjørt" />
                <LegendSwatch className="bg-sky-50 border-sky-300 dark:bg-sky-950/30 dark:border-sky-800" label="Leveringspause" />
                <LegendSwatch className="bg-warning/10 border-warning/40" label="Ulagret" />
                <span className="text-muted-foreground/70">
                  Fastordre er ordren. Skriver du i en gul kolonne, blir den en datert ordre for
                  den dagen.
                </span>
                <span className="text-muted-foreground/70">
                  Værvarsel fra Yr levert av Meteorologisk institutt og NRK · Historiske værdata
                  fra Open-Meteo (CC BY 4.0)
                </span>
              </div>

            </div>
          </div>

        )}
      </div>

      <ProductWeekEditor
        open={!!weekEditorProduct}
        onOpenChange={(v) => !v && setWeekEditorProduct(null)}
        product={weekEditorProduct}
        columns={columns}
        customerId={customerId}
        scheduleId={existingSchedule?.id ?? null}
        getValue={(date, tourId, productId) => getCellValue(ckey(date, tourId, productId))}
        getGhost={(date, tourId, productId) => ghostMap?.get(`${date}|${tourId}|${productId}`) ?? 0}
        onChange={(date, tourId, productId, value) =>
          setCellValue(ckey(date, tourId, productId), value)
        }
        onSaveWeek={handleSave}
        isSaving={saveMatrix.isPending}
        canEdit={canEdit}
      />

      <AddProductDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        customerId={customerId}
        onPick={handleAddProduct}
      />

      <TourOrderDialog
        open={!!tourOrderCol}
        onOpenChange={(v) => !v && setTourOrderCol(null)}
        customer={
          selectedCustomer
            ? {
                id: selectedCustomer.id,
                customer_number: selectedCustomer.customer_number,
                display_name: selectedCustomer.display_name,
              }
            : null
        }
        date={tourOrderCol?.date ?? null}
        tour={tourOrderCol?.tour ?? null}
        products={allProducts}
        canEdit={canEdit}
        onCreatePackingNote={
          tourOrderCol
            ? () => generatePackingNoteForColumn(tourOrderCol.date, tourOrderCol.tour)
            : undefined
        }
        onCopyOrder={
          tourOrderCol && canEdit
            ? () => setCopyColCol({ date: tourOrderCol.date, tour: tourOrderCol.tour })
            : undefined
        }
      />

      {merknadCell && labelProfileByProduct.get(merknadCell.productId) && (
        <MerknadDialog
          open={!!merknadCell}
          onOpenChange={(v) => {
            if (!v) setMerknadCell(null);
          }}
          productName={merknadCell.productName}
          quantity={merknadCell.quantity}
          profile={labelProfileByProduct.get(merknadCell.productId)!}
          initial={existingMerknad[ckey(merknadCell.date, merknadCell.tourId, merknadCell.productId)] ?? null}
          canEdit={canEdit}
          isSaving={saveMatrix.isPending}
          onSave={(m) => saveMerknadForCell(merknadCell, m)}
          onClear={() => saveMerknadForCell(merknadCell, null)}
        />
      )}

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kast endringer?</AlertDialogTitle>
            <AlertDialogDescription>
              {addedProducts.length > 0 && unsavedAddedCount > 0 ? (
                <>
                  {unsavedAddedCount} produkt{unsavedAddedCount === 1 ? "" : "er"} uten lagrede mengder vil bli fjernet fra matrisen.
                  {dirtyCount > 0 && <> {dirtyCount} celle-endring{dirtyCount === 1 ? "" : "er"} vil også gå tapt.</>}
                </>
              ) : (
                <>{dirtyCount} celle-endring{dirtyCount === 1 ? "" : "er"} vil gå tapt.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard}>Kast endringer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!copyConfirm} onOpenChange={(v) => !v && setCopyConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Overskrive eksisterende data i {copyConfirm ? formatDateNO(copyConfirm.targetDate) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Mål-cellen har allerede mengde og/eller merknad. Kopiering vil overskrive dette.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!copyConfirm) return;
                void executeCopy(
                  copyConfirm.source,
                  copyConfirm.targetDate,
                  copyConfirm.targetTourId,
                  copyConfirm.quantity,
                  copyConfirm.merknad,
                );
              }}
            >
              Overskriv
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {copyColCol && matrix && (
        <CopyColumnDialog
          open={!!copyColCol}
          onOpenChange={(v) => !v && setCopyColCol(null)}
          sourceDate={copyColCol.date}
          sourceTour={copyColCol.tour}
          visibleDates={visibleDatesArr}
          tours={matrix.tours}
          targetHasData={(d, t) => colHasAnyData(d, t)}
          onConfirm={(input) => executeColumnCopy(copyColCol, input)}
          isSaving={saveMatrix.isPending}
        />
      )}

      {commentCol && (
        <ColumnCommentDialog
          open={!!commentCol}
          onOpenChange={(v) => !v && setCommentCol(null)}
          date={commentCol.date}
          tourLabel={`T${commentCol.tour.tour_number} ${commentCol.tour.display_name}`}
          initial={columnComments?.get(`${commentCol.date}|${commentCol.tour.id}`) ?? ""}
          onSave={saveColumnComment}
          isSaving={upsertColumnComment.isPending}
        />
      )}

      <AlertDialog open={!!deleteColConfirm} onOpenChange={(v) => !v && setDeleteColConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slett alle ordrer for kolonnen?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteColConfirm && `${formatDateNO(deleteColConfirm.date)} · T${deleteColConfirm.tour.tour_number} ${deleteColConfirm.tour.display_name}. Dette kan ikke angres.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteColumn}>Slett</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SetForAllDaysDialog
        open={setForAllOpen}
        onOpenChange={setSetForAllOpen}
        products={allProducts}
        onConfirm={handleSetForAllDays}
        isSaving={saveMatrix.isPending}
      />
      <RemoveProductDialog
        open={removeProdOpen}
        onOpenChange={setRemoveProdOpen}
        products={allProducts}
        onConfirm={handleRemoveProduct}
        isSaving={saveMatrix.isPending}
      />
      <MoveProductDialog
        open={moveProdOpen}
        onOpenChange={setMoveProdOpen}
        products={allProducts}
        tours={matrix?.tours ?? []}
        onConfirm={handleMoveProduct}
        isSaving={saveMatrix.isPending}
      />
      <PauseDialog
        open={pauseOpen}
        onOpenChange={setPauseOpen}
        tours={matrix?.tours ?? []}
        defaultFrom={dateFrom}
        defaultTo={dateTo}
        onConfirm={handleCreatePause}
        isSaving={savingPause}
      />
      <CorrectionsDialog
        open={correctionsOpen}
        onOpenChange={setCorrectionsOpen}
        customerId={customerId}
        dateFrom={dateFrom}
        dateTo={dateTo}
      />
      <RecurringScheduleDialog
        open={recurringDialogOpen}
        onOpenChange={setRecurringDialogOpen}
        editing={existingSchedule}
        lockedCustomer={
          !existingSchedule && customerId && selectedCustomer
            ? {
                id: customerId,
                label: `${selectedCustomer.customer_number} — ${selectedCustomer.display_name}`,
              }
            : null
        }
        onSaved={() => {
          /* invalidert via hook */
        }}
      />
    </div>
  );
}

function formatDateNO(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return new Intl.DateTimeFormat("nb-NO", { weekday: "short", day: "2-digit", month: "short" }).format(d);
}

function formatRangeLabel(from: string, to: string): string {
  const f = new Date(from + "T12:00:00");
  const t = new Date(to + "T12:00:00");
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "short" }).format(d);
  if (from === to) {
    return new Intl.DateTimeFormat("nb-NO", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    }).format(f);
  }
  const week = getISOWeek(f);
  return `Uke ${week} · ${fmt(f)} – ${fmt(t)}`;
}

function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Bredde på den låste produktkolonnen i matrisen.
 * 240px er minimum for at produktnavn + hurtigknapper skal få plass uten klipping;
 * laptop får 280px og store skjermer 320px.
 */
const FIRST_COL_WIDTH =
  "w-[240px] min-w-[240px] lg:w-[280px] lg:min-w-[280px] xl:w-[320px] xl:min-w-[320px]";

function MatrixGrid({
  columns,
  products,
  addedIds,
  getValue,
  isDirty,
  isFallback,
  onChange,
  hasMerknad,
  hasData,
  onOpenMerknad,
  onCopyNextDay,
  rowTotals,
  colTotals,
  grandTotal,
  weatherMap,
  ghostMap,
  pauseMap,
  columnComments,
  onColCopy,
  onColComment,
  onColDelete,
  onColPackingNote,
  colHasData,
  colMeta,
  colTone,
  isGhostCell,

  canEdit,
  onOpenTourOrder,
  onOpenWeekEditor,
}: {
  columns: { date: string; tour: MatrixTour }[];
  products: MatrixProduct[];
  addedIds: Set<string>;
  getValue: (key: CellKey) => string;
  isDirty: (key: CellKey) => boolean;
  isFallback: (key: CellKey) => boolean;
  onChange: (key: CellKey, value: string) => void;
  hasMerknad: (key: CellKey) => boolean;
  hasData: (key: CellKey) => boolean;
  onOpenMerknad: (date: string, tour: MatrixTour, productId: string) => void;
  onCopyNextDay: (date: string, tour: MatrixTour, productId: string) => void;
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  grandTotal: number;
  weatherMap: WeatherMap | undefined;
  ghostMap: RecurringGhostMap | undefined;
  pauseMap: PauseMap | undefined;
  columnComments: Map<string, string> | undefined;
  onColCopy: (date: string, tour: MatrixTour) => void;
  onColComment: (date: string, tour: MatrixTour) => void;
  onColDelete: (date: string, tour: MatrixTour) => void;
  onColPackingNote: (date: string, tour: MatrixTour) => void;
  colHasData: (date: string, tourId: string) => boolean;
  colMeta: (date: string, tourId: string) => { order_kind?: string; lifecycle?: string; delivery_note_number?: string | null } | undefined;
  colTone: (date: string, tourId: string) => ColumnTone;
  isGhostCell: (key: CellKey) => boolean;

  canEdit: boolean;
  onOpenTourOrder: (date: string, tour: MatrixTour) => void;
  onOpenWeekEditor: (product: MatrixProduct) => void;
}) {
  const [infoProduct, setInfoProduct] = useState<{
    id: string;
    name: string;
    number: number | string | null;
    unit: string | null;
    price: number | null;
  } | null>(null);
  const dateGroups = useMemo(() => {
    const groups: { date: string; count: number }[] = [];
    for (const c of columns) {
      const last = groups[groups.length - 1];
      if (last && last.date === c.date) last.count++;
      else groups.push({ date: c.date, count: 1 });
    }
    return groups;
  }, [columns]);

  /** Antall-summer: per rad (uke) og per kolonne (dag × tur) — dempet, sekundær info. */
  const qtySums = useMemo(() => {
    const rows: Record<string, number> = {};
    const cols: Record<string, number> = {};
    for (const p of products) {
      let rowSum = 0;
      for (const c of columns) {
        const v = getValue(ckey(c.date, c.tour.id, p.id));
        const n = v ? Number(v.replace(",", ".")) || 0 : 0;
        if (!n) continue;
        rowSum += n;
        const k = `${c.date}|${c.tour.id}`;
        cols[k] = (cols[k] ?? 0) + n;
      }
      rows[p.id] = rowSum;
    }
    return { rows, cols };
  }, [columns, products, getValue]);

  return (
    <div className="min-w-max">
      <table className="border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20 bg-card">
          <tr>
            <th
              className={cn(
                "sticky left-0 z-30 border-b border-r border-border bg-card px-3 py-2 text-left",
                FIRST_COL_WIDTH,
              )}
              rowSpan={2}
            >
              Produkt
            </th>
            {dateGroups.map((g) => {
              const d = new Date(g.date + "T12:00:00");
              const dow = (d.getDay() === 0 ? 7 : d.getDay()) - 1;
              const isWeekend = dow >= 5;
              return (
                <th
                  key={g.date}
                  colSpan={g.count}
                  className={cn(
                    "border-b border-r border-border px-2 py-1 text-center text-xs font-semibold",
                    isWeekend ? "bg-muted/60" : "bg-card",
                  )}
                >
                  <WeatherCell forecast={weatherMap?.get(g.date)} />
                  <div className="text-muted-foreground">{DAY_LABELS[dow]}</div>
                  <div className="tabular-nums">
                    {new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "2-digit" }).format(d)}
                  </div>
                </th>
              );
            })}
            <th
              rowSpan={2}
              className="border-b border-r border-border bg-card px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              Uke
            </th>
            <th
              rowSpan={2}
              className="border-b border-r border-border bg-card px-3 py-2 text-right text-xs font-semibold"
            >
              Sum kr
            </th>
          </tr>
          <tr>
            {columns.map((c) => {
              const pause = isPaused(pauseMap, c.date, c.tour.id);
              const hasComment = columnComments?.has(`${c.date}|${c.tour.id}`);
              const colHas = colHasData(c.date, c.tour.id);
              const tone = colTone(c.date, c.tour.id);
              const toneVar = tone.kind ? getKindMeta(tone.kind).tokenVar : null;
              const d = new Date(c.date + "T00:00:00");
              const dow = (d.getDay() + 6) % 7;
              const dayLabel = DAY_LABELS[dow];
              return (
                <th
                  key={`${c.date}-${c.tour.id}`}
                  data-order-kind={tone.kind ?? undefined}
                  className={cn(
                    "border-b border-r border-border px-1 py-1 text-center text-[11px] font-medium text-muted-foreground",
                    pause ? "bg-sky-100 dark:bg-sky-950/40" : "bg-card/80",
                  )}
                  style={
                    !pause && toneVar
                      ? { backgroundColor: `hsl(var(${toneVar}) / 0.16)` }
                      : undefined
                  }
                  title={`${c.tour.display_name} (${c.tour.time_from.slice(0, 5)}–${c.tour.time_to.slice(0, 5)})${pause?.reason ? ` · Pause: ${pause.reason}` : pause ? " · Pause" : ""}${hasComment ? `\nKommentar: ${columnComments?.get(`${c.date}|${c.tour.id}`)}` : ""}`}
                >
                  {tone.deliveryNote && (
                    <div
                      className="-mx-1 -mt-1 mb-1 truncate px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white"
                      style={{ backgroundColor: "hsl(var(--lifecycle-delivery-note))" }}
                    >
                      Pakkseddel{tone.deliveryNoteNumber ? ` ${tone.deliveryNoteNumber}` : ""}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenTourOrder(c.date, c.tour)}
                    className="mx-auto block rounded px-1.5 py-0.5 text-[12px] font-semibold text-foreground hover:bg-primary/10 hover:text-primary"
                    title={colHas ? "Åpne ordre for denne turen" : "Fastordre — skriv i cellene og lagre"}
                  >
                    {dayLabel} ({c.tour.tour_number})
                    {hasComment && <span className="ml-1 text-primary">•</span>}
                  </button>

                  {(() => {
                    const meta = colMeta(c.date, c.tour.id);
                    if (!meta) return null;
                    return (
                      <div className="mt-0.5 flex flex-wrap items-center justify-center gap-1">
                        {meta.order_kind ? (
                          <OrderKindBadge kind={meta.order_kind as never} size="sm" />
                        ) : null}
                        {meta.lifecycle ? (
                          <LifecycleBadge
                            lifecycle={meta.lifecycle as never}
                            deliveryNoteNumber={meta.delivery_note_number}
                            size="sm"
                          />
                        ) : null}
                      </div>
                    );
                  })()}
                  {pause && (
                    <div className="mt-0.5 inline-block rounded-sm bg-sky-200/80 px-1 text-[9px] font-semibold uppercase tracking-wide text-sky-900 dark:bg-sky-800/60 dark:text-sky-100">
                      Pause
                    </div>
                  )}
                  <div className="mt-1 flex items-center justify-center gap-1.5">
                    <button type="button" disabled={!canEdit || !colHas} onClick={() => onColCopy(c.date, c.tour)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30" title="Kopier kolonne">
                      <Copy className="h-4 w-4" />
                    </button>
                    <button type="button" disabled={!canEdit || !colHas} onClick={() => onColDelete(c.date, c.tour)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30" title="Slett kolonne">
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button type="button" disabled={!colHas} onClick={() => onColPackingNote(c.date, c.tour)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30" title="Lag pakkseddel">
                      <PackageCheck className="h-4 w-4" />
                    </button>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const isAdded = addedIds.has(p.id);
            return (
              <tr key={p.id} className="hover:bg-muted/30">
                <th
                  scope="row"
                  className={cn(
                    "sticky left-0 z-10 border-b border-r border-border px-3 py-1.5 text-left font-normal",
                    FIRST_COL_WIDTH,
                    isAdded ? "bg-accent/30" : "bg-card",
                  )}
                >
                  <div className="flex items-stretch gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setInfoProduct({
                          id: p.id,
                          name: p.display_name,
                          number: p.display_number,
                          unit: p.sales_unit,
                          price: p.unit_price ?? null,
                        })
                      }
                      className="inline-flex w-9 shrink-0 items-center justify-center self-stretch rounded-md border border-brand-bronze/40 bg-brand-bronze/10 text-brand-bronze shadow-sm transition-colors hover:border-brand-bronze hover:bg-brand-bronze hover:text-brand-ink"
                      title="Produkthåndbok"
                      aria-label={`Produkthåndbok for ${p.display_name}`}
                    >
                      <BookOpen className="h-5 w-5" strokeWidth={2.25} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onOpenWeekEditor(p)}
                        title="Klikk for å redigere hele uken for denne varen"
                        className="flex w-full items-center gap-1.5 truncate text-left font-medium hover:text-primary"
                      >
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          {p.display_number}
                        </span>
                        <span className="truncate">{p.display_name}</span>
                        {isAdded && (
                          <Badge variant="outline" className="ml-1 text-[10px]">Ny</Badge>
                        )}
                      </button>
                      <div className="text-[11px] text-muted-foreground">
                        {p.sales_unit} ·{" "}
                        {p.unit_price == null ? (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help text-muted-foreground/70">—</span>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-xs text-xs">
                                Ingen pris for denne kunden på valgt dato. Pris må settes i Varer-appen før ordren kan lagres.
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          formatNOK(p.unit_price)
                        )}
                      </div>
                    </div>
                  </div>
                </th>
                {columns.map((c) => {
                  const key = ckey(c.date, c.tour.id, p.id);
                  const value = getValue(key);
                  const dirty = isDirty(key);
                  const hasM = hasMerknad(key);
                  const cellHasData = hasData(key);
                  const pause = isPaused(pauseMap, c.date, c.tour.id);
                  const ghost = pause ? undefined : ghostMap?.get(key);
                  const fromFixed = isGhostCell(key);
                  const tone = colTone(c.date, c.tour.id);
                  const toneVar = tone.kind ? getKindMeta(tone.kind).tokenVar : null;
                  const effectiveQty = value ? Number(value.replace(",", ".") || 0) : 0;
                  const ghostOverridden = !!ghost && !fromFixed && !!value && effectiveQty !== ghost;
                  const fb = isFallback(key);
                  return (
                    <td
                      key={key}
                      data-order-kind={tone.kind ?? undefined}
                      data-from-fixed={fromFixed ? "true" : undefined}
                      className={cn(
                        "group relative border-b border-r border-border p-0",
                        pause && "bg-sky-50 dark:bg-sky-950/30",
                        dirty && "bg-warning/25",
                        fb && "outline outline-2 -outline-offset-2 outline-destructive/70",
                      )}
                      style={
                        !pause && !dirty && toneVar
                          ? { backgroundColor: `hsl(var(${toneVar}) / 0.07)` }
                          : undefined
                      }
                      title={
                        fb
                          ? "Pris ikke funnet — mangler prisliste-rad eller spesialpris"
                          : fromFixed
                            ? `Fra fastordre: ${ghost} stk — skriv over for å endre`
                            : ghost
                              ? ghostOverridden
                                ? `Fastordre: ${ghost} stk — overstyrt til ${effectiveQty}`
                                : `Fastordre: ${ghost} stk`
                          : pause
                            ? pause.reason ? `Leveransepause: ${pause.reason}` : "Leveransepause"
                            : undefined
                      }
                    >
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={value}
                        readOnly={!!pause}
                        onChange={(e) => {
                          if (pause) return;
                          onChange(key, e.target.value);
                        }}
                        onMouseDown={(e) => {
                          if (pause) {
                            e.preventDefault();
                            toast.info("Leveransepause", {
                              description: "Fjern pausen først om kunden likevel skal få leveranse.",
                            });
                          }
                        }}
                        className={cn(
                          "h-9 w-16 rounded-none border-0 bg-transparent px-1 text-center tabular-nums shadow-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0",
                          value && "text-base font-semibold text-foreground",
                          fromFixed && "italic text-muted-foreground",
                          dirty && "font-bold not-italic text-warning",
                          pause && "cursor-not-allowed",
                        )}
                      />
                      {hasM && (
                        <span
                          className="pointer-events-none absolute right-0.5 top-0.5 text-primary"
                          aria-label="Har merknad"
                          title="Har merknad"
                        >
                          <StickyNote className="h-2.5 w-2.5" />
                        </span>
                      )}
                      {cellHasData && !pause && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label="Celle-handlinger"
                              className="absolute bottom-0 right-0 hidden h-4 w-4 items-center justify-center rounded-tl-sm bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground group-hover:flex data-[state=open]:flex"
                            >
                              <MoreHorizontal className="h-3 w-3" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onSelect={() => onOpenMerknad(c.date, c.tour, p.id)}>
                              <StickyNote className="h-4 w-4 mr-2" />
                              Merknad
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onCopyNextDay(c.date, c.tour, p.id)}>
                              <ArrowRight className="h-4 w-4 mr-2" />
                              Kopier til neste dag
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  );
                })}
                <td className="border-b border-r border-border/60 bg-card px-2 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                  {qtySums.rows[p.id] || ""}
                </td>
                <td className="border-b border-r border-border bg-card px-3 py-1.5 text-right font-bold tabular-nums">
                  {formatKrNetto(rowTotals[p.id] ?? 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-muted/40">
            <th
              scope="row"
              className={cn(
                "sticky left-0 z-10 border-b border-r border-border bg-muted/40 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground",
                FIRST_COL_WIDTH,
              )}
            >
              Dagsum (antall)
            </th>
            {columns.map((c) => {
              const colKey = `${c.date}|${c.tour.id}`;
              return (
                <td
                  key={colKey}
                  className="border-b border-r border-border px-1 py-1.5 text-right text-xs tabular-nums text-muted-foreground"
                >
                  {qtySums.cols[colKey] || ""}
                </td>
              );
            })}
            <td className="border-b border-r border-border px-2 py-1.5 text-right text-xs font-medium tabular-nums text-muted-foreground">
              {Object.values(qtySums.rows).reduce((a, b) => a + b, 0) || ""}
            </td>
            <td className="border-b border-r border-border px-3 py-1.5" />
          </tr>
          <tr className="bg-muted">
            <th
              scope="row"
              className={cn(
                "sticky left-0 z-10 border-b border-r border-border bg-muted px-3 py-2 text-left font-bold",
                FIRST_COL_WIDTH,
              )}
            >
              Sum kr
            </th>
            {columns.map((c) => {
              const colKey = `${c.date}|${c.tour.id}`;
              return (
                <td
                  key={colKey}
                  className="border-b border-r border-border bg-muted px-1 py-2 text-right text-xs font-bold tabular-nums"
                >
                  {formatKrNetto(colTotals[colKey] ?? 0)}
                </td>
              );
            })}
            <td className="border-b border-r border-border bg-muted px-2 py-2" />
            <td className="border-b border-r border-border bg-muted px-3 py-2 text-right font-bold tabular-nums">
              {formatKrNetto(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
      <ProductInfoDialog
        productId={infoProduct?.id ?? null}
        productName={infoProduct?.name ?? ""}
        displayNumber={infoProduct?.number ?? null}
        salesUnit={infoProduct?.unit ?? null}
        unitPrice={infoProduct?.price ?? null}
        open={!!infoProduct}
        onClose={() => setInfoProduct(null)}
      />
    </div>
  );
}

/** "2026-09-02" → "02.09" */
function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "2-digit" }).format(
    new Date(iso + "T12:00:00"),
  );
}

/** Fargeprøve for kolonnefarge basert på ordretype-token. */
function KindSwatch({ tokenVar, label }: { tokenVar: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-3 w-3 rounded-sm"
        style={{
          backgroundColor: `hsl(var(${tokenVar}) / 0.14)`,
          boxShadow: `inset 0 0 0 1px hsl(var(${tokenVar}) / 0.55)`,
        }}
      />
      <span>{label}</span>
    </span>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-3 w-3 rounded-sm border", className)} />
      <span>{label}</span>
    </span>
  );
}

function CardField({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("rounded-md border border-border bg-muted/20 px-3 py-2 text-sm", mono && "tabular-nums")}>
        {value || <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}
