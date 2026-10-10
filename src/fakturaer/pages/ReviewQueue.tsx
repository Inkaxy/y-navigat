import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import { QueueWorkspace } from "@/fakturaer/components/inbox/QueueWorkspace";
import { isBulkAcceptable, lineStatus } from "@/fakturaer/lib/lineStatus";
import { useReviewLines, useReviewLineCounts, type ReviewLineRow, type ReviewLineCountRow } from "@/fakturaer/hooks/useReviewLines";
import { useFakturaerLegalEntities } from "@/fakturaer/hooks/useFakturaerLegalEntities";
import { useSuppliersFor } from "@/fakturaer/hooks/useSuppliersFor";
import { useCompany } from "@/hooks/useCompany";
import { resolveQueueEntityId } from "@/fakturaer/lib/queueEntity";
import { StartPriceDialog } from "@/fakturaer/components/StartPriceDialog";
import { START_PRICE_QUERY_KEYS, fetchStartPriceCandidates } from "@/fakturaer/lib/startPrice";
import { useInboxInvoices, type InboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";
import { useSupplierLinkContext } from "@/fakturaer/hooks/useSupplierLinkContext";
import { useMatchTolerancesByEntity } from "@/fakturaer/hooks/useMatchTolerances";
import { useFakturaer } from "@/fakturaer/context/FakturaerContext";
import { MatchDrawer } from "@/fakturaer/components/MatchDrawer";
import { BulkLinkDialog } from "@/fakturaer/components/BulkLinkDialog";
import { handleQueueShortcut } from "@/fakturaer/lib/queueShortcuts";
import { notifyAccepted } from "@/fakturaer/lib/acceptNotice";
import { CreateRawMaterialDialog } from "@/fakturaer/components/CreateRawMaterialDialog";
import { BulkCreateRawMaterialsDialog } from "@/fakturaer/components/BulkCreateRawMaterialsDialog";
import { LinkCreditNoteDialog } from "@/fakturaer/components/LinkCreditNoteDialog";
import { NotARawMaterialDialog } from "@/fakturaer/components/NotARawMaterialDialog";
import { SkuConflictDialog } from "@/fakturaer/components/SkuConflictDialog";
import { ConfirmReconcileDialog } from "@/fakturaer/components/ConfirmReconcileDialog";
import { InvoiceDocumentPanel } from "@/fakturaer/components/InvoiceDocumentPanel";
import { InvoiceInbox, type BatchFailure } from "@/fakturaer/components/inbox/InvoiceInbox";
import { SimilarLinesHint } from "@/fakturaer/components/inbox/SimilarLinesHint";
import { FlagInvoiceDialog } from "@/fakturaer/components/FlagInvoiceDialog";
import type { InboxPrimaryAction, InboxTab } from "@/fakturaer/lib/inbox";
import { FocusHeader } from "@/fakturaer/components/inbox/FocusHeader";
import {
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
import { paths } from "@/ravarer/lib/paths";

type TabValue = "all" | ReviewGroup;

const LS_OPEN = "nbhub.faktura.docpanel.open";

/**
 * Hører linjen hjemme under årsaksfilteret? En linje kan ha flere årsaker samtidig og
 * dukker da opp i alle de tilhørende gruppene. Årsaker vi ikke kjenner igjen
 * havner i «Ukjent årsak» — aldri skjult under «Ukjent vare».
 */
export function matchesTab(line: ReviewLineCountRow | ReviewLineRow, tab: TabValue): boolean {
  return matchesGroup(line, tab);
}


export default function FakturaerInboxPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const { canWrite, canReconcile } = useFakturaer();
  const [searchParams, setSearchParams] = useSearchParams();
  // Fanene ligger i adressen. Linjekøen filtreres ikke lenger på «klar»-status.
  const onlyReady = false;
  const inboxTab: InboxTab =
    searchParams.get("innboks") === "klar" ? "ready" : searchParams.get("innboks") === "fullfort" ? "done" : "open";
  const setInboxTab = (t: InboxTab) => {
    const next = new URLSearchParams(searchParams);
    if (t === "open") next.delete("innboks");
    else next.set("innboks", t === "ready" ? "klar" : "fullfort");
    next.delete("filter");
    setSearchParams(next, { replace: true });
  };
  const [flagId, setFlagId] = useState<string | null>(null);
  const [lastLinked, setLastLinked] = useState<{ rmsId: string; name: string } | null>(null);

  const { data: entities = [] } = useFakturaerLegalEntities();
  const { data: company } = useCompany();
  const [supplierId, setSupplierId] = useState<string>("all");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [showGlobalLines, setShowGlobalLines] = useState(false);
  const [reason, setReason] = useState<TabValue>("all");

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

  const invoicesQuery = useInboxInvoices(filters);
  const invoices = useMemo(() => invoicesQuery.data ?? [], [invoicesQuery.data]);

  // Ekspandert faktura — innboksen viser linjene for én faktura om gangen.
  const [lineLimit, setLineLimit] = useState(200);
  // Valgt faktura ligger i adressen, så tilbakeknappen og delte lenker virker.
  const expandedId = searchParams.get("faktura");
  const openInvoice = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set("faktura", id);
      else next.delete("faktura");
      setSearchParams(next);
      window.scrollTo({ top: 0 });
    },
    [searchParams, setSearchParams],
  );

  // Når et fakturakort er åpent henter vi bare den fakturaens linjer.
  // Listen over «alle linjer» har et tak slik at spørringen holder seg rask.
  const linesQuery = useReviewLines({
    ...filters,
    invoiceId: expandedId,
    onlyReady,
    includeResolved: true,
    limit: expandedId ? null : lineLimit,
  });
  const lines = useMemo(() => linesQuery.data?.rows ?? [], [linesQuery.data]);
  const hasMoreLines = !expandedId && !!linesQuery.data?.hasMore;

  const links = useSupplierLinkContext(invoices.map((i) => i.supplier_id));

  // Tellerne skal gjelde HELE køen, ikke bare de linjene som er hentet inn.
  const countsQuery = useReviewLineCounts({ ...filters, invoiceId: expandedId, onlyReady, includeResolved: true });
  const countRows = useMemo(() => countsQuery.data ?? [], [countsQuery.data]);

  // Gjentakelser telles over HELE køen — det er poenget med tallet.
  const repeats = useMemo(() => computeRepeatCounts(countRows), [countRows]);

  const [sort, setSort] = useState<QueueSort>("invoice_date");
  const startPriceLineIdsRef = useRef<ReadonlySet<string>>(new Set());

  const statusOf = useCallback(
    (l: ReviewLineRow | ReviewLineCountRow) => lineStatus(l, startPriceLineIdsRef.current),
    [],
  );

  const visibleLines = useMemo(() => {
    const scoped = expandedId ? lines.filter((l) => l.invoice_id === expandedId) : lines;
    const filtered = scoped.filter(
      (l) => matchesTab(l, reason) && (showAll || statusOf(l).bucket === "needs"),
    );
    return sortQueue(filtered, sort, repeats);
  }, [lines, expandedId, reason, showAll, sort, repeats, statusOf]);

  const progress = useMemo(() => {
    if (!expandedId || countRows.length === 0) return null;
    let needs = 0;
    for (const l of countRows) if (statusOf(l).bucket === "needs") needs++;
    return { handled: countRows.length - needs, total: countRows.length, needs };
  }, [expandedId, countRows, statusOf]);

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
  const anyDialogOpen =
    matchOpen || createOpen || notRmOpen || conflictOpen || !!reconcileId || bulkCreateOpen || !!creditNoteId || !!bulkLink ||
    startPriceOpen;

  // Dokumentpanel
  const [docOpen, setDocOpen] = useState<boolean>(() => localStorage.getItem(LS_OPEN) === "1");
  const [docLineId, setDocLineId] = useState<string | null>(null);
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
  startPriceLineIdsRef.current = startPriceLineIds;

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
          notifyAccepted(name, rmsId ?? null, (id, n) => setBulkLink({ rmsId: id, name: n }));
        }
        refresh(line.invoice_id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Kunne ikke godta forslaget");
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

  // --- Masse-handlinger ----------------------------------------------------
  async function bulkAcceptSelected() {
    const candidates = selectedLines.filter(isBulkAcceptable);
    if (candidates.length === 0) {
      toast.info("Ingen av de valgte linjene har et forslag uten andre avvik");
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
      `${ok} godtatt${failed ? `, ${failed} feilet` : ""}${skipped ? `, ${skipped} må avklares enkeltvis` : ""}`,
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
   * Oppdaterer matchingen én faktura av gangen. Ingen faktura godkjennes,
   * fullføres eller betales — kun matchemotoren kjøres. Feil rapporteres per faktura.
   */
  async function batchMatch(targets: InboxInvoice[], onProgress: (done: number) => void): Promise<BatchFailure[]> {
    const failed: BatchFailure[] = [];
    let done = 0;
    for (const inv of targets) {
      try {
        await runAutoMatch(inv.id);
      } catch {
        failed.push({ id: inv.id, label: `${inv.supplier_name ?? "Ukjent"} ${inv.invoice_number}` });
      }
      done++;
      onProgress(done);
    }
    refresh();
    if (failed.length === 0) toast.success(`Matching oppdatert for ${targets.length} fakturaer`);
    return failed;
  }

  function primaryAction(inv: InboxInvoice, action: InboxPrimaryAction) {
    if (action === "fetch_lines") void invoiceAction(inv.id, "fetch");
    else if (action === "register_lines") navigate(paths.registrerLinjer(inv.id));
    else if (action === "link_credit_note") setCreditNoteId(inv.id);
    // «Se flagget» viser flagget og detaljene — fjerner det ALDRI.
    else if (action === "view_flag") navigate(paths.faktura(inv.id));
    else if (action === "finish") setReconcileId(inv.id);
    else openInvoice(inv.id);
  }

  // --- Hurtigtaster --------------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && docOpen) {
        setDocOpen(false);
        return;
      }
      handleQueueShortcut(e, {
        queueVisible: !!expandedId || showGlobalLines,
        dialogOpen: anyDialogOpen,
        activeLine,
        canAcceptWithEnter: (l) => !l.raw_material_id && statusOf(l).key === "confirm_material",
        next: () => dispatch({ type: "next" }),
        prev: () => dispatch({ type: "prev" }),
        accept: (l) => void doAccept(l),
        openDialog: (kind, l) => openDialog(kind, l),
        undo: () => void doUndo(),
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeLine, anyDialogOpen, docOpen, doAccept, doUndo, openDialog, statusOf, expandedId, showGlobalLines]);

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

  // Fullfør krever at HELE fakturaen er klar — også sum, kreditnota og uttrekk —
  // ikke bare at linjene i køen er avklart.
  const reconcileReady =
    !!expandedId && !!progress && progress.needs === 0 && canReconcile && !!expandedInvoice?.assessment.canReconcile;

  /**
   * Etter lagring: hent serverens tilstand. Står linjen fortsatt til avklaring
   * (pris, pakning, reberegning), blir den værende. Ellers går vi til neste
   * linje som trenger hjelp — aldri ved å regne en uferdig linje som ferdig.
   */
  const handleSaved = useCallback(
    async (lineId: string) => {
      const ids = queue.ids;
      const idx = ids.indexOf(lineId);
      const r = await linesQuery.refetch();
      void countsQuery.refetch();
      const rows = r.data?.rows ?? [];
      const needs = (id: string) => {
        const row = rows.find((x) => x.id === id);
        return !!row && statusOf(row).bucket === "needs";
      };
      if (needs(lineId)) return;
      const nextId = [...ids.slice(idx + 1), ...ids.slice(0, Math.max(idx, 0))].find((id) => id !== lineId && needs(id));
      if (nextId) dispatch({ type: "focus", id: nextId });
    },
    [queue.ids, linesQuery, countsQuery, statusOf],
  );

  const queueEl = (
    <QueueWorkspace
      lines={visibleLines}
      statusOf={statusOf}
      showAll={showAll}
      onShowAll={setShowAll}
      needsCount={progress?.needs ?? countRows.length}
      reason={reason}
      onReason={setReason}
      sort={sort}
      onSort={setSort}
      multiSelect={multiSelect}
      onMultiSelect={(v) => {
        setMultiSelect(v);
        if (!v) setSelected({});
      }}
      loading={linesQuery.isLoading}
      error={linesQuery.isError ? linesQuery.error : null}
      onRetry={() => void linesQuery.refetch()}
      emptyTitle={showAll ? "Ingen linjer i dette utvalget" : reconcileReady ? "Alle linjer er avklart" : "Ingen linjer må avklares her"}
      activeLine={activeLine}
      onSelect={(l) => dispatch({ type: "focus", id: l.id })}
      onPrev={() => dispatch({ type: "prev" })}
      onNext={() => dispatch({ type: "next" })}
      selected={selected}
      onToggleSelect={(id, v) => setSelected((s) => ({ ...s, [id]: v }))}
      bulk={{
        count: selectedLines.length,
        acceptable: selectedLines.filter(isBulkAcceptable).length,
        busy: bulkBusy,
        onAccept: () => void bulkAcceptSelected(),
        onNotApplicable: () => void bulkNotApplicable(),
        onCreate: bulkCreate,
        onClear: () => setSelected({}),
      }}
      links={links}
      toleranceFor={toleranceForEntity}
      showInvoice={!expandedId}
      canWrite={canWrite}
      reconcileReady={reconcileReady}
      isMobile={isMobile}
      countsError={countsQuery.isError}
      onSaved={handleSaved}
      onLinked={(rmsId, name) => setLastLinked({ rmsId, name })}
      onSecondary={(a, l) => openDialog(a, l)}
      onShowDocument={showDoc}
      onReconcile={() => expandedId && setReconcileId(expandedId)}
    />
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
      {expandedId ? (
        <FocusHeader
          invoice={expandedInvoice}
          fallback={lines.find((l) => l.invoice_id === expandedId)?.invoice ?? null}
          progress={progress}
          reconcileReady={reconcileReady}
          undoLabel={undoEntry?.label ?? null}
          onUndo={() => void doUndo()}
          onBack={() => openInvoice(null)}
          onReconcile={() => setReconcileId(expandedId)}
          onShowDocument={() => {
            const l = activeLine ?? lines.find((x) => x.invoice_id === expandedId);
            if (l) showDoc(l);
          }}
        />
      ) : null}
      {expandedId && lastLinked && (
        <SimilarLinesHint
          rmsId={lastLinked.rmsId}
          name={lastLinked.name}
          onOpen={() => setBulkLink(lastLinked)}
          onDismiss={() => setLastLinked(null)}
        />
      )}
      {expandedId ? queueEl : (
      <>
      <FakturaerHeaderBanner
        title="Fakturainnboks"
        subtitle="Avklar linjene, fullfør kontrollen. Ingenting betales herfra."
      />

      <InvoiceInbox
        tab={inboxTab}
        onTabChange={setInboxTab}
        invoices={invoices}
        isLoading={invoicesQuery.isLoading}
        isError={invoicesQuery.isError}
        error={invoicesQuery.error}
        onRetry={() => void invoicesQuery.refetch()}
        legalEntityId={legalEntityId}
        supplierId={supplierId === "all" ? null : supplierId}
        supplierFilter={
          <>
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
          </>
        }
        canWrite={canWrite}
        canReconcile={canReconcile}
        busyId={busyInvoice?.id ?? null}
        onPrimary={primaryAction}
        onRematch={(inv) => void invoiceAction(inv.id, "match")}
        onOpenDetail={(inv) => navigate(paths.faktura(inv.id))}
        onFlag={(inv) => setFlagId(inv.id)}
        onUnflag={(inv) => void invoiceAction(inv.id, "unflag")}
        onBatchMatch={batchMatch}
      />

      <div>
        <Button variant="outline" size="sm" aria-expanded={showGlobalLines} onClick={() => setShowGlobalLines((v) => !v)}>
          {showGlobalLines ? "Skjul linjer på tvers av fakturaer" : "Kontroller linjer på tvers av fakturaer"}
        </Button>
      </div>
      {showGlobalLines && (
        <>
          {hasMoreLines && sort === "impact" && (
            <p className="text-caption text-ink-secondary">
              Sorteringen etter kroner gjelder bare de {lines.length} linjene som er lastet inn — ikke hele køen.
            </p>
          )}
          {queueEl}
          {hasMoreLines && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setLineLimit((n) => n + 200)}>
                Vis flere linjer
              </Button>
            </div>
          )}
        </>
      )}

      </>
      )}

      {panelActive && (
        <Sheet
          open
          onOpenChange={(v) => {
            if (!v) setDocOpen(false);
          }}
        >
          <SheetContent side={isMobile ? "bottom" : "right"} className={isMobile ? "h-[95vh] p-0" : "w-full p-0 sm:max-w-xl"}>
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
          if (!v) {
            setBulkLink(null);
            setLastLinked(null);
            void qc.invalidateQueries({ queryKey: ["similar-lines-count"] });
          }
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

      {flagId && (
        <FlagInvoiceDialog
          open
          onOpenChange={(v) => {
            if (!v) {
              setFlagId(null);
              refresh();
            }
          }}
          invoiceId={flagId}
        />
      )}
    </div>
  );
}
