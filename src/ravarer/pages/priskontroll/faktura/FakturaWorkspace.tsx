import { correctionTarget } from "./correctionTarget";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUiPreference } from "@/hooks/useUiPreference";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
import { useConfirmMany } from "@/ravarer/ui/useConfirmMany";
import type { EditMaterialSignal } from "@/fakturaer/lib/editMaterialSignal";
import { FakturaerDialogs, type DialogState } from "@/ravarer/pages/priskontroll/fakturaer/FakturaerDialogs";
import { fakturaReturn, readReturnParam } from "@/ravarer/pages/priskontroll/fakturaer/visning";
import { ControlSummary } from "./ControlSummary";
import { FocusNotice } from "./FocusNotice";
import { invoiceLineLock, isExcludedInvoice } from "./exclusionView";
import { FOCUS_PARAM, opensLineSheetForFocus, parseFocus } from "@/ravarer/pages/priskontroll/gjore/clarifyTarget";
import { SumOverrideDialog } from "./SumOverrideDialog";
import { recheckInvoiceLinesSum } from "@/fakturaer/lib/linesSum";
import { supabase } from "@/integrations/supabase/client";
import { parseRepairVat } from "@/fakturaer/lib/parseRpcJson";
import { repairVatMessage } from "@/fakturaer/lib/invoiceFacts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notItemResultItems } from "./notItemResult";
import { LineDialogs, type LineDialog } from "./LineDialogs";
import { SupplierItemScopeNote } from "./SupplierItemScopeNote";
import { WorkspaceHeader, type HeaderMenuAction } from "./WorkspaceHeader";
import { useFetchInvoiceLines } from "./useInvoiceActions";
import { useInvoiceLineQueue } from "./useInvoiceLineQueue";
import { useInvoiceSteps } from "./useInvoiceSteps";
import { useIsWide } from "./useIsWide";
import { useWorkspaceHotkeys } from "./useWorkspaceHotkeys";
import { useRematchWait } from "./useRematchWait";
import { canFetchLines } from "./invoiceSteps";
import { CorrectLineDialog } from "./CorrectLineDialog";
import { correctionDocLine } from "./correctionDocLine";
import { parseReadIssues } from "@/fakturaer/lib/lineCorrection";
import { useInvoicePriceSafety } from "@/fakturaer/hooks/useInvoicePriceSafety";
import { ownLineGate } from "./ownLineGate";
import { PriceGateProvider } from "@/fakturaer/lib/priceGateContext";
import { HoldOutsideDialog, type HoldOutsideTarget } from "@/fakturaer/components/HoldOutsideDialog";
import { ExclusionPanel } from "@/fakturaer/components/ExclusionPanel";

// v2: originaldokumentet er åpent som standard; bare et eksplisitt «skjul» huskes.
const LS_DOC = "nbhub.faktura.docpanel.v2";
// Innebygd: originalen er valgfri og lukket til brukeren åpner den.
const LS_DOC_EMBEDDED = "nbhub.faktura.docpanel.embedded.v1";
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

/** Egen side (`/faktura/:id`). */
export default function FakturaWorkspace() {
  const { id } = useParams();
  return <FakturaWorkspaceView id={id} />;
}

type ViewProps = {
  id: string | undefined;
  /** Innebygd i fakturaarbeidsflaten: originalen er valgfritt sidepanel (lukket som standard), tilbake = arbeidsflaten. */
  /** `compact`: primær arbeidsflate — tett hode og sumstripe så linjearbeidet er synlig på laptop. */
  embedded?: { backHref: string; backLabel: string; compact?: boolean };
};

/** Faktura-arbeidsflaten: dokument · linjer · linjeinspektør, og ÉN neste-steg-knapp. */
export function FakturaWorkspaceView({ id, embedded }: ViewProps) {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const wide = useIsWide();
  // Dokument + linjer + inspektør side om side krever reell bredde; ellers åpnes inspektøren i et ark.
  const threeZones = useIsWide(1680);
  const detail = useQuery({ queryKey: ["invoice", id], enabled: !!id, queryFn: () => fetchInvoiceDetail(id as string) });
  const data = detail.data;
  const q = useInvoiceLineQueue(id ?? null, data?.legal_entity_id ?? null, data?.supplier_id ?? null, data?.status ?? null);
  const s = useInvoiceSteps(data);
  const tolerances = useMatchTolerances(data?.legal_entity_id ?? null);
  // Serverens prisstatus; ukjent mens noe lagres eller detaljene hentes på nytt.
  const safety = useInvoicePriceSafety([id ?? null], { pending: s.busy || detail.isFetching });
  // Rettemålet fryses som selskap + faktura + linje; et mål for en annen faktura vises aldri.
  const [correctTarget, setCorrectTarget] = useState<{ entityId: string | null; invoiceId: string; lineId: string } | null>(null);
  const correctOpener = useRef<{ invoiceId: string; el: HTMLElement | null } | null>(null);
  const fetchLines = useFetchInvoiceLines();
  const rematch = useRematchWait(data?.legal_entity_id ?? null, () => { void detail.refetch(); q.refresh(); });
  const confirmMany = useConfirmMany();
  const [docOpen, setDocOpen] = useState(() => (embedded ? localStorage.getItem(LS_DOC_EMBEDDED) === "1" : localStorage.getItem(LS_DOC) !== "0") && typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [editSignal, setEditSignal] = useState<EditMaterialSignal | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [factsSignal, setFactsSignal] = useState(0);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [lineDialog, setLineDialog] = useState<LineDialog>(null);
  const [multi, setMulti] = useState(false);
  const { value: tableView, setValue: setTableView } = useUiPreference<boolean>("ravarer.faktura.tabellvisning", false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [lastLinked, setLastLinked] = useState<{ rmsId: string; name: string } | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [hold, setHold] = useState<HoldOutsideTarget | null>(null);
  const [zone, setZone] = useState<"dokument" | "linjer" | "kontroll">("linjer");

  const routeEntity = data?.legal_entity_id ?? null;
  // Rute- eller selskapsbytte lukker og nullstiller rettingen straks (fokus føres ikke tilbake til forrige faktura).
  useEffect(() => { setCorrectTarget(null); correctOpener.current = null; }, [id, routeEntity]);
  const correctFor = correctTarget && correctTarget.invoiceId === id && data?.id === id && correctTarget.entityId === routeEntity ? correctTarget.lineId : null;
  const startCorrection = (lineId: string) => {
    if (!data) return;
    const ae = typeof document !== "undefined" ? document.activeElement : null;
    // Menyvalg forsvinner når menyen lukkes; da brukes hovedknappen på samme faktura som trygg reserve.
    const el = ae instanceof HTMLElement && ae !== document.body && !ae.closest('[role="menu"]') ? ae : null;
    correctOpener.current = { invoiceId: data.id, el };
    setCorrectTarget({ entityId: data.legal_entity_id ?? null, invoiceId: data.id, lineId });
  };
  const correctionReturnFocus = (): HTMLElement | null => {
    const o = correctOpener.current;
    if (!o || o.invoiceId !== id) return null;
    if (o.el && o.el.isConnected) return o.el;
    return document.querySelector<HTMLElement>("[data-primary-action]:not([disabled])");
  };
  const final = data?.status === "reconciled" || data?.status === "flagged" || data?.status === "excluded";
  // Linjene kan bare endres med skrivetilgang og når fakturaen verken er endelig, internt godkjent eller har ukjent godkjenning.
  const lineLock = invoiceLineLock(data?.status, data?.excluded_at, { approved: !!s.extras?.approved, known: s.extras?.known });
  const lineWrite = s.canWrite && !lineLock.locked;
  // Mobil: dokumentet vises via sonen; desktop: via docOpen. Én kilde for etikett/aria-pressed.
  const toggleDoc = () => {
    if (isMobile) { setZone((z) => (z === "dokument" ? "linjer" : "dokument")); return; }
    setDocOpen((v) => { localStorage.setItem(embedded ? LS_DOC_EMBEDDED : LS_DOC, v ? "0" : "1"); return !v; });
  };
  const docShown = isMobile ? zone === "dokument" : docOpen;
  const editMaterial = (lineId?: string) => {
    const target = lineId ?? q.activeLine?.id;
    if (!target) return;
    setEditSignal((p) => ({ lineId: target, n: (p?.n ?? 0) + 1 }));
    setInspectorOpen(true);
  };
  // Signalet gjelder bare linjen det ble gitt for — glem det når brukeren går videre.
  const activeId = q.activeLine?.id ?? null;
  useEffect(() => {
    if (editSignal && activeId && activeId !== editSignal.lineId && !pendingFocus) setEditSignal(null);
  }, [activeId, editSignal, pendingFocus]);
  // Fokus etter at listen er synkronisert (f.eks. når «bare åpne» slås av samtidig).
  useEffect(() => {
    if (!pendingFocus || !q.visible.some((l) => l.id === pendingFocus)) return;
    q.dispatch({ type: "focus", id: pendingFocus });
    setPendingFocus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFocus, q.visible]);
  // `?linje=<id>`: åpne nøyaktig denne linjen (også lukkede). Ukjent ID velger aldri en annen linje.
  const targetLine = sp.get("linje");
  // `?fokus=`: åpnet fra en avklaring i varekortet — synlig overskrift, ingen automatisk skriving.
  const focus = parseFocus(sp.get(FOCUS_PARAM));
  const focusHandled = useRef<string | null>(null);
  useEffect(() => {
    if (focus !== "sum" || !data || focusHandled.current === data.id) return;
    focusHandled.current = data.id;
    setFactsSignal((n) => n + 1);
    setZone("kontroll");
  }, [focus, data]);
  const [lineNotice, setLineNotice] = useState<string | null>(null);
  /** Ugyldig mål: ingen annen linje vises som valgt før brukeren selv velger en. */
  const [suppressActive, setSuppressActive] = useState(false);
  /** Gyldig mål i lagret tabellvisning: arbeidslisten åpnes for denne økten så målet er synlig valgt. */
  const [forceList, setForceList] = useState(false);
  const handledTarget = useRef<string | null>(null);
  useEffect(() => {
    if (!targetLine || !q.linesQuery.isSuccess) return;
    const key = `${id}:${targetLine}`;
    if (handledTarget.current === key) return;
    handledTarget.current = key;
    if (q.lines.some((l) => l.id === targetLine)) {
      q.setOnlyOpen(false);
      q.setReason("all");
      setPendingFocus(targetLine);
      // Linjen velges, men ved kreditnota-fokus skal «Koble til opprinnelig faktura» være synlig.
      if (opensLineSheetForFocus(focus)) setInspectorOpen(true);
      setZone("linjer");
      setLineNotice(null);
      setSuppressActive(false);
      setForceList(true);
    } else {
      setSuppressActive(true);
      setLineNotice("Linjen fra lenken finnes ikke på denne fakturaen eller er ikke tilgjengelig for deg. Ingen annen linje er valgt.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLine, id, q.linesQuery.isSuccess, q.lines]);
  const focusFirstOpen = () => {
    q.setOnlyOpen(true);
    const first = q.visible.find((l) => q.statusOf(l).bucket === "needs");
    if (first) q.dispatch({ type: "focus", id: first.id });
    setInspectorOpen(true);
    setZone("linjer");
  };
  const doFetch = () => {
    if (!data) return;
    fetchLines.mutate(data, {
      onSuccess: (r) => s.setResult(r.behandlet === 0 ? { title: "Ingenting å hente — linjene er allerede lest", items: [] } : { title: "Linjene er hentet", items: [] }),
      onError: (e: Error) => s.setResult({ title: "Linjene ble ikke hentet", items: [e.message], error: true }),
    });
  };
  const doRematch = () => { if (data) rematch.start(data.id); };

  /** Én inngang til rettedialogen: valgt linje på denne fakturaen, ellers linje med lesevarsel. */
  const openCorrection = () => {
    if (!data) return;
    if (!lineWrite) { s.setResult({ title: "Linjene kan ikke rettes her", items: [final ? "Fakturaen er avstemt eller flagget." : "Du har ikke skrivetilgang."], error: true }); return; }
    const t = correctionTarget(data.invoice_lines ?? [], suppressActive ? null : q.activeLine?.id, (l) => parseReadIssues(l.extraction_issues).length > 0);
    if (!t) {
      setZone("linjer"); setInspectorOpen(true);
      s.setResult({ title: "Velg linjen som skal rettes", items: ["Velg linjen i listen og bruk «Rett fakturalinje»."] });
      return;
    }
    // Originalen vises i selve rettedialogen (samme linje); ingen ekstra dokumentark åpnes bak den.
    startCorrection(t.id);
  };

  const runPrimary = () => {
    if (!data || !s.next) return;
    const k = s.next.key;
    if (k === "flagget") setDialog({ kind: "unflag", inv: data });
    else if (k === "koble_kreditnota") setDialog({ kind: "credit", inv: data });
    else if (k === "hent_linjer") doFetch();
    else if (k === "registrer_linjer") navigate(paths.registrerLinjer(data.id));
    else if (k === "rett_sum") { setFactsSignal((n) => n + 1); openCorrection(); }
    else if (k === "avklar") focusFirstOpen();
    else if (k === "avstem" && s.assessment) setDialog({ kind: "reconcile", inv: { id: data.id, invoice_number: data.invoice_number, assessment: s.assessment } });
    else if (k === "godkjenn") void s.approve();
    else if (k === "kostpris") void s.postCosts();
    // Eksplisitt nytt forsøk (ingen automatikk); samme rettighets-/opptattsperre som «Før kostpris».
    else if (k === "kostkontroll") void s.postCosts();
  };
  // Skrivbar, ikke avstemt/godkjent og ikke allerede utelatt; serveren kontrollerer det samme på nytt.
  const canHold = !!data && lineWrite && data.status !== "reconciled" && data.status !== "excluded" && !data.reconciled_at;
  const openHold = (lineId: string | null, scope: "invoice" | "line") => {
    if (!data || !canHold) return;
    const l = lineId ? (data.invoice_lines ?? []).find((x) => x.id === lineId) : undefined;
    setHold({
      invoice: { id: data.id, invoice_number: data.invoice_number, updated_at: data.updated_at, is_credit_note: !!data.is_credit_note },
      line: l && !l.excluded_at ? { id: l.id, line_number: l.line_number, description: l.description, updated_at: l.updated_at } : null,
      initialScope: l && !l.excluded_at ? scope : "invoice",
    });
  };
  const onMenu = (a: HeaderMenuAction) => {
    if (!data) return;
    if (a === "flag") { if (data.status !== "reconciled" && data.status !== "flagged") setDialog({ kind: "flag", ids: [data.id] }); }
    else if (a === "unflag") setDialog({ kind: "unflag", inv: data });
    else if (a === "rematch") doRematch();
    else if (a === "fetch") doFetch();
    else if (a === "register") navigate(paths.registrerLinjer(data.id));
    else if (a === "reread") navigate(paths.lesPaNytt(data.id));
    else if (a === "credit") setDialog({ kind: "credit", inv: data });
    else if (a === "correct") openCorrection();
    else if (a === "facts") { setFactsSignal((n) => n + 1); setZone("kontroll"); }
    else if (a === "recheck") {
      void recheckInvoiceLinesSum(data.id).then(() => { void detail.refetch(); s.setResult({ title: "Summen er kontrollert på nytt", items: [] }); },
        () => s.setResult({ title: "Summen kunne ikke kontrolleres", items: ["Prøv igjen."], error: true }));
    }
    else if (a === "vat") {
      void (async () => {
        const { data: r, error } = await supabase.rpc("rm_repair_invoice_vat", { p_invoice_id: data.id });
        if (error) { console.error("[mva-forslag]", error); s.setResult({ title: "Mva-avviket kunne ikke kontrolleres", items: ["Prøv igjen."], error: true }); return; }
        s.setResult({ title: "Forslag ved mva-avvik", items: [repairVatMessage(parseRepairVat(r))] });
      })();
    }
    else if (a === "override") setOverrideOpen(true);
    else if (a === "exclude") openHold(null, "invoice");
    else setHistoryOpen(true);
  };

  const anyDialog = !!hold || !!dialog || !!lineDialog || !!correctFor || historyOpen || helpOpen || overrideOpen || !!q.bulkLink;
  const keys = useMemo(() => ({
    enabled: !!data && !anyDialog,
    canWrite: lineWrite,
    activeLine: suppressActive ? null : q.activeLine,
    next: () => q.dispatch({ type: "next" }),
    prev: () => q.dispatch({ type: "prev" }),
    enter: (l: typeof q.activeLine) => {
      if (l && lineWrite && !l.raw_material_id && q.statusOf(l).key === "confirm_material") void q.accept(l);
      else document.querySelector<HTMLButtonElement>('[aria-label="Valgt fakturalinje"] footer button[aria-describedby]:not([disabled])')?.click();
    },
    editMaterial: () => editMaterial(),
    create: (l: NonNullable<typeof q.activeLine>) => setLineDialog({ kind: "create", line: l }),
    notItem: (l: NonNullable<typeof q.activeLine>) => setLineDialog({ kind: "not_rm", line: l }),
    undo: () => void q.undo(),
    toggleDoc,
    escape: () => (docShown && !wide ? toggleDoc() : setInspectorOpen(false)),
    help: () => setHelpOpen(true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, anyDialog, q.activeLine, suppressActive, q.accept, q.undo, lineWrite, docOpen, docShown, wide, isMobile]);
  useWorkspaceHotkeys(keys);

  if (!id) return null;
  if (detail.isLoading || detail.isError || !data || !s.next) {
    return <QueryState scope="faktura-arbeidsflate" isLoading={detail.isLoading} isError={detail.isError || (!detail.isLoading && !data)} error={detail.error} onRetry={() => void detail.refetch()}>{null}</QueryState>;
  }

  const active = suppressActive ? null : q.activeLine;
  const showTable = tableView && !forceList;
  const linesById = new Map((data.invoice_lines ?? []).map((l) => [l.id, l]));
  // Kallerens EGEN radversjon/råvare binder statusen. Lånes aldri fra en annen cache; mangler den, er prisen ukjent.
  const gateFor = ownLineGate(safety.gateFor, data.id);
  const heldOutside = (line: NonNullable<typeof active>) =>
    isExcludedInvoice(data.status, data.excluded_at) || !!linesById.get(line.id)?.excluded_at;
  const docFor = (line: typeof active) => (
    <InvoiceDocumentPanel invoiceId={data.id}
      invoice={{ invoice_number: data.invoice_number, invoice_date: data.invoice_date, supplier_name: data.suppliers?.name ?? null, source_document_url: data.source_document_url, total_amount: data.total_amount, total_vat: data.total_vat, lines_sum_status: data.lines_sum_status, lines_sum_excl_vat: data.lines_sum_excl_vat, lines_sum_variance_pct: data.lines_sum_variance_pct, extraction_confidence: data.extraction_confidence, currency: data.currency, is_credit_note: data.is_credit_note, flagged_at: data.flagged_at, extraction_issues: data.extraction_issues }}
      line={line ? { ...line, matched_name: line.matched_raw_material?.name ?? null, extraction_issues: linesById.get(line.id)?.extraction_issues } : null}
      gate={line && !heldOutside(line) ? gateFor(line) : null}
      lineHeldOutside={!!line && heldOutside(line)}
      documentHeldOutside={isExcludedInvoice(data.status, data.excluded_at)}
      tolerancePct={tolerances.defaultPct}
      onClose={() => toggleDoc()}
      className="h-full"
    />
  );
  const docEl = docFor(active);
  // Rettedialogen viser samme linje som skjemaet (tabell eller kø), aldri køens forrige valg.
  const correctDocEl = docFor(correctionDocLine(correctFor, q.linesQuery.data?.rows ?? [], null));
  const showDocZone = docOpen && wide && !!data.source_document_url;
  const lockNote = lineLock.locked ? lineLock.note : null;
  const notApplicableCount = q.selectedLines.length;

  const control = (expanded?: boolean) => (
    <ControlSummary data={data} openCount={q.needs} totalCount={q.total} canWrite={s.canWrite} locked={final || lineLock.locked} openSignal={factsSignal} expanded={expanded} compact={!!embedded?.compact && !expanded} />
  );
  const linesZone = (
    <div className={embedded?.compact ? "min-w-0 space-y-2" : "min-w-0 space-y-3"}>
      {!isMobile && control()}
      {lineNotice && <p role="alert" className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm">{lineNotice}</p>}
      {lockNote && <p role="note" data-testid="invoice-line-lock" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-ink-secondary">{lockNote}{lineLock.locked && lineLock.kind === "approved" && s.canWrite && <> <a className="underline" href={paths.godkjenning()}>Gå til Godkjenning</a></>}</p>}
      {s.result && <ResultBox title={s.result.title} items={s.result.items} onUndo={s.result.undoable && q.undoEntry ? () => { s.setResult(null); void q.undo(); } : undefined} onNext={() => s.setResult(null)} nextLabel="Lukk" />}
      {lastLinked && <SimilarLinesHint rmsId={lastLinked.rmsId} name={lastLinked.name} onOpen={() => q.setBulkLink(lastLinked)} onDismiss={() => setLastLinked(null)} />}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="min-h-[44px]" aria-pressed={showTable} onClick={() => { setForceList(false); setTableView(!showTable); }}>{showTable ? "Vis arbeidsliste" : "Vis som tabell"}</Button>
      </div>
      {showTable ? (
        <InvoiceLinesTable
          lines={data.invoice_lines ?? []}
          supplierId={data.supplier_id}
          canBulkImport={false}
          canMatch={lineWrite}
          selected={{}}
          onSelect={() => undefined}
          showLedgerAccount={showLedger}
          onShowLedgerAccount={setShowLedger}
          onMatch={(lineId) => { setTableView(false); q.setOnlyOpen(false); setPendingFocus(lineId); editMaterial(lineId); }}
          onRegister={() => navigate(paths.registrerLinjer(data.id))}
          tolerancePct={tolerances.defaultPct}
          settings={tolerances.settings}
          onCorrect={lineWrite ? (lid) => startCorrection(lid) : undefined}
          invoice={{ currency: data.currency }}
          gateOf={gateFor}
          compact={isMobile || (showDocZone && !threeZones)}
        />
      ) : (
        <QueueWorkspace
          invoiceApproved={s.steps ? !!s.steps.find((x) => x.key === "godkjent")?.done : undefined}
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
          emptyTitle={q.showOnlyOpen || q.reason !== "all" ? (q.total > 0 ? "Ingen linjer passer filteret" : "Ingen linjer må avklares") : "Fakturaen har ingen linjer"}
          activeLine={active}
          onSelect={(l) => { setSuppressActive(false); q.dispatch({ type: "focus", id: l.id }); setInspectorOpen(true); }}
          onPrev={() => q.dispatch({ type: "prev" })}
          onNext={() => q.dispatch({ type: "next" })}
          selected={q.selected}
          onToggleSelect={(lid, v) => q.setSelected((x) => ({ ...x, [lid]: v }))}
          bulk={{
            count: q.selectedLines.length, acceptable: q.selectedLines.filter(isBulkAcceptable).length, busy: q.bulkBusy,
            onAccept: () => { const n = q.selectedLines.filter(isBulkAcceptable).length; confirmMany.guard(n, "Godta forslag", () => void q.bulkAccept()); },
            onNotApplicable: () => confirmMany.guard(notApplicableCount, "«Ikke vare»", () => void q.bulkNotApplicable()),
            onCreate: () => setLineDialog({ kind: "bulk_create", line: null }), onClear: () => q.setSelected({}),
            onImport: () => setLineDialog({ kind: "bulk_import", line: null }), importable: q.selectedLines.filter((l) => !l.raw_material_id).length,
          }}
          links={q.links}
          toleranceFor={q.toleranceFor}
          showInvoice={false}
          canWrite={lineWrite}
          reconcileReady={(s.next.key === "avstem" && s.next.enabled) || (s.next.key === "kostkontroll" && !!s.assessment?.canReconcile && s.canReconcileRight)}
          isMobile={isMobile}
          countsError={q.countsQuery.isError}
          onSaved={q.handleSaved}
          onLinked={(rmsId, name) => setLastLinked({ rmsId, name })}
          onSecondary={(a, l, prefill) => setLineDialog({ kind: a, line: l, prefill: prefill ?? null })}
          onShowDocument={() => { if (isMobile) setZone("dokument"); else if (!docOpen) toggleDoc(); }}
          onReconcile={runPrimary}
          onCorrectLine={lineWrite ? (l) => startCorrection(l.id) : undefined}
          inspectorAsSheet={!isMobile && (!wide || (showDocZone && !threeZones))}
          inspectorOpen={inspectorOpen}
          onInspectorOpenChange={setInspectorOpen}
          inspectorNote={active ? (
            <div className="space-y-2">
              <Button variant="outline" size="sm" className="min-h-[44px]" onClick={() => startCorrection(active.id)}>Rett fakturalinje</Button>
              {canHold && !(data.invoice_lines ?? []).find((x) => x.id === active.id)?.excluded_at && (
                <Button variant="outline" size="sm" className="min-h-[44px]" onClick={() => openHold(active.id, "line")}>Hold utenfor råvarebehandling …</Button>
              )}
              <SupplierItemScopeNote supplierId={data.supplier_id} line={active} />
            </div>
          ) : null}
          editMaterialSignal={editSignal}
        />
      )}
    </div>
  );

  return (
    <PriceGateProvider gateFor={gateFor}>
    <div className={embedded?.compact ? "space-y-2" : "space-y-4"}>
      <WorkspaceHeader
        compact={!!embedded?.compact}
        backHref={embedded?.backHref ?? fakturaReturn(readReturnParam(sp)).href}
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
        docOpen={docShown}
        onToggleDoc={toggleDoc}
        canWrite={s.canWrite}
        canFetch={canFetchLines({ source: data.source, line_extraction_status: data.line_extraction_status, line_count: (data.invoice_lines ?? []).length })}
        backLabel={embedded?.backLabel ?? fakturaReturn(readReturnParam(sp)).label}
        sumMismatch={data.lines_sum_status === "mismatch"}
        canCorrect={(data.invoice_lines ?? []).length > 0}
        rematchBusy={rematch.busy}
        rematchNote={rematch.note}
        lineProgress={{ done: q.total - q.needs, total: q.total }}
        onMenu={onMenu}
        canHoldOutside={canHold}
      />
      <ExclusionPanel canWrite={s.canWrite}
        invoice={{ id: data.id, is_credit_note: !!data.is_credit_note, updated_at: data.updated_at, lines_sum_status: data.lines_sum_status,
          excluded_at: data.excluded_at, excluded_by: data.excluded_by, exclusion_category: data.exclusion_category, exclusion_reason: data.exclusion_reason }}
        lines={(data.invoice_lines ?? []).map((l) => ({ id: l.id, line_number: l.line_number, description: l.description, updated_at: l.updated_at,
          excluded_at: l.excluded_at, excluded_by: l.excluded_by, exclusion_category: l.exclusion_category, exclusion_reason: l.exclusion_reason }))} />
      <HoldOutsideDialog target={hold} canWrite={lineWrite} onOpenChange={(v) => { if (!v) setHold(null); }}
        onDone={(scope) => { setInspectorOpen(false); void detail.refetch(); q.refresh();
          s.setResult({ title: scope === "invoice" ? "Holdt utenfor råvarebehandling" : "Linjen er holdt utenfor råvarebehandling",
            items: ["Ikke avstemt og ikke godkjent. Du kan gjenåpne fra fakturasiden."] }); }} />
      {focus && !isExcludedInvoice(data.status, data.excluded_at) && (() => {
        const fl = targetLine ? linesById.get(targetLine) : undefined;
        const ret = fakturaReturn(readReturnParam(sp));
        return (
          <FocusNotice kind={focus} backHref={ret.href} backLabel={ret.label} invoiceNumber={data.invoice_number} isCreditNote={!!data.is_credit_note}
            onShowDocument={data.source_document_url ? () => { if (isMobile) setZone("dokument"); else if (!docOpen) toggleDoc(); } : null}
            onOpenControl={() => { setFactsSignal((n) => n + 1); setZone("kontroll"); }}
            onCorrect={lineWrite && fl ? () => startCorrection(fl.id) : null}
            onCredit={s.canWrite ? () => setDialog({ kind: "credit", inv: data }) : null}
            onHoldOutside={canHold ? () => openHold(fl?.id ?? null, "invoice") : null}
            lineIssues={fl ? parseReadIssues(fl.extraction_issues).map((i) => i.message).filter(Boolean) : []}
            priceBasisHref={fl?.raw_material_id ? paths.raavare(fl.raw_material_id, { seksjon: "pris" }) : null} />
        );
      })()}
      {isMobile ? (
        <div className="space-y-3 pb-24">
          <Tabs value={zone} onValueChange={(v) => { if (v === "dokument" || v === "linjer" || v === "kontroll") setZone(v); }}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="dokument" disabled={!data.source_document_url}>Dokument</TabsTrigger>
              <TabsTrigger value="linjer">Linjer{q.needs > 0 ? ` (${q.needs})` : ""}</TabsTrigger>
              <TabsTrigger value="kontroll">Kontroll</TabsTrigger>
            </TabsList>
          </Tabs>
          {zone === "dokument" && data.source_document_url && <div className="h-[75vh] overflow-hidden rounded-lg border border-border bg-card">{docEl}</div>}
          {zone === "linjer" && linesZone}
          {zone === "kontroll" && control(true)}
          {/* Én handlingsflate på mobil: når en linje er åpen eier linjens egen bunnlinje handlingene. */}
          {!(zone === "linjer" && inspectorOpen) && (
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
              <p className="mb-1.5 truncate text-caption text-ink-secondary">{s.next.hint}</p>
              <Button className="min-h-[44px] w-full" disabled={!s.next.enabled || s.busy || fetchLines.isPending} onClick={runPrimary}>{s.next.label}</Button>
            </div>
          )}
        </div>
      ) : showDocZone ? (
        <div className={threeZones ? "grid items-start gap-4 grid-cols-[minmax(0,42%)_minmax(0,1fr)]" : "grid items-start gap-4 grid-cols-[minmax(0,50%)_minmax(0,1fr)]"}>
          <aside className="sticky top-28 h-[calc(100vh-8rem)] min-w-0 overflow-hidden rounded-lg border border-border bg-card">{docEl}</aside>
          {linesZone}
        </div>
      ) : linesZone}
      {docOpen && !wide && !isMobile && !!data.source_document_url && (
        <Sheet open onOpenChange={(v) => { if (!v) toggleDoc(); }}>
          <SheetContent side="bottom" className="h-[90vh] p-0"><SheetTitle className="sr-only">Originalfaktura</SheetTitle>{docEl}</SheetContent>
        </Sheet>
      )}
      <SumOverrideDialog open={overrideOpen} onOpenChange={setOverrideOpen} data={data} canOverride={lineWrite} onDone={() => { setOverrideOpen(false); void detail.refetch(); }} />
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader><SheetTitle>Revisjonshistorikk</SheetTitle></SheetHeader>
          <div className="mt-4"><AuditHistory entityId={data.id} kind="invoice" /></div>
        </SheetContent>
      </Sheet>
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} bindings={HELP} />
      <FakturaerDialogs state={dialog} onClose={() => setDialog(null)} onDone={(k) => { if (k !== "flag") setDialog(null); void detail.refetch(); }} />
      {confirmMany.dialog}
      <CorrectLineDialog
        open={!!correctFor}
        onOpenChange={(v) => { if (!v) setCorrectTarget(null); }}
        lineId={correctFor}
        targetInvoiceId={correctFor ? correctTarget?.invoiceId ?? null : null}
        returnFocus={correctionReturnFocus}
        invoice={{ id: data.id, status: data.status, approved: !!s.steps?.find((x) => x.key === "godkjent")?.done, supplier_id: data.supplier_id, supplier_name: data.suppliers?.name ?? null }}
        canWrite={s.canWrite}
        key={correctFor ? `${correctTarget?.invoiceId}:${correctFor}` : "lukket"}
        document={correctDocEl}
        onSaved={(r) => { q.refresh(); void detail.refetch(); s.setResult({ title: "Fakturalinjen er rettet", items: [
          `${r.changed.length} ${r.changed.length === 1 ? "felt" : "felt"} endret. Kobling og pris beregnes på nytt.`,
          ...(r.exampleId ? ["Lagret som bekreftet eksempel for leverandøren (gjenbruk, ikke retrening)."] : []),
          ...r.remainingIssues.map((x) => x.message),
          ...(r.linesSumStatus === "mismatch" ? ["Linjesummen stemmer fortsatt ikke med fakturabeløpet."] : []),
        ] }); }}
      />
      <LineDialogs dialog={lineDialog} onClose={() => {
        // Startpris: hent linjens og fakturaens status på nytt fra serveren før neste steg vises.
        const refresh = lineDialog?.kind === "start_price";
        setLineDialog(null);
        if (refresh) { q.refresh(); void detail.refetch(); }
      }} q={q} canWrite={lineWrite} invoice={data} onEditMaterial={() => editMaterial()}
        onNotItemDone={(l, info) => { q.remember(l, `Ikke vare: ${l.description ?? "linje"}`); q.refresh(); s.setResult({ title: "Linjen er merket som ikke vare", items: notItemResultItems(l.description, info.patternId), undoable: true }); }} />
    </div>
    </PriceGateProvider>
  );
}
