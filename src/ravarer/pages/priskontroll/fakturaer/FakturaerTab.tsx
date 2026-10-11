import { useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Download, Flag, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCompany } from "@/hooks/useCompany";
import { useFakturaer } from "@/fakturaer/context/FakturaerContext";
import { useRematchStatus } from "@/fakturaer/hooks/useRematchStatus";
import type { InboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";
import { formatNok } from "@/fakturaer/lib/constants";
import { useWorkSummary } from "@/ravarer/hooks/useWorkData";
import { useInvoiceDeliveryStatus } from "@/ravarer/hooks/useInvoiceDeliveryStatus";
import { paths } from "@/ravarer/lib/paths";
import { DataTable } from "@/ravarer/ui/DataTable";
import { TripletexStatusCard } from "@/ravarer/components/TripletexStatusCard";
import { useRematchInvoices } from "@/ravarer/pages/priskontroll/gjore/useGjoreMutations";
import { DeliveryTimeline } from "@/ravarer/pages/priskontroll/faktura/DeliveryTimeline";
import { useFetchInvoiceLines } from "@/ravarer/pages/priskontroll/faktura/useInvoiceActions";
import { FakturaerFilters } from "./FakturaerFilters";
import { FakturaRowActions, type RowAction } from "./FakturaRowActions";
import { FakturaerDialogs, type DialogState } from "./FakturaerDialogs";
import { VisningChips } from "./VisningChips";
import { fakturaColumns, isOverdue, stepsOf } from "./fakturaColumns";
import { FILTER_KEYS, parseFilters, toCsv } from "./fakturaListLogic";
import { FAKTURA_PAGE_SIZE, useFakturaListe } from "./useFakturaListe";
import { parseVisning, RETURN_PARAM } from "./visning";

/** Fakturaer-fanen: én liste med hurtigfiltre, filtre, leveransestatus og masse-handlinger. */
export function FakturaerTab() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sp, setSp] = useSearchParams();
  const { data: company } = useCompany();
  const legalEntityId = company?.id ?? null;
  const { canWrite, canReconcile } = useFakturaer();
  const { visning, modus } = parseVisning(sp);
  const filters = useMemo(() => parseFilters(sp), [sp]);
  const page = Math.max(1, Number(sp.get("side") ?? "1") || 1);
  const liste = useFakturaListe({ legalEntityId, visning, modus, filters, page });
  const { data: summary } = useWorkSummary();
  const extras = useInvoiceDeliveryStatus(liste.rows.map((r) => r.id));
  const rematch = useRematchInvoices();
  const rematchStatus = useRematchStatus(legalEntityId);
  const fetchLines = useFetchInvoiceLines();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const update = (next: Record<string, string | null>, resetPage = true) => {
    setSp((prev) => {
      const p = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(next)) {
        if (v == null || v === "") p.delete(k);
        else p.set(k, v);
      }
      if (resetPage) p.delete("side");
      return p;
    }, { replace: true });
    setSelected(new Set());
  };
  const reset = () => update(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
  const open = (inv: InboxInvoice) => navigate(paths.faktura(inv.id, { [RETURN_PARAM]: location.search }));

  const queueRematch = (ids: string[]) => {
    if (ids.length === 0) return;
    rematch.mutate(ids, {
      onSuccess: (r) => toast.success(`${r.queued} ${r.queued === 1 ? "faktura" : "fakturaer"} lagt i kø for ny beregning`),
      onError: (e: Error) => toast.error(e.message),
    });
  };

  const onAction = (inv: InboxInvoice, a: RowAction) => {
    if (a === "open" || a === "resolve" || a === "view_flag") open(inv);
    else if (a === "rematch") queueRematch([inv.id]);
    else if (a === "flag") setDialog({ kind: "flag", ids: [inv.id] });
    else if (a === "unflag") setDialog({ kind: "unflag", inv });
    else if (a === "register_lines") navigate(paths.registrerLinjer(inv.id));
    else if (a === "link_credit_note") setDialog({ kind: "credit", inv });
    else if (a === "finish") setDialog({ kind: "reconcile", inv });
    else if (a === "fetch_lines") {
      setBusyId(inv.id);
      fetchLines.mutate(inv, {
        onSuccess: () => toast.success("Linjer hentet"),
        onError: (e: Error) => toast.error(e.message),
        onSettled: () => setBusyId(null),
      });
    }
  };

  const selectedRows = liste.rows.filter((r) => selected.has(r.id));
  const exportCsv = () => {
    const rows = selectedRows.length > 0 ? selectedRows : liste.rows;
    const blob = new Blob([`\uFEFF${toCsv(rows)}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fakturaer.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const columns = fakturaColumns(extras.data, (inv) => (
    <FakturaRowActions inv={inv} canWrite={canWrite} canReconcile={canReconcile} busy={busyId === inv.id} onAction={onAction} />
  ));
  const totalPages = Math.max(1, Math.ceil(liste.total / FAKTURA_PAGE_SIZE));
  const queue = rematchStatus.data;
  const targets = liste.openInSelection.map((i) => i.id);

  return (
    <div className="space-y-3">
      <TripletexStatusCard />
      <div className="flex flex-wrap items-center gap-2">
        <VisningChips visning={visning} modus={modus} counts={{ ...liste.openCounts, inv: summary?.invoices ?? null, alle: visning === "alle" ? liste.total : null }} onChange={(v, m) => update({ visning: v, modus: m })} />
        {canWrite && visning !== "avstemt" && (
          <Button size="sm" variant="outline" className="ml-auto gap-1.5" disabled={rematch.isPending || targets.length === 0} onClick={() => queueRematch(targets)}>
            {rematch.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RotateCw className="h-3.5 w-3.5" aria-hidden />}
            Oppdater matching ({targets.length} {targets.length === 1 ? "faktura" : "fakturaer"})
          </Button>
        )}
        {queue && queue.queued + queue.in_flight > 0 && (
          <span className="text-caption text-ink-secondary" aria-live="polite">I kø: {queue.queued + queue.in_flight}</span>
        )}
      </div>
      <FakturaerFilters filters={filters} legalEntityId={legalEntityId} showStatus={visning === "alle"} onChange={update} onReset={reset} />
      {selected.size > 0 && (
        <Card className="flex flex-wrap items-center gap-2 border-primary/30 bg-primary/5 p-3">
          <span className="text-sm font-medium">{selected.size} valgt</span>
          {canWrite && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => queueRematch([...selected])}><RotateCw className="h-3.5 w-3.5" aria-hidden />Beregn valgte på nytt</Button>}
          {canWrite && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDialog({ kind: "flag", ids: [...selected] })}><Flag className="h-3.5 w-3.5" aria-hidden />Flagg valgte …</Button>}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCsv}><Download className="h-3.5 w-3.5" aria-hidden />Eksporter CSV</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Nullstill</Button>
        </Card>
      )}
      <DataTable
        ariaLabel="Fakturaer"
        rows={liste.rows}
        columns={columns}
        getId={(r) => r.id}
        isLoading={liste.isLoading}
        error={liste.error}
        onRetry={liste.refetch}
        emptyText={visning === "trenger" ? "Ingen fakturaer trenger deg nå" : "Ingen fakturaer i dette utvalget"}
        preferenceScope="ravarer:fakturaer:kolonner"
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        onRowClick={open}
        renderMobileCard={(r) => (
          <Card className="space-y-1.5 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-medium">{r.supplier_name ?? "Ukjent leverandør"}</span>
              <span className="tabular-nums text-sm">{formatNok(r.total_amount)}</span>
            </div>
            <div className="text-caption text-ink-secondary">
              {r.invoice_number}{isOverdue(r) ? <span className="text-destructive"> · forfalt</span> : null}
            </div>
            <DeliveryTimeline steps={stepsOf(r, extras.data)} flagged={r.status === "flagged"} creditNote={!!r.is_credit_note} showLabel />
            <FakturaRowActions inv={r} canWrite={canWrite} canReconcile={canReconcile} busy={busyId === r.id} onAction={onAction} />
          </Card>
        )}
        footer={
          <div className="mt-2 flex items-center justify-between text-caption text-ink-secondary">
            <span>{liste.total} {liste.total === 1 ? "faktura" : "fakturaer"}</span>
            <span className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1" onClick={exportCsv}><Download className="h-3.5 w-3.5" aria-hidden />CSV</Button>
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => update({ side: String(page - 1) }, false)}>Forrige</Button>
              <span className="tabular-nums">Side {page} av {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => update({ side: String(page + 1) }, false)}>Neste</Button>
            </span>
          </div>
        }
      />
      <FakturaerDialogs state={dialog} onClose={() => { setDialog(null); setSelected(new Set()); }} />
    </div>
  );
}
