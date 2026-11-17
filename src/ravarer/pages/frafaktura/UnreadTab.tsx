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
import { canRequeue, requeueSkipText, unreadReason } from "@/ravarer/lib/fraFaktura/unread";

const kr = (v: number | null) => (v == null ? "–" : `${Number(v).toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`);

/** Ikke lest (D4): fakturaer lesingen feilet på. «Les alle på nytt» legger dem i den vanlige lesekøen etter bekreftelse. */
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
  const eligible = list.filter(canRequeue);

  const run = async () => {
    if (lock.current || !company || eligible.length === 0) return;
    lock.current = true; setBusy(true); setResult(null);
    try {
      let requeued = 0; const skipped: string[] = [];
      for (let i = 0; i < eligible.length; i += 200) {
        const { data, error } = await supabase.rpc("rm_requeue_invoice_line_extraction", { p_legal_entity_id: company.id, p_invoice_ids: eligible.slice(i, i + 200).map((x) => x.id) });
        if (error) throw new Error(error.code === "42501" ? "Du har ikke skrivetilgang til fakturaer." : "Utfallet er ukjent. Se listen etter en stund før du prøver igjen.");
        const r = parseRequeueResult(data);
        if (!r) throw new Error("Utfallet er ukjent. Se listen etter en stund før du prøver igjen.");
        requeued += r.requeued; skipped.push(...r.skipped.map((s) => requeueSkipText(s.reason)));
      }
      const why = [...new Set(skipped)];
      setResult({ ok: true, text: `${requeued} ${requeued === 1 ? "faktura er" : "fakturaer er"} lagt i lesekøen.${skipped.length ? ` ${skipped.length} hoppet over (${why.join(", ")}).` : ""}` });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Utfallet er ukjent." });
    } finally {
      lock.current = false; setBusy(false); setConfirm(false);
      void qc.invalidateQueries({ queryKey: ["ravarer", "fra-faktura", "unread"] });
    }
  };

  return (
    <section aria-labelledby="ff-ul" className="overflow-hidden rounded-2xl border border-line-subtle bg-card">
      <div className="flex flex-wrap items-start gap-3 px-4 py-4 md:px-5">
        <div className="min-w-0 flex-1">
          <h2 id="ff-ul" className="font-serif text-title">Fakturaer som ikke ble lest</h2>
          <p className="text-body text-ink-secondary">Systemet prøver selv på nytt. Du trenger bare å se her hvis en faktura blir liggende.</p>
        </div>
        {canWrite && (
          <Button className="min-h-[44px]" disabled={eligible.length === 0 || busy} onClick={() => setConfirm(true)}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}Les alle på nytt
          </Button>
        )}
      </div>
      {result && <p role={result.ok ? "status" : "alert"} className={result.ok ? "px-5 pb-3 text-sm" : "px-5 pb-3 text-sm text-destructive"}>{result.text}</p>}
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} scope="ravarer:fra-faktura:ikke-lest" onRetry={() => void q.refetch()}>
        {list.length === 0 ? <p className="border-t border-line-subtle px-5 py-8 text-center text-body text-ink-secondary">Alle fakturaer er lest.</p> : (
          <ul aria-label="Fakturaer som ikke ble lest">
            {list.map((i) => (
              <li key={i.id} className="grid gap-2 border-t border-line-subtle px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_8rem_minmax(0,1.6fr)_auto] md:items-center md:px-5">
                <p><strong>{names.get(i.supplier_id ?? "") ?? "Ukjent leverandør"}</strong> <span className="text-ink-secondary">· {i.invoice_number ?? "uten nummer"} · {dateNo(i.invoice_date)}</span></p>
                <p className="tabular-nums md:text-right">{kr(i.total_amount)}</p>
                <p className="text-sm text-ink-secondary">{unreadReason(i)}</p>
                <Button asChild variant="outline" className="min-h-[44px]"><Link to={paths.faktura(i.id, { retur })}>Åpne PDF</Link></Button>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      <AlertDialog open={confirm} onOpenChange={(o) => !busy && setConfirm(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Les {eligible.length} {eligible.length === 1 ? "faktura" : "fakturaer"} på nytt?</AlertDialogTitle>
            <AlertDialogDescription>
              Fakturaene legges tilbake i den vanlige lesekøen og leses av AI-tjenesten igjen (det koster litt per faktura). Fakturaer med linjer som er rettet,
              godkjent eller har ført kost hoppes over av serveren. {list.length - eligible.length > 0 && `${list.length - eligible.length} kan ikke leses på nytt herfra (ikke fra Tripletex eller leses allerede).`}
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
