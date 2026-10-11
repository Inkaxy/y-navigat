import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useReviewLines, useReviewLineCounts, type ReviewLineRow, type ReviewLineCountRow } from "@/fakturaer/hooks/useReviewLines";
import { useSupplierLinkContext } from "@/fakturaer/hooks/useSupplierLinkContext";
import { useMatchTolerancesByEntity } from "@/fakturaer/hooks/useMatchTolerances";
import { isBulkAcceptable, lineStatus } from "@/fakturaer/lib/lineStatus";
import { matchesGroup, repeatCounts, sortQueue, type QueueSort, type ReviewGroup } from "@/fakturaer/lib/reviewReasons";
import { START_PRICE_QUERY_KEYS, fetchStartPriceCandidates } from "@/fakturaer/lib/startPrice";
import { acceptTopSuggestion, markNotApplicable, rematchLines, restoreLine, snapshotOf } from "@/fakturaer/lib/queueActions";
import { emptyQueueState, peekUndo, queueReducer } from "@/fakturaer/lib/queueReducer";
import { notifyAccepted } from "@/fakturaer/lib/acceptNotice";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { invalidateInvoiceWork } from "./useInvoiceActions";

export type ReasonFilter = "all" | ReviewGroup;

/**
 * Linjekøen for ÉN faktura (det innboksens fokusvisning gjorde): filtrering,
 * aktiv linje, godta forslag, angre, masse-handlinger og «neste som trenger hjelp».
 */
export function useInvoiceLineQueue(invoiceId: string | null, legalEntityId: string | null, supplierId: string | null, invoiceStatus: string | null = null) {
  const qc = useQueryClient();
  const filters = { legalEntityId, supplierId: null, invoiceId, onlyReady: false, includeResolved: true };
  const linesQuery = useReviewLines({ ...filters, limit: null });
  const countsQuery = useReviewLineCounts(filters);
  const lines = useMemo(() => linesQuery.data?.rows ?? [], [linesQuery.data]);
  const countRows = useMemo(() => countsQuery.data ?? [], [countsQuery.data]);
  const links = useSupplierLinkContext(supplierId ? [supplierId] : []);
  const toleranceFor = useMatchTolerancesByEntity(legalEntityId ? [legalEntityId] : []);

  const startPrice = useQuery({
    queryKey: START_PRICE_QUERY_KEYS.candidates(legalEntityId, null),
    enabled: !!legalEntityId,
    staleTime: 60_000,
    queryFn: () => fetchStartPriceCandidates(legalEntityId as string, null, 500),
  });
  const startIds = useRef<ReadonlySet<string>>(new Set());
  startIds.current = useMemo(() => new Set((startPrice.data ?? []).map((c) => c.invoice_line_id)), [startPrice.data]);
  const statusOf = useCallback((l: ReviewLineRow | ReviewLineCountRow) => lineStatus(l, startIds.current), []);

  const [onlyOpen, setOnlyOpen] = useState<boolean | null>(null);
  const [reason, setReason] = useState<ReasonFilter>("all");
  const [sort, setSort] = useState<QueueSort>("invoice_date");
  const repeats = useMemo(() => repeatCounts(countRows), [countRows]);
  const needs = useMemo(() => countRows.filter((l) => statusOf(l).bucket === "needs").length, [countRows, statusOf]);
  // «Bare åpne linjer» er standard når det finnes åpne linjer.
  // Ferdige fakturaer (klar/avstemt/flagget) åpnes til lesing med alle linjer.
  const finalized = invoiceStatus === "ready" || invoiceStatus === "reconciled" || invoiceStatus === "flagged";
  const showOnlyOpen = onlyOpen ?? (!finalized && needs > 0);

  const visible = useMemo(() => {
    const f = lines.filter((l) => matchesGroup(l, reason) && (!showOnlyOpen || statusOf(l).bucket === "needs"));
    return sortQueue(f, sort, repeats);
  }, [lines, reason, showOnlyOpen, sort, repeats, statusOf]);

  const [queue, dispatch] = useReducer(queueReducer, emptyQueueState);
  useEffect(() => dispatch({ type: "sync", ids: visible.map((l) => l.id) }), [visible]);
  const activeLine = useMemo(() => visible.find((l) => l.id === queue.activeId) ?? null, [visible, queue.activeId]);
  const undoEntry = peekUndo(queue);

  const refresh = useCallback(() => {
    invalidateInvoiceWork(qc, invoiceId ?? undefined);
    invalidateRawMaterial(qc);
    void qc.invalidateQueries({ queryKey: ["invoice-supplier-links"] });
  }, [qc, invoiceId]);

  const busy = useRef(false);
  const [bulkLink, setBulkLink] = useState<{ rmsId: string; name: string } | null>(null);

  const accept = useCallback(async (line: ReviewLineRow) => {
    if (busy.current) return;
    busy.current = true;
    const snapshot = snapshotOf(line);
    try {
      const r = await acceptTopSuggestion(line);
      dispatch({ type: "resolved", id: line.id, snapshot, label: r.name });
      if (r.recalculationPending) toast.warning(`Koblet til ${r.name}, men prisen er ikke regnet om`, { description: r.recalculationError ?? undefined });
      else notifyAccepted(r.name, r.rmsId ?? null, (id, n) => setBulkLink({ rmsId: id, name: n }));
      refresh();
    } catch (e) {
      console.error("[faktura-godta]", e);
      toast.error("Kunne ikke godta forslaget. Prøv igjen.");
    } finally {
      busy.current = false;
    }
  }, [refresh]);

  const undo = useCallback(async () => {
    const entry = peekUndo(queue);
    if (!entry || busy.current) return;
    busy.current = true;
    try {
      await restoreLine(entry.lineId, entry.snapshot);
      dispatch({ type: "undo" });
      toast.success(`Angret: ${entry.label}`);
      refresh();
    } catch (e) {
      console.error("[faktura-angre]", e);
      toast.error("Kunne ikke angre. Prøv igjen.");
    } finally {
      busy.current = false;
    }
  }, [queue, refresh]);

  /** Husk et utført steg slik at U kan angre det (samme angring som innboksen). */
  const remember = useCallback((line: ReviewLineRow, label: string) => {
    dispatch({ type: "resolved", id: line.id, snapshot: snapshotOf(line), label });
  }, []);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedLines = useMemo(() => lines.filter((l) => selected[l.id]), [lines, selected]);
  const [bulkBusy, setBulkBusy] = useState(false);

  async function bulkAccept() {
    const cands = selectedLines.filter(isBulkAcceptable);
    if (cands.length === 0) { toast.info("Ingen av de valgte linjene har et forslag uten andre avvik"); return; }
    setBulkBusy(true);
    let ok = 0;
    const done: Array<{ invoice_id: string; id: string }> = [];
    for (const l of cands) {
      try { await acceptTopSuggestion(l, { skipRematch: true }); done.push({ invoice_id: l.invoice_id, id: l.id }); ok++; }
      catch (e) { console.error("[faktura-masse-godta]", e); }
    }
    const pending = done.length > 0 ? await rematchLines(done) : [];
    setBulkBusy(false);
    setSelected({});
    refresh();
    const failed = cands.length - ok;
    toast[failed ? "warning" : "success"](`${ok} godtatt${failed ? `, ${failed} feilet` : ""}${pending.length ? " — noen priser er ikke regnet om ennå" : ""}`);
  }

  async function bulkNotApplicable() {
    setBulkBusy(true);
    let ok = 0;
    for (const l of selectedLines) {
      try { await markNotApplicable(l); ok++; } catch (e) { console.error("[faktura-masse-ikke-vare]", e); }
    }
    setBulkBusy(false);
    setSelected({});
    refresh();
    const failed = selectedLines.length - ok;
    toast[failed ? "warning" : "success"](`${ok} markert som ikke vare${failed ? `, ${failed} feilet` : ""}`);
  }

  /** Etter lagring: står linjen fortsatt åpen, blir den. Ellers neste linje som trenger hjelp. */
  const handleSaved = useCallback(async (lineId: string) => {
    const ids = queue.ids;
    const idx = ids.indexOf(lineId);
    const r = await linesQuery.refetch();
    void countsQuery.refetch();
    // Headeren («Avklar N linjer», tidslinjen) leser fakturaen — hent den også.
    refresh();
    const rows = r.data?.rows ?? [];
    const open = (id: string) => { const row = rows.find((x) => x.id === id); return !!row && statusOf(row).bucket === "needs"; };
    if (open(lineId)) return;
    const nextId = [...ids.slice(idx + 1), ...ids.slice(0, Math.max(idx, 0))].find((id) => id !== lineId && open(id));
    if (nextId) dispatch({ type: "focus", id: nextId });
  }, [queue.ids, linesQuery, countsQuery, statusOf, refresh]);

  return {
    lines, visible, linesQuery, countsQuery, statusOf, links, toleranceFor,
    needs, total: countRows.length, showOnlyOpen, setOnlyOpen, reason, setReason, sort, setSort,
    activeLine, queue, dispatch, undoEntry, accept, undo, remember, handleSaved, refresh,
    selected, setSelected, selectedLines, bulkBusy, bulkAccept, bulkNotApplicable,
    bulkLink, setBulkLink,
  };
}

export type InvoiceLineQueue = ReturnType<typeof useInvoiceLineQueue>;
