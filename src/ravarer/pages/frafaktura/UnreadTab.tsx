import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/common/QueryState";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { paths } from "@/ravarer/lib/paths";
import { dateNo } from "@/ravarer/lib/decisions";
import { parseRequeueResult } from "@/fakturaer/lib/bulkReread";
import { useSupplierNames, useUnreadInvoices } from "@/ravarer/hooks/useFraFaktura";
import { canRequeue, requeueMessage, unreadGroup, unreadReason } from "@/ravarer/lib/fraFaktura/unread";
import { SumMismatchSection } from "./unread/SumMismatchSection";
import { PendingReads } from "./unread/PendingReads";

const kr = (v: number | null) => (v == null ? "–" : `${Number(v).toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`);

/**
 * Ikke lest (D4), i to grupper: «Ikke lest» (ingen linjer – «Les alle på nytt» legger dem i den vanlige lesekøen)
 * og «Lest, men summen stemmer ikke» (har linjer – gjenlesing med forslag eller «Godta som den er»).
 * Fakturaer som står i lesekøen vises sammenfoldet nederst.
 */
export function UnreadTab({ canWrite, retur }: { canWrite: boolean; retur: string }) {
  const q = useUnreadInvoices();
  const names = useSupplierNames();
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const lock = useRef(false);
  const list = q.data ?? [];
  const noLines = list.filter((i) => unreadGroup(i) === "uten_linjer");
  const withLines = list.filter((i) => unreadGroup(i) === "har_linjer");
  const eligible = noLines.filter(canRequeue);

  const run = async () => {
    if (lock.current || !company || eligible.length === 0) return;
    lock.current = true; setBusy(true); setResult(null);
    const le = company.id;
    let requeued = 0; const skipped: { reason: string }[] = [];
    try {
      for (let i = 0; i < eligible.length; i += 200) {
        const { data, error } = await supabase.rpc("rm_requeue_invoice_line_extraction", { p_legal_entity_id: le, p_invoice_ids: eligible.slice(i, i + 200).map((x) => x.id) });
        if (error) throw new Error(error.code === "42501" ? "Du har ikke skrivetilgang til fakturaer." : "Utfallet er ukjent. Se listen etter en stund før du prøver igjen.");
        const r = parseRequeueResult(data);
        if (!r) throw new Error("Utfallet er ukjent. Se listen etter en stund før du prøver igjen.");
        requeued += r.requeued; skipped.push(...r.skipped);
      }
      setResult({ ok: true, text: requeueMessage({ requeued, skipped, withLines: withLines.length }) });
    } catch (e) {
      // Delkvittering beholdes: det som allerede er lagt i køen, er lagt i køen.
      const done = requeued > 0 ? `${requeued.toLocaleString("nb-NO")} ble lagt i lesekøen før feilen. ` : "";
      setResult({ ok: false, text: `${done}${e instanceof Error ? e.message : "Utfallet er ukjent."}` });
    } finally {
      lock.current = false; setBusy(false); setConfirm(false);
      void qc.invalidateQueries({ queryKey: ["ravarer", "fra-faktura", "unread"] });
      void qc.invalidateQueries({ queryKey: ["ravarer", "fra-faktura", "pending-reads"] });
    }
  };

  return (
    <section aria-labelledby="ff-ul" className="overflow-hidden rounded-2xl border border-line-subtle bg-card">
      <div className="px-4 pt-4 md:px-5">
        <h2 id="ff-ul" className="font-serif text-title">Fakturaer som ikke ble lest ferdig</h2>
        <p className="text-body text-ink-secondary">Systemet prøver selv på nytt. Du trenger bare å se her hvis en faktura blir liggende.</p>
      </div>
      {result && <p role={result.ok ? "status" : "alert"} className={result.ok ? "px-5 pt-3 text-sm" : "px-5 pt-3 text-sm text-destructive"}>{result.text}</p>}
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} scope="ravarer:fra-faktura:ikke-lest" onRetry={() => void q.refetch()}>
        <section aria-labelledby="ff-ul-ny" className="mt-3 border-t border-line-subtle">
          <div className="flex flex-wrap items-start gap-3 px-4 py-4 md:px-5">
            <div className="min-w-0 flex-1">
              <h3 id="ff-ul-ny" className="text-body font-semibold">Ikke lest <span className="tabular-nums text-ink-secondary">{noLines.length.toLocaleString("nb-NO")}</span></h3>
              <p className="text-caption text-ink-secondary">Fakturaer uten linjer. De kan legges tilbake i den vanlige lesekøen.</p>
            </div>
            {canWrite && (
              <Button className="min-h-[44px]" disabled={eligible.length === 0 || busy} onClick={() => setConfirm(true)}>
                {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}Les alle på nytt
              </Button>
            )}
          </div>
          {noLines.length === 0 ? <p className="px-5 pb-6 text-center text-body text-ink-secondary">Ingen fakturaer uten linjer.</p> : (
            <ul aria-label="Ikke lest">
              {noLines.map((i) => (
                <li key={i.id} className="grid gap-2 border-t border-line-subtle px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_8rem_minmax(0,1.6fr)_auto] md:items-center md:px-5">
                  <p><strong>{names.get(i.supplier_id ?? "") ?? "Ukjent leverandør"}</strong> <span className="text-ink-secondary">· {i.invoice_number ?? "uten nummer"} · {dateNo(i.invoice_date)}</span></p>
                  <p className="tabular-nums md:text-right">{kr(i.total_amount)}</p>
                  <p className="text-sm text-ink-secondary">{unreadReason(i)}</p>
                  <Button asChild variant="outline" className="min-h-[44px]"><Link to={paths.faktura(i.id, { retur })}>Åpne PDF</Link></Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <SumMismatchSection list={withLines} names={names} canWrite={canWrite} retur={retur} />
      </QueryState>
      <PendingReads names={names} />
      <AlertDialog open={confirm} onOpenChange={(o) => !busy && setConfirm(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Les {eligible.length} {eligible.length === 1 ? "faktura" : "fakturaer"} på nytt?</AlertDialogTitle>
            <AlertDialogDescription>
              Fakturaene uten linjer legges tilbake i den vanlige lesekøen og leses av AI-tjenesten igjen (det koster litt per faktura).
              {noLines.length - eligible.length > 0 && ` ${noLines.length - eligible.length} kan ikke leses på nytt herfra (ikke fra Tripletex eller leses allerede).`}
              {withLines.length > 0 && ` ${withLines.length} har allerede linjer og sendes ikke hit – de leses på nytt med forslag i gruppen under.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Avbryt</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void run(); }}>Les på nytt</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
