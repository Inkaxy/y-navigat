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
import { Check, ChevronsUpDown, Keyboard, Loader2, RotateCw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import { QueryState } from "@/components/common/QueryState";
import { useReviewLines, useReviewLineCounts, type ReviewLineRow, type ReviewLineCountRow } from "@/fakturaer/hooks/useReviewLines";
import { useFakturaerLegalEntities } from "@/fakturaer/hooks/useFakturaerLegalEntities";
import { useSuppliersFor } from "@/fakturaer/hooks/useSuppliersFor";
import { useCompany } from "@/hooks/useCompany";
import { resolveQueueEntityId } from "@/fakturaer/lib/queueEntity";
import { StartPriceDialog } from "@/fakturaer/components/StartPriceDialog";
import { START_PRICE_QUERY_KEYS, fetchStartPriceCandidates } from "@/fakturaer/lib/startPrice";
import { useInboxInvoices } from "@/fakturaer/hooks/useInboxInvoices";
import { useSupplierLinkContext } from "@/fakturaer/hooks/useSupplierLinkContext";
import { useMatchTolerancesByEntity } from "@/fakturaer/hooks/useMatchTolerances";
import { useFakturaer } from "@/fakturaer/context/FakturaerContext";
import { MatchDrawer } from "@/fakturaer/components/MatchDrawer";
import { BulkLinkDialog } from "@/fakturaer/components/BulkLinkDialog";
import { CreateRawMaterialDialog } from "@/fakturaer/components/CreateRawMaterialDialog";
import { BulkCreateRawMaterialsDialog } from "@/fakturaer/components/BulkCreateRawMaterialsDialog";
import { LinkCreditNoteDialog } from "@/fakturaer/components/LinkCreditNoteDialog";
import { NotARawMaterialDialog } from "@/fakturaer/components/NotARawMaterialDialog";
import { SkuConflictDialog } from "@/fakturaer/components/SkuConflictDialog";
import { ConfirmReconcileDialog } from "@/fakturaer/components/ConfirmReconcileDialog";
import { InvoiceDocumentPanel } from "@/fakturaer/components/InvoiceDocumentPanel";
import { InboxInvoiceCard } from "@/fakturaer/components/inbox/InboxInvoiceCard";
import { QueueTable } from "@/fakturaer/components/inbox/QueueTable";
import {
  GROUP_DESCRIPTIONS,
  GROUP_LABELS,
  REVIEW_GROUPS,
  matchesGroup,
  repeatCounts as computeRepeatCounts,
  sortQueue,
  type QueueSort,
  type ReviewGroup,
} from "@/fakturaer/lib/reviewReasons";
import { useIsMobile } from "@/hooks/use-mobile";
import { recalculateLines } from "@/fakturaer/lib/acceptMatch";

/** Kjører reberegningen på nytt for nøyaktig de linjene som står igjen. */
function retryRecalculation(invoiceId: string, lineIds: string[]): void {
  void (async () => {
    try {
      await recalculateLines(invoiceId, lineIds);
      toast.success("Prisen er regnet om");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reberegningen feilet fortsatt");
    }
  })();
}

/**
 * Varsler om linjer som er koblet, men der prisavviket ikke er regnet om.
 * Uten dette ville køen sett ferdig ut mens serveren fortsatt har arbeid igjen.
 */
function notifyPendingRecalculation(
  pending: Array<{ invoiceId: string; lineIds: string[]; message: string }>,
): void {
  if (pending.length === 0) return;
  const antall = pending.reduce((n, p) => n + p.lineIds.length, 0);
  toast.warning(`${antall} ${antall === 1 ? "linje er" : "linjer er"} koblet, men prisen er ikke regnet om`, {
    description: pending[0].message,
    duration: 15000,
    action: {
      label: "Prøv igjen",
      onClick: () => pending.forEach((p) => retryRecalculation(p.invoiceId, p.lineIds)),
    },
  });
}
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

type TabValue = "all" | ReviewGroup;

const TABS: { value: TabValue; label: string; hint: string }[] = [
  { value: "all", label: "Alle", hint: "Alle linjer som venter på en avklaring." },
  ...REVIEW_GROUPS.map((g) => ({ value: g as TabValue, label: GROUP_LABELS[g], hint: GROUP_DESCRIPTIONS[g] })),
];

const LS_OPEN = "nbhub.faktura.docpanel.open";
const LS_SIZE = "nbhub.faktura.docpanel.size";

const SORT_OPTIONS: { value: QueueSort; label: string }[] = [
  { value: "invoice_date", label: "Nyeste faktura først" },
  { value: "impact", label: "Størst kronepåvirkning først" },
  { value: "repeats", label: "Går oftest igjen først" },
];

/**
 * Hører linjen hjemme under fanen? En linje kan ha flere årsaker samtidig og
 * dukker da opp i alle de tilhørende gruppene. Årsaker vi ikke kjenner igjen
 * havner i «Ukjent årsak» — aldri skjult under «Ukjent vare».
 */
export function matchesTab(line: ReviewLineCountRow | ReviewLineRow, tab: TabValue): boolean {
  return matchesGroup(line, tab);
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
  const { data: company } = useCompany();
  const [supplierId, setSupplierId] = useState<string>("all");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [tab, setTab] = useState<TabValue>("all");

  // Ett firma: selskapet kommer fra useCompany, ikke fra en velger.
  const legalEntityId = useMemo(
    () => resolveQueueEntityId(company?.id, entities.map((e) => e.id)),
    [company?.id, entities],
  );

  const { data: suppliers = [] } = useSuppliersFor(legalEntityId);

  // Hver faktura vurderes mot sitt eget selskaps toleranser.
  const toleranceEntityIds = useMemo(
    () => (legalEntityId ? [legalEntityId] : entities.map((e) => e.id)),
    [legalEntityId, entities],
  );
  // Toleransen slås opp per linje, mot linjens EGET selskap.
  const toleranceForEntity = useMatchTolerancesByEntity(toleranceEntityIds);

  const filters = useMemo(
    () => ({
      legalEntityId,
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

  // Tellerne skal gjelde HELE køen, ikke bare de linjene som er hentet inn.
  const countsQuery = useReviewLineCounts({ ...filters, invoiceId: expandedId, onlyReady });
  const countRows = useMemo(() => countsQuery.data ?? [], [countsQuery.data]);

  // Gjentakelser telles over HELE køen — det er poenget med tallet.
  const repeats = useMemo(() => computeRepeatCounts(countRows), [countRows]);

  const [sort, setSort] = useState<QueueSort>("invoice_date");

  const visibleLines = useMemo(() => {
    const scoped = expandedId ? lines.filter((l) => l.invoice_id === expandedId) : lines;
    return sortQueue(scoped.filter((l) => matchesTab(l, tab)), sort, repeats);
  }, [lines, expandedId, tab, sort, repeats]);

  const counts = useMemo(() => {
    const c = {} as Record<TabValue, number>;
    TABS.forEach((t) => {
      c[t.value] = countRows.filter((l) => matchesTab(l, t.value)).length;
    });
    return c;
  }, [countRows]);

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
  const [bulkLink, setBulkLink] = useState<{ rmsId: string; name: string } | null>(null);
  const [creditNoteId, setCreditNoteId] = useState<string | null>(null);
  const [startPriceOpen, setStartPriceOpen] = useState(false);
  const [busyInvoice, setBusyInvoice] = useState<{ id: string; action: string } | null>(null);
  const [runAllProgress, setRunAllProgress] = useState<{ done: number; total: number } | null>(null);
  const anyDialogOpen =
    matchOpen || createOpen || notRmOpen || conflictOpen || !!reconcileId || bulkCreateOpen || !!creditNoteId || !!bulkLink ||
    startPriceOpen;

  // Dokumentpanel
  const [docOpen, setDocOpen] = useState<boolean>(() => localStorage.getItem(LS_OPEN) === "1");
  const [docLineId, setDocLineId] = useState<string | null>(null);
  const [panelSize] = useState<number>(() => Number(localStorage.getItem(LS_SIZE)) || 42);
  useEffect(() => {
    localStorage.setItem(LS_OPEN, docOpen ? "1" : "0");
  }, [docOpen]);
  const docLine = useMemo(() => lines.find((l) => l.id === docLineId) ?? null, [lines, docLineId]);

  const openDialog = useCallback(
    (action: "match" | "create" | "not_rm" | "conflict" | "start_price", line: ReviewLineRow) => {
      setDialogLine(line);
      setMatchOpen(action === "match");
      setCreateOpen(action === "create");
      setNotRmOpen(action === "not_rm");
      setConflictOpen(action === "conflict");
      setStartPriceOpen(action === "start_price");
    },
    [],
  );

  /**
   * Hvilke linjer som kvalifiserer til startpris avgjøres av serveren.
   * Klienten viser bare svaret — den regner aldri ut kvalifisering selv.
   */
  const startPriceCandidatesQuery = useQuery({
    queryKey: START_PRICE_QUERY_KEYS.candidates(legalEntityId, null),
    enabled: !!legalEntityId,
    staleTime: 60 * 1000,
    queryFn: () => fetchStartPriceCandidates(legalEntityId as string, null, 500),
  });
  const startPriceLineIds = useMemo(
    () => new Set((startPriceCandidatesQuery.data ?? []).map((c) => c.invoice_line_id)),
    [startPriceCandidatesQuery.data],
  );

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
        const { name, rmsId, lineIds, recalculationPending, recalculationError } = await acceptTopSuggestion(line);
        dispatch({ type: "resolved", id: line.id, snapshot, label: name });
        if (recalculationPending) {
          toast.warning(`Koblet til ${name}, men prisen er ikke regnet om`, {
            description: recalculationError ?? undefined,
            duration: 15000,
            action: { label: "Prøv igjen", onClick: () => retryRecalculation(line.invoice_id, lineIds) },
          });
        } else {
          toast.success(`Koblet til ${name}`);
        }
        refresh(line.invoice_id);
        // Tilby den samme koblingen på andre linjer — brukeren velger selv.
        if (rmsId) setBulkLink({ rmsId, name });
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
      const pending = accepted.length > 0 ? await rematchLines(accepted) : [];
      setBulkBusy(false);
      refresh();
      if (failures.length === 0) toast.success(`${ok} linjer godtatt`);
      else toast.warning(`${ok} godtatt, ${failures.length} feilet`);
      notifyPendingRecalculation(pending);
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
    const pending = accepted.length > 0 ? await rematchLines(accepted) : [];
    setBulkBusy(false);
    setSelected({});
    refresh();
    notifyPendingRecalculation(pending);
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

  /**
   * Kjører auto-match én faktura av gangen for alle fakturaene i lista.
   * Ingen faktura godkjennes, attesteres eller betales — kun matching kjøres.
   */
  async function runMatchOnAll() {
    const targets = invoices.filter((i) => i.status !== "flagged" && i.line_count > 0);
    if (targets.length === 0) {
      toast.info("Ingen fakturaer med linjer å behandle");
      return;
    }
    setRunAllProgress({ done: 0, total: targets.length });
    let ok = 0;
    const failed: string[] = [];
    for (const inv of targets) {
      try {
        await runAutoMatch(inv.id);
        ok++;
      } catch {
        failed.push(inv.invoice_number);
      }
      setRunAllProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
    setRunAllProgress(null);
    refresh();
    if (failed.length > 0) {
      toast.warning(`${ok} fakturaer behandlet, ${failed.length} feilet (${failed.slice(0, 3).join(", ")}${failed.length > 3 ? " m.fl." : ""})`);
    } else {
      toast.success(`${ok} fakturaer behandlet`);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
          <TabsList className="flex-wrap">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} title={t.hint}>
                {t.label} ({counts[t.value] ?? 0})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select value={sort} onValueChange={(v) => setSort(v as QueueSort)}>
          <SelectTrigger className="w-[240px]" aria-label="Sorter køen">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {countsQuery.isError && (
        <p className="text-caption text-destructive">
          Tellerne kunne ikke hentes — tallene i fanene kan være ufullstendige.
        </p>
      )}

      {hasMoreLines && sort === "impact" && (
        <p className="text-caption text-ink-secondary">
          Sorteringen etter kroner gjelder bare de {lines.length} linjene som er lastet inn — ikke hele køen. Øk antall
          linjer for å sortere over alt.
        </p>
      )}


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
            repeatCounts={repeats}
            startPriceLineIds={startPriceLineIds}
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
          <Popover open={supplierOpen} onOpenChange={setSupplierOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                disabled={!legalEntityId}
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

          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => void runMatchOnAll()}
            disabled={!!runAllProgress || invoices.length === 0}
          >
            {runAllProgress ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Behandler {runAllProgress.done}/{runAllProgress.total}
              </>
            ) : (
              <>
                <RotateCw className="h-3.5 w-3.5" /> Behandle alle
              </>
            )}
          </Button>

          {undoEntry && (
            <Button size="sm" variant="ghost" onClick={() => void doUndo()} className="gap-1.5">
              <Undo2 className="h-3.5 w-3.5" /> Angre «{undoEntry.label}»
            </Button>
          )}

          <span className="ml-auto text-sm text-ink-secondary">
            {invoices.length} fakturaer · {countRows.length} linjer til behandling
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
      <BulkLinkDialog
        open={!!bulkLink}
        onOpenChange={(v) => {
          if (!v) setBulkLink(null);
        }}
        rmsId={bulkLink?.rmsId ?? null}
        rawMaterialName={bulkLink?.name ?? ""}
      />
      <StartPriceDialog
        open={startPriceOpen}
        onOpenChange={setStartPriceOpen}
        invoiceLineId={dialogLine?.id ?? null}
        description={dialogLine?.description ?? null}
        rawMaterialName={dialogLine?.matched_raw_material?.name ?? null}
        supplierName={dialogLine?.invoice.supplier?.name ?? null}
        canWrite={canWrite}
      />
      <CreateRawMaterialDialog open={createOpen} onOpenChange={setCreateOpen} line={dialogLine} />
      <BulkCreateRawMaterialsDialog
        open={bulkCreateOpen}
        onOpenChange={setBulkCreateOpen}
        lines={selectedLines}
        onDone={() => setSelected({})}
        onPartial={(createdLineIds) => {
          // Bare de faktisk opprettede linjene fjernes fra utvalget — resten
          // står igjen slik at dialogen fortsatt viser utkastene som feilet.
          setSelected((s) => {
            const next = { ...s };
            for (const id of createdLineIds) delete next[id];
            return next;
          });
        }}
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
