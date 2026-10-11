import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/common/QueryState";
import { useAuth } from "@/hooks/useAuth";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { useInvoiceDocumentUrl } from "@/fakturaer/hooks/useInvoiceDocument";
import { PdfDocumentViewer } from "@/fakturaer/components/PdfDocumentViewer";
import { RereadView, ReadingState } from "@/fakturaer/components/reread/RereadView";
import { useApplyReread, useBeginReread, useCancelReread, useInvokeRereadPreview, useRereadRun } from "@/fakturaer/hooks/useInvoiceReread";
import { loadPending, persistedApply, rereadErrorText, type Operation } from "@/fakturaer/lib/reread";
import { paths } from "@/ravarer/lib/paths";

const when = (iso: string) => format(new Date(iso), "EEE d. MMM yyyy, HH:mm", { locale: nb });
const invokedKey = (id: string) => `nbhub.reread.invoked.${id}`;

/** «Les originalen på nytt» for en faktura som allerede har linjer. Kjøringen ligger i adressen (?kjoring=). */
export default function LesPaNytt() {
  const { id = "" } = useParams();
  const [sp, setSp] = useSearchParams();
  const runId = sp.get("kjoring");
  const { user } = useAuth();
  const { canWrite } = useInvoiceRights();
  const inv = useQuery({
    queryKey: ["invoice-reread-head", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices").select("id, invoice_number, source_document_url, status, suppliers(name)").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const open = useQuery({
    queryKey: ["invoice-reread-open", id, user?.id],
    enabled: !runId && !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("invoice_reread_runs").select("id, status, created_at").eq("invoice_id", id).eq("created_by", user!.id)
        .in("status", ["reading", "ready"]).order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
  const run = useRereadRun(runId);
  const begin = useBeginReread();
  const invoke = useInvokeRereadPreview();
  const cancel = useCancelReread();
  const apply = useApplyReread(id);
  const [msg, setMsg] = useState<string | null>(null);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [pendingTick, setPendingTick] = useState(0);
  const doc = useInvoiceDocumentUrl(run.data?.document_path ?? inv.data?.source_document_url ?? null);
  const back = paths.faktura(id);

  const setRun = (rid: string | null) => { const n = new URLSearchParams(sp); if (rid) n.set("kjoring", rid); else n.delete("kjoring"); setSp(n, { replace: false }); };

  const start = async () => {
    setMsg(null);
    try {
      const r = await begin.mutateAsync(id);
      if (!r.ok) { setMsg(rereadErrorText(r.code)); return; }
      setRun(r.run_id);
      sessionStorage.setItem(invokedKey(r.run_id), "1");
      invoke.mutate(r.run_id);
    } catch (e) {
      console.error("[reread-begin]", e);
      setMsg(rereadErrorText(e instanceof Error ? e.message : null));
    }
  };
  const runInvoke = () => { if (!runId) return; sessionStorage.setItem(invokedKey(runId), "1"); invoke.mutate(runId); };

  const r = run.data;
  const isOwner = !!r && !!user && r.created_by === user.id;
  const pending = r ? (void pendingTick, loadPending(r.id)) : null;
  const doApply = (ops: Operation[], reason: string) => {
    if (!r) return;
    setApplyMsg(null);
    apply.mutate({ runId: r.id, operations: ops, reason }, {
      onSuccess: (o) => { setPendingTick((n) => n + 1); if (o.kind === "rejected") setApplyMsg(rereadErrorText(o.message)); },
      onError: () => setPendingTick((n) => n + 1),
    });
  };
  const retryPending = () => { if (pending) doApply(pending.operations, pending.reason); };

  const document = doc.url && r
    ? <PdfDocumentViewer url={doc.url} cacheKey={r.document_path} title="Originalfaktura" fallback={<a className="underline" href={doc.url} target="_blank" rel="noreferrer">Åpne originalen</a>} />
    : <p className="p-4 text-sm text-ink-secondary">{doc.isLoading ? "Henter originalen …" : "Originalen kan ikke vises."}</p>;

  const title = inv.data ? `${inv.data.suppliers?.name ?? "Ukjent leverandør"} · Faktura ${inv.data.invoice_number ?? ""}` : "Faktura";

  return (
    <div className="space-y-4 px-page py-4">
      <header className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5"><Link to={back}><ArrowLeft className="h-4 w-4" aria-hidden />Tilbake til fakturaen</Link></Button>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="font-serif text-xl">Les originalen på nytt</h1>
            <p className="text-caption text-ink-secondary">{title}{r ? ` · startet ${when(r.created_at)}` : ""}</p>
          </div>
          {r && (r.status === "ready" || r.status === "reading") && isOwner && (
            <Button variant="outline" size="sm" disabled={cancel.isPending || apply.isPending} onClick={() => cancel.mutate(r.id)}>Avbryt lesingen</Button>
          )}
        </div>
      </header>

      {!runId && (
        <QueryState scope="reread-faktura" isLoading={inv.isLoading} isError={inv.isError} error={inv.error} onRetry={() => void inv.refetch()} isEmpty={!inv.data} emptyTitle="Fant ikke fakturaen.">
          <div className="mx-auto max-w-xl space-y-3 rounded-lg border border-border p-5 text-sm">
            <p>Leser den lagrede originalen på nytt og viser gammel og ny verdi linje for linje. Ingenting endres før du velger linjer, bekrefter og tar dem i bruk. Fakturahode, kreditnota og mva endres aldri her.</p>
            {open.data && <p>Du har en påbegynt lesing fra {when(open.data.created_at)}. <button type="button" className="underline" onClick={() => setRun(open.data!.id)}>Fortsett den</button></p>}
            {!canWrite && <p role="note">Du har ikke skrivetilgang til fakturaer.</p>}
            {msg && <p role="alert" className="text-destructive">{msg}</p>}
            <Button disabled={!canWrite || begin.isPending || !inv.data?.source_document_url} onClick={start}>Start ny lesing</Button>
          </div>
        </QueryState>
      )}

      {runId && (
        <QueryState scope="reread-kjoring" isLoading={run.isLoading} isError={run.isError} error={run.error} onRetry={() => void run.refetch()} isEmpty={!r} emptyTitle="Fant ikke lesingen." emptyDescription="Den kan tilhøre et annet selskap, eller adressen er feil.">
          {r && r.invoice_id !== id && <p role="alert" className="text-destructive">Lesingen gjelder en annen faktura.</p>}
          {r && r.invoice_id === id && r.status === "reading" && (
            <ReadingState startedAt={r.created_at} invoked={sessionStorage.getItem(invokedKey(r.id)) === "1"} invoking={invoke.isPending}
              invokeCode={invoke.data?.code ?? null} canAct={isOwner && canWrite} busy={cancel.isPending}
              onInvoke={runInvoke} onRefresh={() => void run.refetch()} onCancel={() => cancel.mutate(r.id)} />
          )}
          {r && r.invoice_id === id && (r.status === "failed" || r.status === "cancelled") && (
            <div className="mx-auto max-w-xl space-y-3 rounded-lg border border-border p-5 text-sm" role="status">
              <p className="font-medium">{r.status === "cancelled" ? "Lesingen er avbrutt" : "Lesingen feilet"}</p>
              {r.status === "failed" && <p>{rereadErrorText(r.error_code)}</p>}
              <p className="text-ink-secondary">Ingenting på fakturaen er endret. Originalen er beholdt.</p>
              <Button size="sm" disabled={!canWrite || begin.isPending} onClick={() => { setRun(null); void start(); }}>Start ny lesing</Button>
            </div>
          )}
          {r && r.invoice_id === id && r.status === "applied" && (
            <div className="mx-auto max-w-xl space-y-2 rounded-lg border border-border p-5 text-sm" role="status">
              <p className="font-medium">Tatt i bruk: {r.result?.applied_count ?? 0} valg</p>
              {pending && persistedApply(r, pending) === "differs" && (
                <p role="alert" className="text-warning">Forslaget var allerede tatt i bruk med andre valg. Dine {pending.operations.length} valg ble ikke lagret; de er tatt vare på i denne økten.</p>
              )}
              <p>{r.result?.operations.filter((o) => o.kind === "update").length ?? 0} linjer rettet, {r.result?.operations.filter((o) => o.kind === "add").length ?? 0} lagt til. Kobling og prisvurdering beregnes på nytt i kø.</p>
              {r.result?.lines_sum_status === "mismatch" && <p className="text-warning">Summen stemmer fortsatt ikke med fakturaen.</p>}
              <p className="text-ink-secondary">Eventuelle gamle lesevarsler står igjen til de kontrolleres.</p>
              <Button asChild size="sm"><Link to={back}>Tilbake til fakturaen</Link></Button>
            </div>
          )}
          {r && r.invoice_id === id && r.status === "ready" && (
            <RereadView run={r} document={document} canApply={isOwner && canWrite} pending={pending} saving={apply.isPending}
              readOnlyReason={!isOwner ? "Lesingen ble startet av en annen bruker. Du kan se den, men ikke ta den i bruk." : !canWrite ? "Du har ikke skrivetilgang." : null}
              applyMessage={applyMsg ?? (apply.data?.kind === "unknown" ? "Vi vet ikke om lagringen kom fram." : apply.data?.kind === "already_used" ? rereadErrorText("allerede_brukt_med_andre_valg") : null)} onApply={doApply} onRetryPending={retryPending} />
          )}
        </QueryState>
      )}
    </div>
  );
}
