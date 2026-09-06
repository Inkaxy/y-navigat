import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Check, ChevronsUpDown, Keyboard, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import { QueryState } from "@/components/common/QueryState";
import { useReviewLines, type ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import { useFakturaerLegalEntities } from "@/fakturaer/hooks/useFakturaerLegalEntities";
import { useSuppliersFor } from "@/fakturaer/hooks/useSuppliersFor";
import { useInboxInvoices } from "@/fakturaer/hooks/useInboxInvoices";
import { useSupplierLinkContext } from "@/fakturaer/hooks/useSupplierLinkContext";
import { useMatchTolerancesByEntity } from "@/fakturaer/hooks/useMatchTolerances";
import { useFakturaer } from "@/fakturaer/context/FakturaerContext";
import { MatchDrawer } from "@/fakturaer/components/MatchDrawer";
import { CreateRawMaterialDialog } from "@/fakturaer/components/CreateRawMaterialDialog";
import { BulkCreateRawMaterialsDialog } from "@/fakturaer/components/BulkCreateRawMaterialsDialog";
import { LinkCreditNoteDialog } from "@/fakturaer/components/LinkCreditNoteDialog";
import { NotARawMaterialDialog } from "@/fakturaer/components/NotARawMaterialDialog";
import { SkuConflictDialog } from "@/fakturaer/components/SkuConflictDialog";
import { ConfirmReconcileDialog } from "@/fakturaer/components/ConfirmReconcileDialog";
import { InvoiceDocumentPanel } from "@/fakturaer/components/InvoiceDocumentPanel";
import { InboxInvoiceCard } from "@/fakturaer/components/inbox/InboxInvoiceCard";
import { QueueTable, REASON_LABELS, reasonsOf } from "@/fakturaer/components/inbox/QueueTable";
import { useIsMobile } from "@/hooks/use-mobile";
import { invalidateInvoice, invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import {
  acceptTopSuggestion,
  rematchLines,
  markNotApplicable,
  restoreLine,
  runAutoMatch,
  snapshotOf,
  unflagInvoice,
} from "@/fakturaer/lib/queueActions";
import { emptyQueueState, peekUndo, queueReducer } from "@/fakturaer/lib/queueReducer";
import { supabase } from "@/integrations/supabase/client";

type TabValue =
  | "all"
  | "unmatched"
  | "low_confidence"
  | "price_variance"
  | "price_increase"
  | "price_drop"
  | "uncertain_cost"
  | "unknown_package_size"
  | "sku_collision"
  | "no_baseline";

const TABS: { value: TabValue; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "unmatched", label: REASON_LABELS.unmatched },
  { value: "low_confidence", label: REASON_LABELS.low_confidence },
  { value: "price_variance", label: REASON_LABELS.price_variance },
  { value: "price_increase", label: REASON_LABELS.price_increase },
  { value: "price_drop", label: REASON_LABELS.price_drop },
  { value: "uncertain_cost", label: REASON_LABELS.uncertain_cost },
  { value: "unknown_package_size", label: REASON_LABELS.unknown_package_size },
  { value: "sku_collision", label: REASON_LABELS.sku_collision },
  { value: "no_baseline", label: REASON_LABELS.no_baseline },
];

const KNOWN_REASONS = TABS.filter((t) => t.value !== "all" && t.value !== "no_baseline").map((t) => t.value);

const LS_OPEN = "nbhub.faktura.docpanel.open";
const LS_SIZE = "nbhub.faktura.docpanel.size";

/** Hører linjen hjemme under fanen? review_reason kan inneholde flere årsaker. */
export function matchesTab(line: ReviewLineRow, tab: TabValue): boolean {
  if (tab === "all") return true;
  if (tab === "no_baseline") return line.variance_status === "no_baseline" && !!line.raw_material_id;
  const reasons = reasonsOf(line);
  if (reasons.includes(tab)) return true;
  // Ukjente årsaker samles under «Umatchet» slik at ingen linje forsvinner.
  if (tab === "unmatched" && line.requires_review && reasons.every((r) => !KNOWN_REASONS.includes(r as TabValue)))
    return true;
  return false;
}

/** Samme vakter som i Vareliste: ingen hurtigtaster mens brukeren skriver eller i dialog. */
function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  // En knapp med fokus skal bare svelge Enter og mellomrom — den er knappens
  // egen aktivering. Alle andre hurtigtaster skal fortsatt virke.
  if (el.closest("button") && (e.key === "Enter" || e.key === " ")) return true;
  if (el.closest('[role="combobox"], [role="dialog"], [role="menu"], [role="listbox"]')) return true;
  return false;
}

export default function FakturaerInboxPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const { canWrite, canReconcile } = useFakturaer();
  const [searchParams, setSearchParams] = useSearchParams();
  const onlyReady = searchParams.get("filter") === "klar";

  const { data: entities = [] } = useFakturaerLegalEntities();
  const [legalEntityId, setLegalEntityId] = useState<string>("all");
  const [supplierId, setSupplierId] = useState<string>("all");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [tab, setTab] = useState<TabValue>("all");

  const { data: suppliers = [] } = useSuppliersFor(legalEntityId === "all" ? null : legalEntityId);

  // Hver faktura vurderes mot sitt eget selskaps toleranser.
  const toleranceEntityIds = useMemo(
    () => (legalEntityId !== "all" ? [legalEntityId] : entities.map((e) => e.id)),
    [legalEntityId, entities],
  );
  // Toleransen slås opp per linje, mot linjens EGET selskap.
  const toleranceForEntity = useMatchTolerancesByEntity(toleranceEntityIds);

  const filters = useMemo(
    () => ({
      legalEntityId: legalEntityId === "all" ? null : legalEntityId,
      supplierId: supplierId === "all" ? null : supplierId,
    }),
    [legalEntityId, supplierId],
  );

  const invoicesQuery = useInboxInvoices({ ...filters, onlyReady }, toleranceForEntity);
  const invoices = useMemo(() => invoicesQuery.data ?? [], [invoicesQuery.data]);

  // Ekspandert faktura — innboksen viser linjene for én faktura om gangen.
  const [lineLimit, setLineLimit] = useState(200);
  const [expandedId, setExpandedId] = useState<string | null>(searchParams.get("faktura"));
  useEffect(() => {
    const wanted = searchParams.get("faktura");
    if (wanted) setExpandedId(wanted);
  }, [searchParams]);

  // Når et fakturakort er åpent henter vi bare den fakturaens linjer.
  // Listen over «alle linjer» har et tak slik at spørringen holder seg rask.
  const linesQuery = useReviewLines({
    ...filters,
    invoiceId: expandedId,
    onlyReady,
    limit: expandedId ? null : lineLimit,
  });
  const lines = useMemo(() => linesQuery.data?.rows ?? [], [linesQuery.data]);
  const hasMoreLines = !expandedId && !!linesQuery.data?.hasMore;

  const links = useSupplierLinkContext(invoices.map((i) => i.supplier_id));

  const visibleLines = useMemo(() => {
    const scoped = expandedId ? lines.filter((l) => l.invoice_id === expandedId) : lines;
    return scoped.filter((l) => matchesTab(l, tab));
  }, [lines, expandedId, tab]);

  const counts = useMemo(() => {
    const scoped = expandedId ? lines.filter((l) => l.invoice_id === expandedId) : lines;
    const c = {} as Record<TabValue, number>;
    TABS.forEach((t) => {
      c[t.value] = scoped.filter((l) => matchesTab(l, t.value)).length;
    });
    return c;
  }, [lines, expandedId]);

  // Kø-tilstand (aktiv linje + angre)
  const [queue, dispatch] = useReducer(queueReducer, emptyQueueState);
  useEffect(() => {
    dispatch({ type: "sync", ids: visibleLines.map((l) => l.id) });
  }, [visibleLines]);
  const activeLine = useMemo(() => visibleLines.find((l) => l.id === queue.activeId) ?? null, [visibleLines, queue.activeId]);
  const undoEntry = peekUndo(queue);

  // Valg for masse-handlinger
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedLines = useMemo(() => lines.filter((l) => selected[l.id]), [lines, selected]);
  const [bulkThreshold, setBulkThreshold] = useState("90");
  const [bulkBusy, setBulkBusy] = useState(false);

  // Dialoger
  const [dialogLine, setDialogLine] = useState<ReviewLineRow | null>(null);
  const [matchOpen, setMatchOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [notRmOpen, setNotRmOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [reconcileId, setReconcileId] = useState<string | null>(null);
  const [bulkCreateOpen, setBulkCreateOpen] = useState(false);
  const [creditNoteId, setCreditNoteId] = useState<string | null>(null);
  const [busyInvoice, setBusyInvoice] = useState<{ id: string; action: string } | null>(null);
  const anyDialogOpen =
    matchOpen || createOpen || notRmOpen || conflictOpen || !!reconcileId || bulkCreateOpen || !!creditNoteId;

  // Dokumentpanel
  const [docOpen, setDocOpen] = useState<boolean>(() => localStorage.getItem(LS_OPEN) === "1");
  const [docLineId, setDocLineId] = useState<string | null>(null);
  const [panelSize] = useState<number>(() => Number(localStorage.getItem(LS_SIZE)) || 42);
  useEffect(() => {
    localStorage.setItem(LS_OPEN, docOpen ? "1" : "0");
  }, [docOpen]);
  const docLine = useMemo(() => lines.find((l) => l.id === docLineId) ?? null, [lines, docLineId]);

  const openDialog = useCallback((action: "match" | "create" | "not_rm" | "conflict", line: ReviewLineRow) => {
    setDialogLine(line);
    setMatchOpen(action === "match");
    setCreateOpen(action === "create");
    setNotRmOpen(action === "not_rm");
    setConflictOpen(action === "conflict");
  }, []);

  const refresh = useCallback(
    (invoiceId?: string) => {
      invalidateInvoice(qc, invoiceId);
      invalidateRawMaterial(qc);
      void qc.invalidateQueries({ queryKey: ["fakturaer-inbox"] });
      void qc.invalidateQueries({ queryKey: ["invoice-supplier-links"] });
    },
    [qc],
  );

  // --- Linjehandlinger -----------------------------------------------------
  const busyRef = useRef(false);

  const doAccept = useCallback(
    async (line: ReviewLineRow) => {
      if (!canWrite || busyRef.current) return;
      busyRef.current = true;
      const snapshot = snapshotOf(line);
      try {
        const name = await acceptTopSuggestion(line);
        dispatch({ type: "resolved", id: line.id, snapshot, label: name });
        toast.success(`Koblet til ${name}`);
        refresh(line.invoice_id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Kunne ikke godta forslaget");
      } finally {
        busyRef.current = false;
      }
    },
    [canWrite, refresh],
  );

  const doNotApplicable = useCallback(
    async (line: ReviewLineRow) => {
      if (!canWrite || busyRef.current) return;
      busyRef.current = true;
      const snapshot = snapshotOf(line);
      try {
        await markNotApplicable(line);
        dispatch({ type: "resolved", id: line.id, snapshot, label: line.description ?? "linjen" });
        toast.success("Markert som ikke aktuell");
        refresh(line.invoice_id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Kunne ikke markere linjen");
      } finally {
        busyRef.current = false;
      }
    },
    [canWrite, refresh],
  );

  const doUndo = useCallback(async () => {
    const entry = peekUndo(queue);
    if (!entry || busyRef.current) return;
    busyRef.current = true;
    try {
      await restoreLine(entry.lineId, entry.snapshot);
      dispatch({ type: "undo" });
      toast.success(`Angret: ${entry.label}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke angre");
    } finally {
      busyRef.current = false;
    }
  }, [queue, refresh]);

  const acceptAllVisible = useCallback(
    async (minPct: number) => {
      if (!canWrite) return;
      const candidates = visibleLines.filter((l) => (l.suggestions?.[0]?.confidence ?? 0) >= minPct / 100);
      if (candidates.length === 0) {
        toast.info(`Ingen synlige linjer har forslag over ${minPct} %`);
        return;
      }
      setBulkBusy(true);
      let ok = 0;
      const failures: string[] = [];
      const accepted: Array<{ invoice_id: string; id: string }> = [];
      for (const line of candidates) {
        try {
          await acceptTopSuggestion(line, { skipRematch: true });
          accepted.push({ invoice_id: line.invoice_id, id: line.id });
          ok++;
        } catch (e) {
          failures.push(e instanceof Error ? e.message : "ukjent feil");
        }
      }
      // Én kjøring av matchemotoren for hele bunken, ikke én per linje.
      if (accepted.length > 0) await rematchLines(accepted);
      setBulkBusy(false);
      refresh();
      if (failures.length === 0) toast.success(`${ok} linjer godtatt`);
      else toast.warning(`${ok} godtatt, ${failures.length} feilet`);
    },
    [canWrite, visibleLines, refresh],
  );

  // --- Masse-handlinger ----------------------------------------------------
  async function bulkAcceptSelected() {
    const min = Number(bulkThreshold) / 100;
    const candidates = selectedLines.filter((l) => (l.suggestions?.[0]?.confidence ?? 0) >= min);
    if (candidates.length === 0) {
      toast.info(`Ingen av de valgte linjene har forslag over ${bulkThreshold} %`);
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    const accepted: Array<{ invoice_id: string; id: string }> = [];
    for (const line of candidates) {
      try {
        await acceptTopSuggestion(line, { skipRematch: true });
        accepted.push({ invoice_id: line.invoice_id, id: line.id });
        ok++;
      } catch {
        failed++;
      }
    }
    // Én kjøring av matchemotoren for hele bunken, ikke én per linje.
    if (accepted.length > 0) await rematchLines(accepted);
    setBulkBusy(false);
    setSelected({});
    refresh();
    const skipped = selectedLines.length - candidates.length;
    toast[failed ? "warning" : "success"](
      `${ok} godtatt${failed ? `, ${failed} feilet` : ""}${skipped ? `, ${skipped} under terskelen` : ""}`,
    );
  }

  async function bulkNotApplicable() {
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    for (const line of selectedLines) {
      try {
        await markNotApplicable(line);
        ok++;
      } catch {
        failed++;
      }
    }
    setBulkBusy(false);
    setSelected({});
    refresh();
    toast[failed ? "warning" : "success"](`${ok} markert som ikke aktuell${failed ? `, ${failed} feilet` : ""}`);
  }

  function bulkCreate() {
    if (selectedLines.length === 0) return;
    // Én dialog med én rad per valgt linje — alt opprettes i samme operasjon.
    setBulkCreateOpen(true);
  }

  // --- Fakturahandlinger ---------------------------------------------------
  async function invoiceAction(id: string, action: "match" | "fetch" | "unflag") {
    setBusyInvoice({ id, action });
    try {
      if (action === "match") {
        await runAutoMatch(id);
        toast.success("Auto-match kjørt");
      } else if (action === "unflag") {
        await unflagInvoice(id);
        toast.success("Flagget er fjernet");
      } else {
        // Kilden bestemmer hvem som kan hente linjene: Tripletex-import eller
        // uttrekk fra PDF-en. Det finnes ingen felles «hent linjer»-funksjon.
        // Bare Tripletex kan hente linjer automatisk. Andre kilder må
        // registrere linjene manuelt — knappen vises ikke for dem.
        const inv = invoices.find((i) => i.id === id);
        if (inv?.source !== "tripletex") throw new Error("Linjer kan bare hentes for Tripletex-fakturaer");
        const { error } = await supabase.functions.invoke("tripletex-import-invoice-lines", {
          body: { legal_entity_id: inv.legal_entity_id, invoice_id: id, limit: 1 },
        });
        if (error) throw new Error(error.message);
        toast.success("Linjer hentet");
      }
      refresh(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Handlingen feilet");
    } finally {
      setBusyInvoice(null);
    }
  }

  // --- Hurtigtaster --------------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && docOpen) {
        setDocOpen(false);
        return;
      }
      if (anyDialogOpen || shouldIgnoreShortcut(e)) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          dispatch({ type: "next" });
          break;
        case "ArrowUp":
          e.preventDefault();
          dispatch({ type: "prev" });
          break;
        case "Enter":
          e.preventDefault();
          if (e.shiftKey) void acceptAllVisible(90);
          else if (activeLine) void doAccept(activeLine);
          break;
        case "m":
        case "M":
          if (activeLine) {
            e.preventDefault();
            openDialog("match", activeLine);
          }
          break;
        case "n":
        case "N":
          if (activeLine) {
            e.preventDefault();
            openDialog("create", activeLine);
          }
          break;
        case "x":
        case "X":
          if (activeLine) {
            e.preventDefault();
            void doNotApplicable(activeLine);
          }
          break;
        case "u":
        case "U":
          e.preventDefault();
          void doUndo();
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeLine, anyDialogOpen, docOpen, doAccept, doNotApplicable, doUndo, acceptAllVisible, openDialog]);

  // Aktiv linje følger dokumentpanelet.
  useEffect(() => {
    if (docOpen && queue.activeId) setDocLineId(queue.activeId);
  }, [docOpen, queue.activeId]);

  const showDoc = useCallback((line: ReviewLineRow) => {
    setDocLineId(line.id);
    setDocOpen(true);
  }, []);

  // --- Render --------------------------------------------------------------
  const expandedInvoice = invoices.find((i) => i.id === expandedId) ?? null;

  const queueEl = (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList className="flex-wrap">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label} ({counts[t.value] ?? 0})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {selectedLines.length > 0 && (
        <Card className="flex flex-wrap items-center gap-3 border-primary/30 bg-primary/5 p-3">
          <span className="text-sm font-medium">{selectedLines.length} valgt</span>
          <Select value={bulkThreshold} onValueChange={setBulkThreshold}>
            <SelectTrigger className="w-[120px]" aria-label="Terskel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["70", "80", "90"].map((v) => (
                <SelectItem key={v} value={v}>
                  ≥ {v} %
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={!canWrite || bulkBusy} onClick={() => void bulkAcceptSelected()}>
            {bulkBusy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Godta valgte
          </Button>
          <Button size="sm" variant="outline" disabled={!canWrite || bulkBusy} onClick={() => void bulkNotApplicable()}>
            Marker ikke aktuell
          </Button>
          <Button size="sm" variant="outline" disabled={!canWrite || bulkBusy} onClick={bulkCreate}>
            Opprett råvarer for valgte
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected({})}>
            Nullstill valg
          </Button>
        </Card>
      )}

      <Card className="overflow-hidden">
        <QueryState
          scope="fakturaer:innboks-linjer"
          isLoading={linesQuery.isLoading}
          isError={linesQuery.isError}
          error={linesQuery.error}
          isEmpty={visibleLines.length === 0}
          emptyTitle={expandedInvoice ? "Ingen linjer å behandle på denne fakturaen" : "Ingenting her — godt jobbet!"}
          onRetry={() => void linesQuery.refetch()}
        >
          <QueueTable
            lines={visibleLines}
            links={links}
            toleranceFor={toleranceForEntity}
            activeLineId={queue.activeId}
            selected={selected}
            onToggleSelect={(id, v) => setSelected((s) => ({ ...s, [id]: v }))}
            onToggleSelectAll={(v) =>
              setSelected((s) => {
                const next = { ...s };
                visibleLines.forEach((l) => {
                  next[l.id] = v;
                });
                return next;
              })
            }
            onFocusLine={(l) => dispatch({ type: "focus", id: l.id })}
            onShowDocument={showDoc}
            onAction={openDialog}
            onAccept={(l) => void doAccept(l)}
            showInvoiceColumn={!expandedId}
            canWrite={canWrite}
          />
        </QueryState>
      </Card>

      {hasMoreLines && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setLineLimit((n) => n + 200)}>
            Vis flere linjer
          </Button>
        </div>
      )}
    </div>
  );

  const docPanel = docLine ? (
    <InvoiceDocumentPanel
      invoice={{
        invoice_number: docLine.invoice.invoice_number,
        invoice_date: docLine.invoice.invoice_date,
        supplier_name: docLine.invoice.supplier?.name ?? null,
        source_document_url: docLine.invoice.source_document_url,
        total_amount: docLine.invoice.total_amount,
        total_vat: docLine.invoice.total_vat,
        lines_sum_status: docLine.invoice.lines_sum_status,
        lines_sum_excl_vat: docLine.invoice.lines_sum_excl_vat,
        lines_sum_variance_pct: docLine.invoice.lines_sum_variance_pct,
        extraction_confidence: docLine.invoice.extraction_confidence,
      }}
      line={{
        description: docLine.description,
        supplier_sku: docLine.supplier_sku,
        quantity: docLine.quantity,
        unit: docLine.unit,
        unit_price: docLine.unit_price,
        total_amount: docLine.total_amount,
        package_size: docLine.package_size,
        package_unit: docLine.package_unit,
        count_per_package: docLine.count_per_package,
        price_per_base_unit: docLine.price_per_base_unit,
        expected_price_per_base_unit: docLine.expected_price_per_base_unit,
        price_variance_pct: docLine.price_variance_pct,
        matched_name: docLine.matched_raw_material?.name ?? null,
      }}
      tolerancePct={toleranceForEntity(docLine.invoice.legal_entity_id, docLine.matched_raw_material?.category ?? null)}
      onClose={() => setDocOpen(false)}
      className="h-full"
    />
  ) : null;

  const panelActive = docOpen && !!docPanel;

  return (
    <div className="space-y-5">
      <FakturaerHeaderBanner
        title="Fakturainnboks"
        subtitle="Fakturaer som trenger handling — match, avstem og lukk uten å bytte side"
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          {entities.length > 1 && (
            <Select
              value={legalEntityId}
              onValueChange={(v) => {
                setLegalEntityId(v);
                setSupplierId("all");
              }}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle selskaper</SelectItem>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Popover open={supplierOpen} onOpenChange={setSupplierOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                disabled={legalEntityId === "all" && entities.length > 1}
                className="w-[260px] justify-between font-normal"
              >
                <span className="truncate">
                  {supplierId === "all" ? "Alle leverandører" : suppliers.find((s) => s.id === supplierId)?.name ?? "Leverandør"}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Søk leverandør…" />
                <CommandList>
                  <CommandEmpty>Ingen treff</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="Alle leverandører"
                      onSelect={() => {
                        setSupplierId("all");
                        setSupplierOpen(false);
                      }}
                    >
                      <Check className={supplierId === "all" ? "mr-2 h-4 w-4 opacity-100" : "mr-2 h-4 w-4 opacity-0"} />
                      Alle leverandører
                    </CommandItem>
                    {suppliers.map((s) => (
                      <CommandItem
                        key={s.id}
                        value={`${s.name} ${s.org_number ?? ""}`}
                        onSelect={() => {
                          setSupplierId(s.id);
                          setSupplierOpen(false);
                        }}
                      >
                        <Check className={supplierId === s.id ? "mr-2 h-4 w-4 opacity-100" : "mr-2 h-4 w-4 opacity-0"} />
                        <span className="truncate">{s.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Button
            size="sm"
            variant={onlyReady ? "default" : "outline"}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              if (onlyReady) next.delete("filter");
              else next.set("filter", "klar");
              setSearchParams(next, { replace: true });
            }}
          >
            Klar for prismatch
          </Button>

          {undoEntry && (
            <Button size="sm" variant="ghost" onClick={() => void doUndo()} className="gap-1.5">
              <Undo2 className="h-3.5 w-3.5" /> Angre «{undoEntry.label}»
            </Button>
          )}

          <span className="ml-auto text-sm text-ink-secondary">
            {invoices.length} fakturaer · {lines.length} linjer til behandling
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-subtle pt-3 text-xs text-ink-secondary">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Keyboard className="h-3.5 w-3.5" /> Hurtigtaster
          </span>
          <span>↑ / ↓ marker</span>
          <span>Enter godta og neste</span>
          <span>Shift+Enter godta alle ≥ 90 %</span>
          <span>m match</span>
          <span>n ny råvare</span>
          <span>x ikke aktuell</span>
          <span>u angre</span>
        </div>
      </Card>

      <QueryState
        scope="fakturaer:innboks"
        isLoading={invoicesQuery.isLoading}
        isError={invoicesQuery.isError}
        error={invoicesQuery.error}
        isEmpty={invoices.length === 0}
        emptyTitle="Ingen fakturaer trenger handling akkurat nå"
        onRetry={() => void invoicesQuery.refetch()}
      >
        <div className="space-y-2">
          {invoices.map((inv) => (
            <div key={inv.id} className="space-y-2">
              <InboxInvoiceCard
                invoice={inv}
                expanded={expandedId === inv.id}
                canWrite={canWrite}
                canReconcile={canReconcile}
                busyAction={busyInvoice?.id === inv.id ? busyInvoice.action : null}
                onToggle={() => setExpandedId((cur) => (cur === inv.id ? null : inv.id))}
                onFetchLines={() => void invoiceAction(inv.id, "fetch")}
                onRegisterLines={() => navigate(`/ravarer/fakturaer/${inv.id}/registrer-linjer`)}
                onRunMatch={() => void invoiceAction(inv.id, "match")}
                onUnflag={() => void invoiceAction(inv.id, "unflag")}
                onLinkCreditNote={() => setCreditNoteId(inv.id)}
                onReconcile={() => setReconcileId(inv.id)}
                onOpen={() => navigate(`/ravarer/fakturaer/${inv.id}`)}
              />
              {expandedId === inv.id && <div className="pl-4">{queueEl}</div>}
            </div>
          ))}
        </div>
      </QueryState>

      {!expandedId && (
        <>
          <h2 className="text-title">Alle linjer til behandling</h2>
          {panelActive && !isMobile ? (
            <ResizablePanelGroup
              direction="horizontal"
              className="items-stretch"
              onLayout={(sizes) => {
                if (sizes[1]) localStorage.setItem(LS_SIZE, String(Math.round(sizes[1])));
              }}
            >
              <ResizablePanel defaultSize={100 - panelSize} minSize={35}>
                <div className="pr-3">{queueEl}</div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={panelSize} minSize={30} maxSize={65}>
                <div className="sticky top-4 h-[calc(100vh-8rem)] pl-3">{docPanel}</div>
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            queueEl
          )}
        </>
      )}

      {panelActive && isMobile && (
        <Sheet
          open
          onOpenChange={(v) => {
            if (!v) setDocOpen(false);
          }}
        >
          <SheetContent side="bottom" className="h-[95vh] p-0">
            {docPanel}
          </SheetContent>
        </Sheet>
      )}

      <MatchDrawer
        open={matchOpen}
        onOpenChange={setMatchOpen}
        line={dialogLine}
        onAcceptedNext={() => {
          if (dialogLine) dispatch({ type: "resolved", id: dialogLine.id, snapshot: snapshotOf(dialogLine), label: dialogLine.description ?? "linjen" });
          // Neste linje i køen — ikke tilbake til den første.
          const idx = dialogLine ? queue.ids.indexOf(dialogLine.id) : -1;
          const nextId = queue.ids.slice(idx + 1).find((id) => id !== dialogLine?.id) ?? undefined;
          const next = visibleLines.find((l) => l.id === nextId) ?? null;
          setDialogLine(next);
          if (!next) setMatchOpen(false);
        }}
      />
      <CreateRawMaterialDialog open={createOpen} onOpenChange={setCreateOpen} line={dialogLine} />
      <BulkCreateRawMaterialsDialog
        open={bulkCreateOpen}
        onOpenChange={setBulkCreateOpen}
        lines={selectedLines}
        onDone={() => setSelected({})}
      />
      <LinkCreditNoteDialog
        open={!!creditNoteId}
        onOpenChange={(v) => {
          if (!v) setCreditNoteId(null);
        }}
        creditNote={(() => {
          const inv = invoices.find((i) => i.id === creditNoteId);
          return inv
            ? {
                id: inv.id,
                invoice_number: inv.invoice_number,
                supplier_id: inv.supplier_id,
                legal_entity_id: inv.legal_entity_id,
                notes: inv.notes,
              }
            : null;
        })()}
      />
      <NotARawMaterialDialog open={notRmOpen} onOpenChange={setNotRmOpen} line={dialogLine} />
      <SkuConflictDialog
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        line={dialogLine}
        onOpenMatchDrawer={() => setMatchOpen(true)}
      />

      {reconcileId && (
        <ConfirmReconcileDialog
          open
          onOpenChange={(v) => {
            if (!v) setReconcileId(null);
          }}
          invoiceId={reconcileId}
          invoiceNumber={invoices.find((i) => i.id === reconcileId)?.invoice_number ?? ""}
          reviewLineCount={invoices.find((i) => i.id === reconcileId)?.assessment.reviewCount ?? 0}
        />
      )}

      {onlyReady && invoices.length === 0 && (
        <Badge variant="outline">Ingen fakturaer står klare for prismatch</Badge>
      )}
    </div>
  );
}
