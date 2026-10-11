import { useMemo, useState } from "react";
import { useUiPreference } from "@/hooks/useUiPreference";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { QueryState } from "@/components/common/QueryState";
import { useIsMobile } from "@/hooks/use-mobile";
import { fetchInvoiceDetail } from "@/fakturaer/components/invoice-detail/fetchInvoiceDetail";
import { InvoiceLinesTable } from "@/fakturaer/components/invoice-detail/InvoiceLinesTable";
import { InvoiceDocumentPanel } from "@/fakturaer/components/InvoiceDocumentPanel";
import { QueueWorkspace } from "@/fakturaer/components/inbox/QueueWorkspace";
import { SimilarLinesHint } from "@/fakturaer/components/inbox/SimilarLinesHint";
import { AuditHistory } from "@/fakturaer/components/decisions/AuditHistory";
import { useMatchTolerances } from "@/fakturaer/hooks/useMatchTolerances";
import { isBulkAcceptable } from "@/fakturaer/lib/lineStatus";
import { paths } from "@/ravarer/lib/paths";
import { ResultBox } from "@/ravarer/ui/ResultBox";
import { ShortcutHelp } from "@/ravarer/ui/ShortcutHelp";
import { useRematchInvoices } from "@/ravarer/pages/priskontroll/gjore/useGjoreMutations";
import { FakturaerDialogs, type DialogState } from "@/ravarer/pages/priskontroll/fakturaer/FakturaerDialogs";
import { fakturaBackHref } from "@/ravarer/pages/priskontroll/fakturaer/visning";
import { InvoiceFactsSection } from "./InvoiceFactsSection";
import { LineDialogs, type LineDialog } from "./LineDialogs";
import { SupplierItemScopeNote } from "./SupplierItemScopeNote";
import { WorkspaceHeader, type HeaderMenuAction } from "./WorkspaceHeader";
import { useFetchInvoiceLines } from "./useInvoiceActions";
import { useInvoiceLineQueue } from "./useInvoiceLineQueue";
import { useInvoiceSteps } from "./useInvoiceSteps";
import { useIsWide } from "./useIsWide";
import { useWorkspaceHotkeys } from "./useWorkspaceHotkeys";

const LS_DOC = "nbhub.faktura.docpanel.open";
const HELP = [
  { keys: ["↑", "↓", "j", "k"], description: "Forrige / neste linje", handler: () => undefined },
  { keys: ["Enter"], description: "Godta toppforslag / hovedhandling", handler: () => undefined },
  { keys: ["m"], description: "Endre råvare", handler: () => undefined },
  { keys: ["n"], description: "Ny råvare", handler: () => undefined },
  { keys: ["x"], description: "Ikke vare", handler: () => undefined },
  { keys: ["u"], description: "Angre", handler: () => undefined },
  { keys: ["d"], description: "Vis/skjul dokument", handler: () => undefined },
  { keys: ["Esc"], description: "Lukk inspektør", handler: () => undefined },
];

/** Faktura-arbeidsflaten: dokument · linjer · linjeinspektør, og ÉN neste-steg-knapp. */
export default function FakturaWorkspace() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const wide = useIsWide();
  const detail = useQuery({ queryKey: ["invoice", id], enabled: !!id, queryFn: () => fetchInvoiceDetail(id as string) });
  const data = detail.data;
  const q = useInvoiceLineQueue(id ?? null, data?.legal_entity_id ?? null, data?.supplier_id ?? null);
  const s = useInvoiceSteps(data);
  const tolerances = useMatchTolerances(data?.legal_entity_id ?? null);
  const fetchLines = useFetchInvoiceLines();
  const rematch = useRematchInvoices();
  const [docOpen, setDocOpen] = useState(() => localStorage.getItem(LS_DOC) === "1");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [editSignal, setEditSignal] = useState(0);
  const [factsSignal, setFactsSignal] = useState(0);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [lineDialog, setLineDialog] = useState<LineDialog>(null);
  const [multi, setMulti] = useState(false);
  const { value: tableView, setValue: setTableView } = useUiPreference<boolean>("ravarer.faktura.tabellvisning", false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [lastLinked, setLastLinked] = useState<{ rmsId: string; name: string } | null>(null);
  const [showLedger, setShowLedger] = useState(false);

  const toggleDoc = () => setDocOpen((v) => { localStorage.setItem(LS_DOC, v ? "0" : "1"); return !v; });
  const editMaterial = () => { setEditSignal((n) => n + 1); setInspectorOpen(true); };
  const focusFirstOpen = () => {
    q.setOnlyOpen(true);
    const first = q.visible.find((l) => q.statusOf(l).bucket === "needs");
    if (first) q.dispatch({ type: "focus", id: first.id });
    setInspectorOpen(true);
  };
  const doFetch = () => {
    if (!data) return;
    fetchLines.mutate(data, {
      onSuccess: () => s.setResult({ title: "Linjene er hentet", items: [] }),
      onError: (e: Error) => s.setResult({ title: "Linjene ble ikke hentet", items: [e.message], error: true }),
    });
  };
  const doRematch = () => {
    if (!data) return;
    rematch.mutate([data.id], {
      onSuccess: (r) => toast[r.queued ? "success" : "info"](r.queued ? "Fakturaen er lagt i kø — oppdateres om litt" : r.already_queued ? "Fakturaen ligger allerede i kø" : "Fakturaen kan ikke beregnes på nytt nå"),
      onError: (e: Error) => toast.error(e.message),
    });
  };

  const runPrimary = () => {
    if (!data || !s.next) return;
    const k = s.next.key;
    if (k === "flagget") setDialog({ kind: "unflag", inv: data });
    else if (k === "hent_linjer") doFetch();
    else if (k === "registrer_linjer") navigate(paths.registrerLinjer(data.id));
    else if (k === "rett_sum") setFactsSignal((n) => n + 1);
    else if (k === "avklar") focusFirstOpen();
    else if (k === "avstem" && s.assessment) setDialog({ kind: "reconcile", inv: { id: data.id, invoice_number: data.invoice_number, assessment: s.assessment } });
    else if (k === "godkjenn") void s.approve();
    else if (k === "kostpris") void s.postCosts();
  };
  const onMenu = (a: HeaderMenuAction) => {
    if (!data) return;
    if (a === "flag") setDialog({ kind: "flag", ids: [data.id] });
    else if (a === "unflag") setDialog({ kind: "unflag", inv: data });
    else if (a === "rematch") doRematch();
    else if (a === "fetch") doFetch();
    else if (a === "register") navigate(paths.registrerLinjer(data.id));
    else if (a === "credit") setDialog({ kind: "credit", inv: data });
    else setHistoryOpen(true);
  };

  const anyDialog = !!dialog || !!lineDialog || historyOpen || helpOpen || !!q.bulkLink;
  const keys = useMemo(() => ({
    enabled: !!data && !anyDialog,
    activeLine: q.activeLine,
    next: () => q.dispatch({ type: "next" }),
    prev: () => q.dispatch({ type: "prev" }),
    enter: (l: typeof q.activeLine) => {
      if (l && s.canWrite && !l.raw_material_id && q.statusOf(l).key === "confirm_material") void q.accept(l);
      else document.querySelector<HTMLButtonElement>('[aria-label="Valgt fakturalinje"] footer button[aria-describedby]:not([disabled])')?.click();
    },
    editMaterial,
    create: (l: NonNullable<typeof q.activeLine>) => setLineDialog({ kind: "create", line: l }),
    notItem: (l: NonNullable<typeof q.activeLine>) => setLineDialog({ kind: "not_rm", line: l }),
    undo: () => void q.undo(),
    toggleDoc,
    escape: () => (docOpen && !wide ? setDocOpen(false) : setInspectorOpen(false)),
    help: () => setHelpOpen(true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, anyDialog, q.activeLine, q.accept, q.undo, s.canWrite, docOpen, wide]);
  useWorkspaceHotkeys(keys);

  if (!id) return null;
  if (detail.isLoading || detail.isError || !data || !s.next) {
    return <QueryState scope="faktura-arbeidsflate" isLoading={detail.isLoading} isError={detail.isError || (!detail.isLoading && !data)} error={detail.error} onRetry={() => void detail.refetch()}>{null}</QueryState>;
  }

  const active = q.activeLine;
  const docEl = (
    <InvoiceDocumentPanel
      invoice={{ invoice_number: data.invoice_number, invoice_date: data.invoice_date, supplier_name: data.suppliers?.name ?? null, source_document_url: data.source_document_url, total_amount: data.total_amount, total_vat: data.total_vat, lines_sum_status: data.lines_sum_status, lines_sum_excl_vat: data.lines_sum_excl_vat, lines_sum_variance_pct: data.lines_sum_variance_pct, extraction_confidence: data.extraction_confidence }}
      line={active ? { ...active, matched_name: active.matched_raw_material?.name ?? null } : null}
      tolerancePct={tolerances.defaultPct}
      onClose={() => toggleDoc()}
      className="h-full"
    />
  );
  const showDocZone = docOpen && wide && !!data.source_document_url;
  const final = data.status === "reconciled" || data.status === "flagged";

  const linesZone = (
    <div className="min-w-0 space-y-3">
      <InvoiceFactsSection data={data} canWrite={s.canWrite} fetchingLines={fetchLines.isPending} onFetchLines={doFetch} onChanged={() => void detail.refetch()} openSignal={factsSignal} />
      {s.result && <ResultBox title={s.result.title} items={s.result.items} onUndo={s.result.undoable && q.undoEntry ? () => { s.setResult(null); void q.undo(); } : undefined} onNext={() => s.setResult(null)} nextLabel="Lukk" />}
      {lastLinked && <SimilarLinesHint rmsId={lastLinked.rmsId} name={lastLinked.name} onOpen={() => q.setBulkLink(lastLinked)} onDismiss={() => setLastLinked(null)} />}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" aria-pressed={tableView} onClick={() => setTableView(!tableView)}>{tableView ? "Vis arbeidsliste" : "Vis som tabell"}</Button>
      </div>
      {tableView ? (
        <InvoiceLinesTable
          lines={data.invoice_lines ?? []}
          supplierId={data.supplier_id}
          canBulkImport={false}
          canMatch={s.canWrite && !final}
          selected={{}}
          onSelect={() => undefined}
          showLedgerAccount={showLedger}
          onShowLedgerAccount={setShowLedger}
          onMatch={(lineId) => { setTableView(false); q.setOnlyOpen(false); q.dispatch({ type: "focus", id: lineId }); editMaterial(); }}
          onRegister={() => navigate(paths.registrerLinjer(data.id))}
          tolerancePct={tolerances.defaultPct}
          settings={tolerances.settings}
        />
      ) : (
        <QueueWorkspace
          lines={q.visible}
          statusOf={q.statusOf}
          showAll={!q.showOnlyOpen}
          onShowAll={(v) => q.setOnlyOpen(!v)}
          needsCount={q.needs}
          reason={q.reason}
          onReason={q.setReason}
          sort={q.sort}
          onSort={q.setSort}
          multiSelect={multi}
          onMultiSelect={(v) => { setMulti(v); if (!v) q.setSelected({}); }}
          loading={q.linesQuery.isLoading}
          error={q.linesQuery.isError ? q.linesQuery.error : null}
          onRetry={() => void q.linesQuery.refetch()}
          emptyTitle={q.showOnlyOpen ? "Ingen linjer må avklares" : "Fakturaen har ingen linjer"}
          activeLine={active}
          onSelect={(l) => { q.dispatch({ type: "focus", id: l.id }); setInspectorOpen(true); }}
          onPrev={() => q.dispatch({ type: "prev" })}
          onNext={() => q.dispatch({ type: "next" })}
          selected={q.selected}
          onToggleSelect={(lid, v) => q.setSelected((x) => ({ ...x, [lid]: v }))}
          bulk={{
            count: q.selectedLines.length, acceptable: q.selectedLines.filter(isBulkAcceptable).length, busy: q.bulkBusy,
            onAccept: () => void q.bulkAccept(), onNotApplicable: () => void q.bulkNotApplicable(),
            onCreate: () => setLineDialog({ kind: "bulk_create", line: null }), onClear: () => q.setSelected({}),
            onImport: () => setLineDialog({ kind: "bulk_import", line: null }), importable: q.selectedLines.filter((l) => !l.raw_material_id).length,
          }}
          links={q.links}
          toleranceFor={q.toleranceFor}
          showInvoice={false}
          canWrite={s.canWrite}
          reconcileReady={s.next.key === "avstem" && s.next.enabled}
          isMobile={isMobile}
          countsError={q.countsQuery.isError}
          onSaved={q.handleSaved}
          onLinked={(rmsId, name) => setLastLinked({ rmsId, name })}
          onSecondary={(a, l) => setLineDialog({ kind: a, line: l })}
          onShowDocument={() => { if (!docOpen) toggleDoc(); }}
          onReconcile={runPrimary}
          inspectorAsSheet={!wide && !isMobile}
          inspectorOpen={inspectorOpen}
          onInspectorOpenChange={setInspectorOpen}
          inspectorNote={active ? <SupplierItemScopeNote supplierId={data.supplier_id} line={active} /> : null}
          editMaterialSignal={editSignal}
        />
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <WorkspaceHeader
        backHref={fakturaBackHref(sp.get("fra"))}
        supplier={data.suppliers?.name ?? "Leverandør"}
        invoiceNumber={data.invoice_number}
        invoiceDate={data.invoice_date}
        amount={data.total_amount}
        status={data.status}
        reconciledMode={data.reconciled_mode}
        steps={s.steps ?? []}
        isCreditNote={!!data.is_credit_note}
        next={s.next}
        busy={s.busy || fetchLines.isPending}
        onPrimary={runPrimary}
        undoLabel={q.undoEntry?.label ?? null}
        onUndo={() => void q.undo()}
        docPath={data.source_document_url}
        docOpen={docOpen}
        onToggleDoc={toggleDoc}
        canWrite={s.canWrite}
        isTripletex={data.source === "tripletex"}
        rematchBusy={rematch.isPending}
        onMenu={onMenu}
      />
      {showDocZone ? (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(320px,32%)_1fr]">
          <aside className="sticky top-28 h-[calc(100vh-8rem)] overflow-hidden rounded-lg border border-border bg-card">{docEl}</aside>
          {linesZone}
        </div>
      ) : linesZone}
      {docOpen && !wide && !!data.source_document_url && (
        <Sheet open onOpenChange={(v) => { if (!v) toggleDoc(); }}>
          <SheetContent side="bottom" className="h-[90vh] p-0"><SheetTitle className="sr-only">Originalfaktura</SheetTitle>{docEl}</SheetContent>
        </Sheet>
      )}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader><SheetTitle>Revisjonshistorikk</SheetTitle></SheetHeader>
          <div className="mt-4"><AuditHistory entityId={data.id} kind="invoice" /></div>
        </SheetContent>
      </Sheet>
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} bindings={HELP} />
      <FakturaerDialogs state={dialog} onClose={() => setDialog(null)} onDone={(k) => { if (k !== "flag") setDialog(null); void detail.refetch(); }} />
      <LineDialogs dialog={lineDialog} onClose={() => setLineDialog(null)} q={q} canWrite={s.canWrite} invoice={data} onEditMaterial={editMaterial}
        onNotItemDone={(l) => { q.remember(l, `Ikke vare: ${l.description ?? "linje"}`); q.refresh(); s.setResult({ title: "Linjen er merket som ikke vare", items: [l.description ?? ""].filter(Boolean), undoable: true }); }} />
    </div>
  );
}
