import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useCompany } from "@/hooks/useCompany";
import { useDebouncedValue } from "@/kunder/hooks/useDebouncedValue";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { approveMany, type OverviewRow } from "@/fakturaer/lib/approval";
import { postSafeCosts } from "@/fakturaer/lib/costPosting";
import { formatMoney } from "@/fakturaer/lib/constants";
import { paginate, sumByCurrency } from "@/fakturaer/lib/ravarerQueueFilter";
import { useWorkSummary } from "@/ravarer/hooks/useWorkData";
import { useUserNames } from "@/ravarer/hooks/useUserNames";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import { paths } from "@/ravarer/lib/paths";
import { DataTable } from "@/ravarer/ui/DataTable";
import { FilterChips } from "@/ravarer/ui/FilterChips";
import { ResultBox } from "@/ravarer/ui/ResultBox";
import { DeliveryTimeline } from "@/ravarer/pages/priskontroll/faktura/DeliveryTimeline";
import { blockerLabel } from "@/fakturaer/lib/approval";
import { ApprovalHistorySheet } from "./ApprovalHistorySheet";
import { ApprovedBy, approvalColumns, RowMenu } from "./approvalColumns";
import { bulkActionGate, approvalReport, countByStatus, filterApprovalRows, GODKJENNING_LABEL, GODKJENNING_STATUSER, parseGodkjenningStatus, type GodkjenningStatus } from "./approvalLogic";
import { approvalSteps, useApprovalDelivery, useApprovalOverview } from "./useGodkjenning";

const PAGE = 25;

type Result = { title: string; items: string[]; error: boolean } | null;

/** Godkjenning: hurtigfiltre, tabell, masse-godkjenning og kostprisføring. */
export function GodkjenningTab() {
  const qc = useQueryClient();
  const location = useLocation();
  const [sp, setSp] = useSearchParams();
  const { data: company } = useCompany();
  const { canApprove, canWrite } = useInvoiceRights();
  const gate = bulkActionGate({ canApprove, canWrite });
  const status = parseGodkjenningStatus(sp.get("status"));
  const leverandor = sp.get("leverandor");
  const page = Math.max(1, Number(sp.get("side") ?? "1") || 1);
  const [q, setQ] = useState(sp.get("q") ?? "");
  const debounced = useDebouncedValue(q, 300);
  const overview = useApprovalOverview(company?.id ?? null);
  const { data: summary } = useWorkSummary({ includeApproval: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<"approve" | "costs" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [history, setHistory] = useState<OverviewRow | null>(null);

  const update = (next: Record<string, string | null>) => {
    setSp((prev) => {
      const p = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k); }
      if (!("side" in next)) p.delete("side");
      return p;
    }, { replace: true });
    setSelected(new Set());
  };
  useEffect(() => {
    if (debounced !== (sp.get("q") ?? "")) update({ q: debounced || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const rows = useMemo(() => overview.data ?? [], [overview.data]);
  const counts = useMemo(() => countByStatus(rows), [rows]);
  const suppliers = useMemo(() => [...new Map(rows.filter((r) => r.supplier_id).map((r) => [r.supplier_id as string, r.supplier_name ?? "Ukjent"])).entries()].sort((a, b) => a[1].localeCompare(b[1], "nb")), [rows]);
  const visible = useMemo(() => filterApprovalRows(rows, { status, q: sp.get("q") ?? "", leverandor }), [rows, status, sp, leverandor]);
  const pg = paginate(visible, page, PAGE);
  const ids = pg.items.map((r) => r.invoice_id);
  const delivery = useApprovalDelivery(ids);
  const names = useUserNames(pg.items.map((r) => r.approved_by));
  const chosenRows = pg.items.filter((r) => selected.has(r.invoice_id));
  const approvable = chosenRows.filter((r) => !r.approved_at && r.blockers.length === 0);
  const postable = chosenRows.filter((r) => !!r.approved_at);
  const sums = sumByCurrency(chosenRows);
  const fra = `${location.pathname}${location.search}`;
  const numberOf = (id: string) => rows.find((r) => r.invoice_id === id)?.invoice_number ?? "Faktura";

  const chips = GODKJENNING_STATUSER.map((s) => ({
    id: s, label: GODKJENNING_LABEL[s],
    count: s === "klare" ? summary?.approval?.ready_to_approve ?? counts.klare : s === "godkjent" ? summary?.approval?.approved_total ?? counts.godkjent : counts[s],
  }));

  const refresh = () => {
    invalidateRavarerCounts(qc);
    void qc.invalidateQueries({ queryKey: ["invoice-approval-overview"] });
    void qc.invalidateQueries({ queryKey: ["approval-delivery"] });
    void qc.invalidateQueries({ queryKey: ["invoice-delivery-status"] });
    void qc.invalidateQueries({ queryKey: ["audit-history"] });
  };

  async function runApprove() {
    const list = approvable.map((r) => r.invoice_id);
    setProgress({ done: 0, total: list.length });
    const res = await approveMany(list, null, undefined, (done, total) => setProgress({ done, total }));
    setProgress(null);
    const rep = approvalReport(res, numberOf);
    setResult({ title: rep.title, items: rep.items, error: rep.failed > 0 });
    setSelected(new Set());
    refresh();
  }
  async function runCosts() {
    const list = postable.map((r) => r.invoice_id);
    setProgress({ done: 0, total: list.length });
    const res = await postSafeCosts(list);
    setProgress(null);
    const posted = res.reduce((a, r) => a + r.posted, 0);
    const skipped = res.reduce((a, r) => a + r.skipped, 0);
    const failed = res.filter((r) => r.error);
    setResult({
      title: `Kostpris ført på ${posted} trygge linjer`,
      items: [`${skipped} linjer venter på avklaring`, ...failed.map((f) => `${numberOf(f.invoiceId)}: ${f.error}`)],
      error: failed.length > 0,
    });
    setSelected(new Set());
    refresh();
  }

  return (
    <div className="space-y-4 px-page py-4">
      <p className="text-caption text-ink-secondary">Intern godkjenning i NBhub. Den betaler ikke og sendes ikke til Tripletex. Råvarevalg sperrer ikke godkjenning.</p>
      <FilterChips chips={chips} value={status} onChange={(s: GodkjenningStatus) => update({ status: s })} />
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-secondary" aria-hidden />
          <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk fakturanr eller leverandør" aria-label="Søk fakturanr eller leverandør" />
        </div>
        <Select value={leverandor ?? "all"} onValueChange={(v) => update({ leverandor: v === "all" ? null : v })}>
          <SelectTrigger className="w-[220px]" aria-label="Leverandør"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle leverandører</SelectItem>
            {suppliers.map(([id, n]) => <SelectItem key={id} value={id}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {progress && (
        <div role="status" className="space-y-1 rounded-lg border border-border bg-card p-3 text-sm">
          <span>Behandler {progress.done} av {progress.total} …</span>
          <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} className="h-2" />
        </div>
      )}
      {result && (result.error
        ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><p className="font-medium">{result.title}</p><ul className="mt-1 list-disc pl-4">{result.items.map((t, i) => <li key={`${i}-${t}`}>{t}</li>)}</ul><Button className="mt-2" size="sm" variant="ghost" onClick={() => setResult(null)}>Lukk</Button></div>
        : <ResultBox title={result.title} items={result.items} onNext={() => setResult(null)} nextLabel="Lukk" />)}
      <DataTable
        ariaLabel="Fakturaer til godkjenning"
        rows={pg.items}
        columns={approvalColumns({ delivery: delivery.data, names: names.data, onHistory: setHistory, fra })}
        getId={(r) => r.invoice_id}
        isLoading={overview.isLoading || !company}
        error={overview.error}
        onRetry={() => void overview.refetch()}
        emptyText="Ingen fakturaer her"
        preferenceScope="ravarer.godkjenning.kolonner"
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        rowHref={(r) => `${paths.faktura(r.invoice_id)}?retur=${encodeURIComponent(fra)}`}
        renderMobileCard={(r) => (
          <div className="space-y-1.5 rounded-lg border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0"><span className="block truncate font-medium">{r.supplier_name ?? "Ukjent leverandør"}</span><span className="text-caption text-ink-secondary">{r.invoice_number}</span></span>
              <span className="flex items-center gap-1 tabular-nums">{formatMoney(r.total_amount, r.currency)}<RowMenu r={r} onHistory={setHistory} fra={fra} /></span>
            </div>
            <DeliveryTimeline steps={approvalSteps(r, delivery.data?.get(r.invoice_id))} creditNote={r.is_credit_note} showLabel />
            {r.blockers.length > 0 && <p className="text-caption text-warning">{r.blockers.map(blockerLabel).join(" · ")}</p>}
            {r.approved_at && <ApprovedBy r={r} names={names.data} />}
          </div>
        )}
      />
      {visible.length > PAGE && (
        <nav aria-label="Sider" className="flex items-center justify-between text-sm">
          <Button variant="outline" size="sm" disabled={pg.page <= 1} onClick={() => update({ side: String(pg.page - 1) })}>Forrige</Button>
          <span className="tabular-nums text-ink-secondary">{visible.length} fakturaer · side {pg.page} av {pg.pages}</span>
          <Button variant="outline" size="sm" disabled={pg.page >= pg.pages} onClick={() => update({ side: String(pg.page + 1) })}>Neste</Button>
        </nav>
      )}
      {chosenRows.length > 0 && (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 shadow-lg">
          <span className="text-sm" aria-live="polite">
            <strong>{chosenRows.length}</strong> valgt{sums.length > 0 && ` · ${sums.map((c) => `${formatMoney(c.total, c.currency)} inkl. mva.`).join(" · ")}`}
          </span>
          <span className="flex-1" />
          {(gate.approveReason || gate.costsReason) && <span className="text-caption text-ink-secondary">{[gate.approveReason, gate.costsReason].filter(Boolean).join(" · ")}</span>}
          <Button size="sm" disabled={!gate.approve || approvable.length === 0 || !!progress} title={gate.approveReason ?? undefined} onClick={() => setConfirm("approve")}>Godkjenn valgte ({approvable.length})</Button>
          <Button size="sm" variant="outline" disabled={!gate.costs || postable.length === 0 || !!progress} title={gate.costsReason ?? undefined} onClick={() => setConfirm("costs")}>Før kostpris for trygge linjer ({postable.length})</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Fjern valg</Button>
        </div>
      )}
      <AlertDialog open={confirm != null} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "approve" ? `Godkjenne ${approvable.length} fakturaer internt?` : `Føre kostpris for ${postable.length} fakturaer?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "approve"
                ? "Intern attestasjon i NBhub. Utløser ikke betaling og sendes ikke til Tripletex. Serveren kontrollerer hver faktura på nytt, og en feil stopper ikke resten."
                : "Bare trygge linjer føres. Usikre linjer hoppes over og venter på avklaring."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const c = confirm; setConfirm(null); if (c === "approve") void runApprove(); else void runCosts(); }}>
              {confirm === "approve" ? "Godkjenn internt" : "Før kostpris"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ApprovalHistorySheet row={history} canApprove={canApprove} onClose={() => setHistory(null)} />
    </div>
  );
}
