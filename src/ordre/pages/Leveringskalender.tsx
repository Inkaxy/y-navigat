import { useMemo, useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
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
import { useWeatherForecast, type WeatherMap } from "@/ordre/hooks/useWeatherForecast";
import { WeatherCell } from "@/ordre/components/orders/WeatherCell";
import { useRecurringGhost, type RecurringGhostMap } from "@/ordre/hooks/useRecurringGhost";
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

const DAY_LABELS = ["Ma", "Ti", "On", "To", "Fr", "Lø", "Sø"];

type CellKey = string; // `${date}|${tour_id}|${product_id}`

function ckey(date: string, tourId: string, productId: string): CellKey {
  return `${date}|${tourId}|${productId}`;
}

type CellTarget = {
  date: string;
  tourId: string;
  productId: string;
  productName: string;
  tourName: string;
  tourNumber: number;
  quantity: number;
};

export default function MatrixPage() {
  const { user } = useAuth();
  const { data: access } = useUserAccess(user);
  const canEdit = access?.hasOrdreWrite ?? false;

  const [customerId, setCustomerId] = useState<string | null>(null);

  // Date range driven by quick-filter chips OR by week navigation.
  const initialWeek = isoWeekMonday(todayISO());
  const [dateFrom, setDateFrom] = useState<string>(initialWeek);
  const [dateTo, setDateTo] = useState<string>(addDays(initialWeek, 6));
  const [quickFilter, setQuickFilter] = useState<QuickRange | null>("this_week");

  const [pickerOpen, setPickerOpen] = useState(false);
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
  const { data: matrix, isLoading } = useMatrixData(customerId, dateFrom, dateTo);
  const { data: addableProducts } = useAddableProducts(customerId, !!customerId);
  const saveMatrix = useSaveMatrix();
  const upsertColumnComment = useUpsertColumnComment();
  const deleteMatrixColumn = useDeleteMatrixColumn();
  const generateNotes = useGenerateDeliveryNotes();
  const navigate = useNavigate();
  const customerLat = selectedCustomer?.geocode_latitude ?? null;
  const customerLon = selectedCustomer?.geocode_longitude ?? null;
  const { data: weatherMap } = useWeatherForecast(customerLat, customerLon);
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

  // Handling-meny dialog state
  const [setForAllOpen, setSetForAllOpen] = useState(false);
  const [removeProdOpen, setRemoveProdOpen] = useState(false);
  const [moveProdOpen, setMoveProdOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const [flatView, setFlatView] = useState(false);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false);

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
        if (tourActiveOnDate(tour, date)) cols.push({ date, tour });
      }
    }
    return cols;
  }, [matrix, days]);

  const visibleDates = useMemo(() => new Set(columns.map((c) => c.date)), [columns]);

  const existingQty = useMemo(() => {
    const map: Record<CellKey, number> = {};
    if (!matrix) return map;
    for (const c of matrix.existing_cells) {
      if (!c.delivery_tour_id) continue;
      map[ckey(c.delivery_date, c.delivery_tour_id, c.product_id)] = Number(c.quantity);
    }
    return map;
  }, [matrix]);

  const existingMerknad = useMemo(() => {
    const map: Record<CellKey, Merknad> = {};
    if (!matrix) return map;
    for (const c of matrix.existing_cells) {
      if (!c.delivery_tour_id) continue;
      const m = parseMerknad(c.merknad);
      if (m) map[ckey(c.delivery_date, c.delivery_tour_id, c.product_id)] = m;
    }
    return map;
  }, [matrix]);

  /** Celler der lagret pris er 0 og mengde > 0 — visuell rød advarsel ("Pris ikke funnet"). */
  const fallbackCells = useMemo(() => {
    const map: Record<CellKey, true> = {};
    if (!matrix) return map;
    for (const c of matrix.existing_cells) {
      if (!c.delivery_tour_id) continue;
      if (Number(c.quantity) > 0 && Number(c.unit_price) === 0) {
        map[ckey(c.delivery_date, c.delivery_tour_id, c.product_id)] = true;
      }
    }
    return map;
  }, [matrix]);

  function getCellValue(key: CellKey): string {
    if (key in edits) return edits[key];
    const v = existingQty[key];
    return v ? String(v) : "";
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

  const dirtyChanges = useMemo<MatrixChange[]>(() => {
    const out: MatrixChange[] = [];
    for (const [key, raw] of Object.entries(edits)) {
      const [date, tour_id, product_id] = key.split("|");
      const editedNum = Number(raw || 0);
      const existing = existingQty[key] ?? 0;
      if (editedNum === existing) continue;
      out.push({ date, tour_id, product_id, quantity: editedNum });
    }
    return out;
  }, [edits, existingQty]);

  const dirtyCount = dirtyChanges.length;

  const unsavedAddedCount = useMemo(() => {
    return addedProducts.filter((p) => {
      return !dirtyChanges.some((c) => c.product_id === p.id && c.quantity > 0);
    }).length;
  }, [addedProducts, dirtyChanges]);

  // ----- Totals (net kr) -----
  // Per-cell value = qty * (product.unit_price ?? 0). Per-row sum, per-col sum, grand total.
  const totals = useMemo(() => {
    const rowTotals: Record<string, number> = {};
    const colTotals: Record<string, number> = {}; // key: `${date}|${tour_id}`
    let grand = 0;
    for (const p of allProducts) {
      const price = p.unit_price ?? 0;
      let rowSum = 0;
      for (const c of columns) {
        const key = ckey(c.date, c.tour.id, p.id);
        const qty = key in edits ? Number(edits[key] || 0) : existingQty[key] ?? 0;
        if (!qty || !price) continue;
        const amount = qty * price;
        rowSum += amount;
        const colKey = `${c.date}|${c.tour.id}`;
        colTotals[colKey] = (colTotals[colKey] ?? 0) + amount;
      }
      rowTotals[p.id] = rowSum;
      grand += rowSum;
    }
    // Dev-mode sanity check: row-sum total === col-sum total === grand
    if (import.meta.env.DEV) {
      const rowSumGrand = Object.values(rowTotals).reduce((a, b) => a + b, 0);
      const colSumGrand = Object.values(colTotals).reduce((a, b) => a + b, 0);
      console.assert(
        Math.abs(rowSumGrand - grand) < 0.005 && Math.abs(colSumGrand - grand) < 0.005,
        "[Matrix totals] row/col/grand mismatch",
        { rowSumGrand, colSumGrand, grand },
      );
    }
    return { rowTotals, colTotals, grand };
  }, [allProducts, columns, edits, existingQty]);

  async function handleSave() {
    if (!customerId || dirtyCount === 0) return;
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
      toast.success("Matrise lagret", {
        description: r
          ? `${r.orders_created ?? 0} nye ordre, ${r.lines_created ?? 0} linjer opprettet, ${r.lines_updated ?? 0} oppdatert, ${r.lines_deleted ?? 0} slettet${
              r.orders_deleted ? `, ${r.orders_deleted} tomme ordre fjernet` : ""
            }`
          : undefined,
      });
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
      mva_rate: 0,
      unit_price: p.unit_price,
      price_source: p.unit_price == null ? "none" : "default",
    };
    setAddedProducts((prev) => [...prev, newRow]);
  }

  function shiftWeek(delta: number) {
    // Manual nav clears chip selection but does NOT touch localStorage.
    setQuickFilter(null);
    const baseMon = isoWeekMonday(dateFrom);
    const newMon = addDays(baseMon, delta * 7);
    setDateFrom(newMon);
    setDateTo(addDays(newMon, 6));
  }

  function jumpToday() {
    setQuickFilter(null);
    const mon = isoWeekMonday(todayISO());
    setDateFrom(mon);
    setDateTo(addDays(mon, 6));
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
              mva_rate: 0,
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

  async function handleCreatePause(input: { from: string; to: string; reason: string; tourFilter: string[] | null }) {
    if (!customerId || !selectedCustomer) return;
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
      // Refresh
      void Promise.resolve();
    } catch (err) {
      toast.error("Kunne ikke opprette pause", { description: (err as Error).message });
    }
  }

  const hasAddable = (addableProducts?.length ?? 0) > 0;
  const isEmptyMatrix = !!matrix && allProducts.length === 0;
  const hasCustomerCoords = customerLat != null && customerLon != null;

  return (
    <div className="flex h-full flex-col bg-background">
      <AppBanner
        title="Leveringskalender"
        subtitle="Ukentlig ordre-inntasting per kunde — produkter × (dato, tur)"
        icon={Grid3x3}
      />

      <div className="px-page py-4">
        <div className="rounded-[14px] border border-brand-bronze/20 bg-card p-3 shadow-card ring-1 ring-inset ring-brand-cream/40">
        <div className="flex flex-wrap items-center gap-3">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="min-w-[280px] justify-start">
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

          <ToggleGroup
            type="single"
            value={quickFilter ?? ""}
            onValueChange={(v) => {
              if (v === "today" || v === "this_week" || v === "next_week") applyQuickFilter(v);
            }}
            disabled={!customerId}
          >
            <ToggleGroupItem value="today" size="sm" variant="outline" aria-label="I morgen">
              I morgen
            </ToggleGroupItem>
            <ToggleGroupItem value="this_week" size="sm" variant="outline" aria-label="Denne uken">
              Denne uken
            </ToggleGroupItem>
            <ToggleGroupItem value="next_week" size="sm" variant="outline" aria-label="Neste uke">
              Neste uke
            </ToggleGroupItem>
          </ToggleGroup>

          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => shiftWeek(-1)} aria-label="Forrige uke">
              <ChevronLeft />
            </Button>
            <div className="px-2 text-sm font-medium tabular-nums">
              {formatRangeLabel(dateFrom, dateTo)}
            </div>
            <Button variant="outline" size="icon" onClick={() => shiftWeek(1)} aria-label="Neste uke">
              <ChevronRight />
            </Button>
            <Button variant="ghost" size="sm" onClick={jumpToday}>
              Hopp til i dag
            </Button>
          </div>

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
                  disabled={!customerId}
                  onSelect={() => navigate(`/ordre/ordrer/ny?customer_id=${customerId}&is_return=true`)}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Lag ny returordre
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
                <DropdownMenuItem onSelect={() => navigate("/ordre/kundeordrer")}>
                  <Plus className="h-4 w-4 mr-2" />
                  Kundeordre
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Visning</DropdownMenuLabel>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setFlatView((v) => !v); }}>
                  <Grid3x3 className="h-4 w-4 mr-2" />
                  {flatView ? "Til matrise" : "Til enkel tabell"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled title="Kommer i senere fase">
                  Utsalgssteder
                </DropdownMenuItem>
                <DropdownMenuItem disabled title="Kommer i senere fase">
                  Importere ordre
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {!customerId ? (
          <div className="grid h-full place-items-center p-10 text-center text-muted-foreground">
            <div className="max-w-md">
              <Grid3x3 className="mx-auto mb-3 h-10 w-10 opacity-40" />
              <p className="font-medium text-foreground">Velg en kunde for å åpne matrisen</p>
              <p className="mt-1 text-sm">
                Du får da rader for hvert produkt kunden har bestilt før, og kolonner for hver
                (dato × aktiv tur) i den valgte uken.
              </p>
            </div>
          </div>
        ) : isLoading ? (
          <div className="grid h-64 place-items-center text-muted-foreground">
            <Loader2 className="animate-spin" />
          </div>
        ) : !matrix ? null : columns.length === 0 ? (
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
          <FlatLinesView cells={matrix.existing_cells} products={allProducts} tours={matrix.tours} />
        ) : (
          <>
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
              hasCustomerCoords={hasCustomerCoords}
              ghostMap={ghostMap}
              pauseMap={pauseMap}
              columnComments={columnComments}
              onColCopy={(date, tour) => setCopyColCol({ date, tour })}
              onColComment={(date, tour) => setCommentCol({ date, tour })}
              onColDelete={(date, tour) => setDeleteColConfirm({ date, tour })}
              onColPackingNote={(date, tour) => generatePackingNoteForColumn(date, tour)}
              colHasData={colHasAnyData}
              canEdit={canEdit}
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
                <LegendSwatch className="bg-warning/10 border-warning/40" label="Ulagret endring" />
                <LegendSwatch className="bg-sky-50 border-sky-300 dark:bg-sky-950/30 dark:border-sky-800" label="Leveringspause" />
                <LegendSwatch className="bg-accent/30 border-border" label="Lagt til produkt" />
                <LegendSwatch className="bg-muted/60 border-border" label="Helg" />
                <LegendSwatch className="bg-muted border-border" label="Sum-rad/kolonne" />
                <span className="text-muted-foreground/70">
                  Værvarsel fra Yr levert av Meteorologisk institutt og NRK
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      <AddProductDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        customerId={customerId}
        onPick={handleAddProduct}
      />

      {merknadCell && (
        <MerknadDialog
          open={!!merknadCell}
          onOpenChange={(v) => {
            if (!v) setMerknadCell(null);
          }}
          productName={merknadCell.productName}
          quantity={merknadCell.quantity}
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
        isSaving={false}
      />
      <CorrectionsDialog
        open={correctionsOpen}
        onOpenChange={setCorrectionsOpen}
        customerId={customerId}
        dateFrom={dateFrom}
        dateTo={dateTo}
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
  hasCustomerCoords,
  ghostMap,
  pauseMap,
  columnComments,
  onColCopy,
  onColComment,
  onColDelete,
  onColPackingNote,
  colHasData,
  canEdit,
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
  hasCustomerCoords: boolean;
  ghostMap: RecurringGhostMap | undefined;
  pauseMap: PauseMap | undefined;
  columnComments: Map<string, string> | undefined;
  onColCopy: (date: string, tour: MatrixTour) => void;
  onColComment: (date: string, tour: MatrixTour) => void;
  onColDelete: (date: string, tour: MatrixTour) => void;
  onColPackingNote: (date: string, tour: MatrixTour) => void;
  colHasData: (date: string, tourId: string) => boolean;
  canEdit: boolean;
}) {
  const dateGroups = useMemo(() => {
    const groups: { date: string; count: number }[] = [];
    for (const c of columns) {
      const last = groups[groups.length - 1];
      if (last && last.date === c.date) last.count++;
      else groups.push({ date: c.date, count: 1 });
    }
    return groups;
  }, [columns]);

  return (
    <div className="min-w-max">
      <table className="border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20 bg-card">
          <tr>
            <th
              className="sticky left-0 z-30 w-[320px] min-w-[320px] border-b border-r border-border bg-card px-3 py-2 text-left"
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
                  <WeatherCell
                    forecast={weatherMap?.get(g.date)}
                    emptyReason={!hasCustomerCoords ? "Kundens adresse mangler koordinater" : undefined}
                  />
                  <div className="text-muted-foreground">{DAY_LABELS[dow]}</div>
                  <div className="tabular-nums">
                    {new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "2-digit" }).format(d)}
                  </div>
                </th>
              );
            })}
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
              return (
                <th
                  key={`${c.date}-${c.tour.id}`}
                  className={cn(
                    "border-b border-r border-border px-1 py-1 text-center text-[11px] font-medium text-muted-foreground",
                    pause ? "bg-sky-100 dark:bg-sky-950/40" : "bg-card/80",
                  )}
                  title={`${c.tour.display_name} (${c.tour.time_from.slice(0, 5)}–${c.tour.time_to.slice(0, 5)})${pause?.reason ? ` · Pause: ${pause.reason}` : pause ? " · Pause" : ""}${hasComment ? `\nKommentar: ${columnComments?.get(`${c.date}|${c.tour.id}`)}` : ""}`}
                >
                  <div>T{c.tour.tour_number}</div>
                  {pause && (
                    <div className="mt-0.5 inline-block rounded-sm bg-sky-200/80 px-1 text-[9px] font-semibold uppercase tracking-wide text-sky-900 dark:bg-sky-800/60 dark:text-sky-100">
                      Pause
                    </div>
                  )}
                  <div className="mt-1 flex items-center justify-center gap-0.5">
                    <button type="button" disabled={!canEdit || !colHas} onClick={() => onColCopy(c.date, c.tour)} className="rounded p-0.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground disabled:opacity-30" title="Kopier kolonne">
                      <Copy className="h-3 w-3" />
                    </button>
                    <button type="button" disabled={!canEdit} onClick={() => onColComment(c.date, c.tour)} className={cn("rounded p-0.5 hover:bg-accent disabled:opacity-30", hasComment ? "text-primary" : "text-muted-foreground/70 hover:text-foreground")} title={hasComment ? "Rediger kommentar" : "Legg til kommentar"}>
                      <MessageSquare className="h-3 w-3" />
                    </button>
                    <button type="button" disabled={!canEdit || !colHas} onClick={() => onColDelete(c.date, c.tour)} className="rounded p-0.5 text-muted-foreground/70 hover:bg-destructive/10 hover:text-destructive disabled:opacity-30" title="Slett kolonne">
                      <Trash2 className="h-3 w-3" />
                    </button>
                    <button type="button" disabled={!colHas} onClick={() => onColPackingNote(c.date, c.tour)} className="rounded p-0.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground disabled:opacity-30" title="Lag pakkseddel">
                      <PackageCheck className="h-3 w-3" />
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
                    "sticky left-0 z-10 w-[320px] min-w-[320px] border-b border-r border-border px-3 py-1.5 text-left font-normal",
                    isAdded ? "bg-accent/30" : "bg-card",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        <span className="text-muted-foreground tabular-nums mr-2">{p.display_number}</span>
                        {p.display_name}
                        {isAdded && (
                          <Badge variant="outline" className="ml-2 text-[10px]">Ny</Badge>
                        )}
                      </div>
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
                  const ghost = !value && !pause ? ghostMap?.get(key) : undefined;
                  const fb = isFallback(key);
                  return (
                    <td
                      key={key}
                      className={cn(
                        "group relative border-b border-r border-border p-0",
                        dirty && "bg-warning/10",
                        pause && "bg-sky-50 dark:bg-sky-950/30",
                        fb && "outline outline-2 -outline-offset-2 outline-destructive/70",
                      )}
                      title={
                        fb
                          ? "Pris ikke funnet — mangler prisliste-rad eller spesialpris"
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
                        placeholder={ghost ? String(ghost) : ""}
                        className={cn(
                          "h-9 w-16 rounded-none border-0 bg-transparent px-1 text-center tabular-nums shadow-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0",
                          dirty && "font-semibold text-warning-foreground",
                          pause && "cursor-not-allowed",
                          ghost && "placeholder:italic placeholder:text-muted-foreground/60",
                        )}
                      />
                      {ghost && !value && (
                        <span
                          className="pointer-events-none absolute inset-0 flex items-center justify-center"
                          title="Fastordre-forslag — klikk for å bekrefte"
                          aria-hidden
                        />
                      )}
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
                <td className="border-b border-r border-border bg-card px-3 py-1.5 text-right font-bold tabular-nums">
                  {formatKrNetto(rowTotals[p.id] ?? 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-muted">
            <th
              scope="row"
              className="sticky left-0 z-10 w-[320px] min-w-[320px] border-b border-r border-border bg-muted px-3 py-2 text-left font-bold"
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
            <td className="border-b border-r border-border bg-muted px-3 py-2 text-right font-bold tabular-nums">
              {formatKrNetto(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
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
