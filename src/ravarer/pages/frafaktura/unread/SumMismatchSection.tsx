import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useCompany } from "@/hooks/useCompany";
import { newOpId, useCapability } from "@/lib/pendingRpc";
import { paths } from "@/ravarer/lib/paths";
import { dateNo } from "@/ravarer/lib/decisions";
import { useBulkRereadRun } from "@/fakturaer/hooks/useBulkRereadRun";
import { useExtractionCostRows } from "@/fakturaer/hooks/useBulkRereadGroups";
import { estimateCost, fmtUsd } from "@/fakturaer/lib/bulkReread";
import { useSumAccept } from "@/ravarer/hooks/useSumAccept";
import { ACCEPT_CATEGORIES, sumRejectText } from "@/ravarer/lib/fraFaktura/sumAccept";
import { sumDifference, sumDifferenceText, unreadReason, type UnreadInput } from "@/ravarer/lib/fraFaktura/unread";
import { AcceptSumDialog, type AcceptReceipt, type AcceptTarget } from "./AcceptSumDialog";

const kr = (v: number | null) => (v == null ? "–" : `${Number(v).toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`);
type Receipt = AcceptReceipt & { undo: { busy: boolean; text: string | null; opId: string | null } };

/**
 * «Lest, men summen stemmer ikke»: fakturaer med linjer. Lesekøen tar dem ikke, så de leses på nytt med forslag
 * (dagens gjenlesing: rm_begin_invoice_reread + reread-invoice-preview, tas i bruk per faktura via rm_apply_invoice_reread)
 * eller godtas med begrunnelse (20261119_godta_sum).
 */
export function SumMismatchSection({ list, names, canWrite, retur }: { list: UnreadInput[]; names: Map<string, string>; canWrite: boolean; retur: string }) {
  const { data: company } = useCompany();
  const bulk = useBulkRereadRun(company?.id ?? null);
  const cost = useExtractionCostRows(canWrite);
  const canAccept = useCapability("rm_cap_godta_sum_v1");
  const { undo } = useSumAccept();
  const [confirm, setConfirm] = useState(false);
  const [target, setTarget] = useState<AcceptTarget | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const undoLock = useRef(new Set<string>());
  const title = (i: UnreadInput) => `${names.get(i.supplier_id ?? "") ?? "Ukjent leverandør"} · ${i.invoice_number ?? "uten nummer"} · ${dateNo(i.invoice_date)}`;
  const accepted = new Set(receipts.map((r) => r.invoiceId));
  const rows = list.filter((i) => !accepted.has(i.id));
  const runFor = useMemo(() => new Map(bulk.results.map((r) => [r.invoice.id, r])), [bulk.results]);
  const est = estimateCost(cost.data ?? null, rows.length);

  const startBulk = () => {
    setConfirm(false);
    void bulk.start("gamle_avvik", rows.map((i) => ({ id: i.id, invoice_number: i.invoice_number, invoice_date: i.invoice_date, supplier_name: names.get(i.supplier_id ?? "") ?? null, total_amount: i.total_amount, lines_sum_variance_pct: null })));
  };
  const runUndo = async (r: Receipt) => {
    if (!r.auditId || undoLock.current.has(r.invoiceId)) return;
    undoLock.current.add(r.invoiceId);
    const opId = r.undo.opId ?? newOpId(); // ukjent utfall gjentas med samme nøkkel
    setReceipts((xs) => xs.map((x) => (x.invoiceId === r.invoiceId ? { ...x, undo: { busy: true, text: null, opId } } : x)));
    try {
      const o = await undo({ auditId: r.auditId, opId });
      if (o.kind === "ok") { setReceipts((xs) => xs.filter((x) => x.invoiceId !== r.invoiceId)); return; }
      const text = o.kind === "avvist" ? sumRejectText(o.code) : "Utfallet er ukjent. Trykk «Angre» igjen – det blir ikke registrert to ganger.";
      setReceipts((xs) => xs.map((x) => (x.invoiceId === r.invoiceId ? { ...x, undo: { busy: false, text, opId: o.kind === "ukjent" ? opId : null } } : x)));
    } finally { undoLock.current.delete(r.invoiceId); }
  };

  return (
    <section aria-labelledby="ff-ul-sum" className="border-t border-line-subtle">
      <div className="flex flex-wrap items-start gap-3 px-4 py-4 md:px-5">
        <div className="min-w-0 flex-1">
          <h3 id="ff-ul-sum" className="text-body font-semibold">Lest, men summen stemmer ikke <span className="tabular-nums text-ink-secondary">{rows.length.toLocaleString("nb-NO")}</span></h3>
          <p className="text-caption text-ink-secondary">Linjene er lest, men summen av dem stemmer ikke med fakturaen. Les på nytt for å få nye linjer som forslag – de gamle erstattes først når du godtar forslaget. Eller godta summen hvis avviket er avgifter, pant eller øreavrunding.</p>
        </div>
        {canWrite && rows.length > 0 && (
          bulk.running
            ? <Button variant="outline" className="min-h-[44px]" onClick={bulk.stop}><Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />Stopp etter denne</Button>
            : <Button variant="outline" className="min-h-[44px]" onClick={() => setConfirm(true)}>Les alle på nytt med forslag</Button>
        )}
      </div>
      {bulk.state.phase !== "idle" && (
        <p role="status" className="px-5 pb-3 text-sm">
          {bulk.state.phase === "running" ? `Leser ${bulk.state.progress.done + 1} av ${bulk.state.progress.total} …` : `${bulk.state.message} ${bulk.results.filter((r) => r.outcome === "forslag").length} forslag er klare – gå gjennom dem på radene under.`}
        </p>
      )}
      {receipts.length > 0 && (
        <ul aria-label="Godtatt" className="space-y-1 px-4 pb-3 md:px-5">
          {receipts.map((r) => (
            <li key={r.invoiceId} role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm">
              <Check className="h-4 w-4 text-success" aria-hidden /><span className="font-semibold">{r.title}</span>
              <span>– summen godtatt ({ACCEPT_CATEGORIES.find((c) => c.id === r.category)?.label.toLowerCase()})</span>
              {r.auditId && <Button variant="ghost" size="sm" className="ml-auto min-h-[44px] gap-1.5" disabled={r.undo.busy} onClick={() => void runUndo(r)}><Undo2 className="h-4 w-4" aria-hidden />Angre</Button>}
              {r.undo.text && <span role="alert" className="w-full text-caption text-destructive">{r.undo.text}</span>}
            </li>
          ))}
        </ul>
      )}
      {rows.length === 0 ? <p className="px-5 pb-6 text-center text-body text-ink-secondary">Ingen leste fakturaer med sumavvik.</p> : (
        <ul aria-label="Lest, men summen stemmer ikke">
          {rows.map((i) => {
            const d = sumDifference(i);
            const run = runFor.get(i.id);
            return (
              <li key={i.id} className="grid gap-2 border-t border-line-subtle px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_8rem_minmax(0,1.6fr)_auto] md:items-center md:px-5">
                <p><strong>{names.get(i.supplier_id ?? "") ?? "Ukjent leverandør"}</strong> <span className="text-ink-secondary">· {i.invoice_number ?? "uten nummer"} · {dateNo(i.invoice_date)}</span></p>
                <p className="tabular-nums md:text-right">{kr(i.total_amount)}</p>
                <div className="text-sm">
                  <p className="text-ink-secondary">{i.lines_sum_status === "mismatch" ? sumDifferenceText(d) : unreadReason(i)}</p>
                  {run?.outcome === "forslag" && run.runId && <Link className="font-semibold text-primary hover:underline" to={paths.lesPaNytt(i.id, { kjoring: run.runId })}>Forslaget er klart – gå gjennom</Link>}
                  {run && run.outcome !== "forslag" && <p className="text-caption text-ink-secondary">{run.outcome === "hoppet_over" ? "Kan ikke leses på nytt (låst, godkjent, ført kost eller mangler PDF)." : "Lesingen feilet. Prøv igjen senere."}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {canWrite && <Button asChild variant="outline" className="min-h-[44px]"><Link to={paths.lesPaNytt(i.id)}>Les på nytt</Link></Button>}
                  {canWrite && i.lines_sum_status === "mismatch" && (
                    <Button variant="outline" className="min-h-[44px]" disabled={canAccept !== true || !i.updated_at}
                      title={canAccept === false ? "Venter på databaseendring. Til da: åpne fakturaen og bruk «Overstyr med begrunnelse»." : undefined}
                      onClick={() => i.updated_at && setTarget({ invoiceId: i.id, updatedAt: i.updated_at, title: title(i), diffText: sumDifferenceText(d) })}>Godta som den er</Button>
                  )}
                  <Button asChild variant="outline" className="min-h-[44px]"><Link to={paths.faktura(i.id, { retur })}>Åpne PDF</Link></Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canWrite && canAccept === false && rows.length > 0 && (
        <p className="border-t border-line-subtle px-5 py-3 text-caption text-ink-secondary">«Godta som den er» med angring venter på en databaseendring. Til da kan du åpne fakturaen og bruke «Overstyr med begrunnelse» der.</p>
      )}
      <AcceptSumDialog target={target} onClose={() => setTarget(null)} onAccepted={(r) => setReceipts((xs) => [{ ...r, undo: { busy: false, text: null, opId: null } }, ...xs])} />
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Les {rows.length} {rows.length === 1 ? "faktura" : "fakturaer"} på nytt med forslag?</AlertDialogTitle>
            <AlertDialogDescription>
              Originalen leses av AI-tjenesten én faktura om gangen (anslått kostnad {fmtUsd(est.totalUsd)}). Du får nye linjer som forslag – ingenting erstattes før du går gjennom og godtar forslaget for hver faktura.
              Låste, godkjente fakturaer og fakturaer med ført kost hoppes over. Kjøringen stopper hvis AI-tjenesten feiler.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={startBulk}>Les på nytt</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
