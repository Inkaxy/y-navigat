import { useRef, useState } from "react";
import { Loader2, Square } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useCompany } from "@/hooks/useCompany";
import { osloTodayISO } from "@/lib/osloDate";
import { decideApply, fetchRereadRun, type ApplyCall } from "@/fakturaer/hooks/useInvoiceReread";
import { clearPending, savePending } from "@/fakturaer/lib/reread";
import { invalidateInvoice, invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import type { SuggestionRow } from "@/ravarer/hooks/useSamletGjenlesing";
import { autoInputFromRun, decideAuto } from "@/ravarer/lib/samletGjenlesing/rule";
import { bulkApplyReason } from "@/ravarer/lib/samletGjenlesing/runState";
import { applyAllMessage, classifyForApplyAll, selectForApplyAll, summarizeApplyAll, type ApplyAllItem, type ApplyAllTally } from "@/ravarer/lib/samletGjenlesing/applyAll";

const n = (v: number) => v.toLocaleString("nb-NO");
const dateLabel = () => { const [y, m, d] = osloTodayISO().split("-"); return `${d}.${m}.${y}`; };
const CHUNK = 20;


/** Henter alle ventende forslag, vurderer dem med samme regel som «Bruk», og sender dem ett og ett. */
async function loadItems(rows: SuggestionRow[]): Promise<ApplyAllItem[]> {
  const byId = new Map<string, { status: string; snapshot: unknown; proposal: unknown }>();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const ids = rows.slice(i, i + CHUNK).map((r) => r.runId);
    const { data, error } = await supabase.from("invoice_reread_runs").select("id, status, snapshot, proposal").in("id", ids);
    if (error) throw new Error("Kunne ikke hente forslagene. Prøv igjen.");
    for (const x of data ?? []) byId.set(x.id, x);
  }
  return rows.map((row) => {
    const run = byId.get(row.runId);
    const input = run && run.status === "ready" ? autoInputFromRun(run.snapshot, run.proposal) : null;
    return { runId: row.runId, invoiceId: row.invoiceId, ...classifyForApplyAll(input ? decideAuto(input) : null) };
  });
}

export function ApplyAllDialog({ rows, open, onOpenChange, onDone }: {
  rows: SuggestionRow[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: (m: { ok: boolean; text: string }) => void;
}) {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  // Ferskt grunnlag hver gang vinduet åpnes; ingenting skrives før et valg trykkes.
  const q = useQuery({
    queryKey: ["samlet-gjenlesing", "bruk-alle", company?.id ?? null, rows.map((r) => r.runId).join(",")],
    enabled: open && rows.length > 0,
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false,
    queryFn: () => loadItems(rows),
  });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const lock = useRef(false);
  const stop = useRef(false);
  const currentLe = useRef<string | null>(null);
  currentLe.current = company?.id ?? null;
  const busy = progress != null;

  const run = async (items: ApplyAllItem[], includeMismatch: boolean) => {
    if (lock.current) return;
    const le = company?.id ?? null;
    const chosen = selectForApplyAll(items, includeMismatch);
    if (!le || chosen.length === 0) return;
    lock.current = true; stop.current = false;
    const reason = bulkApplyReason(dateLabel());
    const t: ApplyAllTally = { applied: 0, rejected: 0, alreadyUsed: 0, unknown: 0, notStarted: 0 };
    const touched: string[] = [];
    for (let i = 0; i < chosen.length; i++) {
      // Firmabytte eller «Stopp»: resten sendes ikke. Ukjent utfall stopper også – ingen blind fortsettelse.
      if (stop.current || currentLe.current !== le || t.unknown > 0) { t.notStarted = chosen.length - i; break; }
      setProgress({ done: i, total: chosen.length });
      const it = chosen[i];
      const req = { runId: it.runId, operations: it.operations, reason };
      savePending(req);
      let call: ApplyCall;
      try {
        const { data, error } = await supabase.rpc("rm_apply_invoice_reread", { p_run_id: req.runId, p_operations: JSON.parse(JSON.stringify(it.operations)) as Json, p_reason: reason });
        call = { data, error };
      } catch (e) { console.error("[forslag-bruk-alle]", e); call = { thrown: e }; }
      const out = await decideApply(call, req, it.invoiceId, fetchRereadRun, { clear: clearPending });
      touched.push(it.invoiceId);
      if (out.kind === "applied") t.applied++;
      else if (out.kind === "rejected") t.rejected++;
      else if (out.kind === "already_used") t.alreadyUsed++;
      else t.unknown++;
    }
    lock.current = false; setProgress(null);
    void qc.invalidateQueries({ queryKey: ["samlet-gjenlesing"] });
    void qc.invalidateQueries({ queryKey: ["ravarer", "fra-faktura"] });
    for (const id of touched) invalidateInvoice(qc, id);
    invalidateRavarerCounts(qc);
    onDone(applyAllMessage(t));
    onOpenChange(false);
  };

  const items = !busy && !q.isFetching && q.data ? q.data : null;
  const s = items ? summarizeApplyAll(items) : null;
  const both = s ? s.stemmer + s.stemmer_ikke : 0;

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Bruke alle forslagene?</AlertDialogTitle>
          <AlertDialogDescription>
            Hvert forslag vurderes som om du trykket «Bruk» på det. Manuelle koblinger, godtatte priser, «ikke vare», holdt utenfor og rettede linjer røres ikke.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!busy && q.isFetching && <p className="flex items-center gap-2 text-body"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Går gjennom {n(rows.length)} forslag …</p>}
        {!busy && q.isError && !q.isFetching && (
          <div role="alert" className="text-body">
            <p className="text-destructive">{q.error instanceof Error ? q.error.message : "Kunne ikke hente forslagene."}</p>
            <Button variant="outline" className="mt-2 min-h-[44px]" onClick={() => void q.refetch()}>Prøv igjen</Button>
          </div>
        )}
        {s && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-body">
            <dt className="font-semibold">Summen stemmer etterpå</dt><dd className="text-right font-semibold tabular-nums">{n(s.stemmer)}</dd>
            <dt>Kan brukes, men summen stemmer fortsatt ikke</dt><dd className="text-right tabular-nums">{n(s.stemmer_ikke)}</dd>
            <dt>Ingenting kan brukes uten egne valg</dt><dd className="text-right tabular-nums">{n(s.ingenting)}</dd>
            {s.utilgjengelig > 0 && <><dt>Ikke klare lenger eller kunne ikke tolkes</dt><dd className="text-right tabular-nums">{n(s.utilgjengelig)}</dd></>}
          </dl>
        )}
        {s && <p className="text-caption text-ink-secondary">Forslag som ikke brukes, blir liggende. Hvert forslag lagres i revisjonsloggen som «brukt via Bruk alle».</p>}
        {progress && (
          <div aria-live="polite" className="text-body">
            <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Bruker <span className="tabular-nums">{n(progress.done + 1)} av {n(progress.total)}</span> …</p>
            <Button variant="outline" className="mt-2 min-h-[44px]" onClick={() => { stop.current = true; }}><Square className="mr-1.5 h-4 w-4" aria-hidden />Stopp etter denne</Button>
          </div>
        )}
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel disabled={busy}>Avbryt</AlertDialogCancel>
          {items && s && s.stemmer_ikke > 0 && (
            <Button variant="outline" className="min-h-[44px]" onClick={() => void run(items, true)}>Bruk alle {n(both)}</Button>
          )}
          {items && s && (
            <Button className="min-h-[44px]" disabled={s.stemmer === 0} onClick={() => void run(items, false)}>Bruk {n(s.stemmer)} der summen stemmer</Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
