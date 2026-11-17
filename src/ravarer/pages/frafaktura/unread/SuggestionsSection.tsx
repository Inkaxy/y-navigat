import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuthUserId } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { osloTodayISO } from "@/lib/osloDate";
import { decideApply, fetchRereadRun, type ApplyCall } from "@/fakturaer/hooks/useInvoiceReread";
import { clearPending, savePending, type Operation } from "@/fakturaer/lib/reread";
import { invalidateInvoice, invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import { paths } from "@/ravarer/lib/paths";
import { dateNo } from "@/ravarer/lib/decisions";
import { useRereadSuggestions, useSamletRunner, type SuggestionRow } from "@/ravarer/hooks/useSamletGjenlesing";
import { autoInputFromRun, decideAuto, type AutoDecision } from "@/ravarer/lib/samletGjenlesing/rule";
import { manualApplyReason } from "@/ravarer/lib/samletGjenlesing/runState";
import { ApplyAllDialog } from "./ApplyAllDialog";

const kr = (v: number | null) => (v == null ? "–" : `${Number(v).toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`);
const time = (iso: string) => new Date(iso).toLocaleString("nb-NO", { timeZone: "Europe/Oslo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dateLabel = () => { const [y, m, d] = osloTodayISO().split("-"); return `${d}.${m}.${y}`; };

type Review = { row: SuggestionRow; decision: AutoDecision | null; error: string | null; loading: boolean };

/** «Forslag venter på deg»: lesinger som ikke ble brukt automatisk. «Bruk» tar i bruk bare det regelen tillater. */
export function SuggestionsSection({ names, canWrite, retur }: { names: Map<string, string>; canWrite: boolean; retur: string }) {
  const q = useRereadSuggestions(true);
  const r = useSamletRunner();
  const qc = useQueryClient();
  const uid = useAuthUserId();
  const { data: company } = useCompany();
  const [review, setReview] = useState<Review | null>(null);
  const [discard, setDiscard] = useState<SuggestionRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyAll, setApplyAll] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const lock = useRef(false);
  const rows = q.data ?? [];
  if (q.isLoading || (!q.isError && rows.length === 0)) return null;

  const noteFor = (row: SuggestionRow) => r.state?.items.find((i) => i.runId === row.runId)?.note ?? null;
  const refresh = (invoiceId: string) => {
    void qc.invalidateQueries({ queryKey: ["samlet-gjenlesing"] });
    void qc.invalidateQueries({ queryKey: ["ravarer", "fra-faktura"] });
    invalidateInvoice(qc, invoiceId);
    invalidateRavarerCounts(qc);
  };

  const openReview = async (row: SuggestionRow) => {
    setMsg(null);
    setReview({ row, decision: null, error: null, loading: true });
    const { data, error } = await supabase.from("invoice_reread_runs").select("status, snapshot, proposal").eq("id", row.runId).maybeSingle();
    if (error || !data) return setReview({ row, decision: null, error: "Kunne ikke hente forslaget. Prøv igjen.", loading: false });
    if (data.status !== "ready") return setReview({ row, decision: null, error: "Forslaget er ikke lenger klart (brukt, forkastet eller utløpt).", loading: false });
    const input = autoInputFromRun(data.snapshot, data.proposal);
    setReview({ row, decision: input ? decideAuto(input) : null, error: input ? null : "Forslaget kunne ikke tolkes. Åpne det for å se detaljene.", loading: false });
  };

  const opsOf = (d: AutoDecision | null): Operation[] => (d && (d.kind === "bruk" || d.kind === "forslag") ? d.operations : []);

  const apply = async () => {
    const rv = review;
    if (!rv || lock.current || !canWrite) return;
    const ops = opsOf(rv.decision);
    if (ops.length === 0) return;
    lock.current = true; setBusy(true);
    const req = { runId: rv.row.runId, operations: ops, reason: manualApplyReason(dateLabel()) };
    savePending(req);
    let call: ApplyCall;
    try {
      const { data, error } = await supabase.rpc("rm_apply_invoice_reread", { p_run_id: req.runId, p_operations: JSON.parse(JSON.stringify(ops)) as Json, p_reason: req.reason });
      call = { data, error };
    } catch (e) { console.error("[forslag-bruk]", e); call = { thrown: e }; }
    const out = await decideApply(call, req, rv.row.invoiceId, fetchRereadRun, { clear: clearPending });
    lock.current = false; setBusy(false); setReview(null);
    setMsg(out.kind === "applied" ? { ok: true, text: "Ny lesing er tatt i bruk. Fakturaen beregnes på nytt." }
      : out.kind === "rejected" ? { ok: false, text: "Forslaget kunne ikke brukes. Åpne forslaget for å se hvorfor." }
      : out.kind === "already_used" ? { ok: false, text: "Forslaget var allerede tatt i bruk med andre valg." }
      : { ok: false, text: "Utfallet er ukjent. Åpne forslaget og kontroller før du prøver igjen." });
    refresh(rv.row.invoiceId);
  };

  const doDiscard = async () => {
    const row = discard;
    if (!row || lock.current || !canWrite) return;
    lock.current = true; setBusy(true);
    try {
      const { error } = await supabase.rpc("rm_cancel_invoice_reread", { p_run_id: row.runId });
      setMsg(error ? { ok: false, text: "Kunne ikke forkaste forslaget. Prøv igjen." } : { ok: true, text: "Forslaget er forkastet. Fakturaen er som før." });
      if (!error && uid && company) {
        void Promise.resolve(supabase.from("audit_log").insert({
          user_id: uid, legal_entity_id: company.id, action: "invoice.bulk_reread_discarded", entity_type: "invoice", entity_id: row.invoiceId,
          source_app: "ravarer", reason: `Samlet gjenlesing ${dateLabel()}: forslag forkastet`, changes: { reread_run_id: row.runId },
        })).then(({ error: e }) => { if (e) console.error("[forslag-forkast] logg", e.code); }, (e: unknown) => console.error("[forslag-forkast] logg", e));
      }
    } catch (e) {
      console.error("[forslag-forkast]", e);
      setMsg({ ok: false, text: "Utfallet er ukjent. Se listen før du prøver igjen." });
    } finally { lock.current = false; setBusy(false); setDiscard(null); refresh(row.invoiceId); }
  };

  const d = review?.decision ?? null;
  const ops = opsOf(d);
  const updates = ops.filter((o) => o.kind === "update").length;
  const adds = ops.length - updates;
  const afterOk = d && (d.kind === "bruk" || d.kind === "forslag") ? d.after.lines_sum_status === "ok" : null;

  return (
    <section id="ff-forslag" aria-labelledby="ff-forslag-h" className="mt-3 border-t border-line-subtle">
      <div className="px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 id="ff-forslag-h" className="text-body font-semibold">Forslag venter på deg <span className="tabular-nums text-ink-secondary">{rows.length.toLocaleString("nb-NO")}</span></h3>
            <p className="text-caption text-ink-secondary">Ny lesing som ikke ble brukt automatisk. Et forslag utløper 24 timer etter at det ble lest.</p>
          </div>
          {canWrite && rows.length > 0 && <Button className="min-h-[44px]" disabled={busy} onClick={() => { setMsg(null); setApplyAll(true); }}>Bruk alle …</Button>}
        </div>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "mt-2 text-sm" : "mt-2 text-sm text-destructive"}>{msg.text}</p>}
        {q.isError && <p role="alert" className="mt-2 text-sm text-destructive">Kunne ikke hente forslagene. <button className="underline" onClick={() => void q.refetch()}>Prøv igjen</button></p>}
      </div>
      <ul aria-label="Forslag venter på deg">
        {rows.map((row) => (
          <li key={row.runId} className="grid gap-2 border-t border-line-subtle px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_8rem_minmax(0,1.6fr)_auto] md:items-center md:px-5">
            <p><strong>{names.get(row.supplierId ?? "") ?? "Ukjent leverandør"}</strong> <span className="text-ink-secondary">· {row.invoiceNumber ?? "uten nummer"} · {dateNo(row.invoiceDate)}</span></p>
            <p className="tabular-nums md:text-right">{kr(row.totalAmount)}</p>
            <p className="text-sm text-ink-secondary">{noteFor(row) ?? "Åpne forslaget for å se hva som er nytt."} <span className="whitespace-nowrap">Utløper {time(row.expiresAt)}.</span></p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="min-h-[44px]"><Link to={paths.lesPaNytt(row.invoiceId, { kjoring: row.runId, retur })}>Se forslaget</Link></Button>
              {canWrite && <Button className="min-h-[44px]" disabled={busy} onClick={() => void openReview(row)}>Bruk</Button>}
              {canWrite && <Button variant="ghost" className="min-h-[44px]" disabled={busy} onClick={() => setDiscard(row)}>Forkast</Button>}
            </div>
          </li>
        ))}
      </ul>

      <AlertDialog open={!!review} onOpenChange={(o) => !busy && !o && setReview(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bruke forslaget?</AlertDialogTitle>
            <AlertDialogDescription>Manuelle koblinger, godtatte priser, «ikke vare», holdt utenfor og rettede linjer røres ikke.</AlertDialogDescription>
          </AlertDialogHeader>
          {review?.loading && <p className="flex items-center gap-2 text-body"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Henter forslaget …</p>}
          {review?.error && <p role="alert" className="text-body text-destructive">{review.error}</p>}
          {d && (
            <div className="space-y-2 text-body">
              {ops.length === 0 ? <p>Ingenting i forslaget kan brukes uten egne valg. Åpne forslaget for å gå gjennom linjene.</p> : (
                <p>{updates > 0 && `${updates} ${updates === 1 ? "linje rettes" : "linjer rettes"}`}{updates > 0 && adds > 0 && " og "}{adds > 0 && `${adds} ${adds === 1 ? "ny linje legges til" : "nye linjer legges til"}`}. Summen {afterOk ? "stemmer" : "stemmer fortsatt ikke"} etterpå.</p>
              )}
              {d.kind === "forslag" && d.reasons.length > 0 && <ul className="list-disc pl-4 text-caption text-ink-secondary">{d.reasons.map((x, i) => <li key={i}>{x.text}</li>)}</ul>}
              {(d.kind === "bruk" || d.kind === "forslag") && d.unmatchedOld > 0 && <p className="text-caption text-ink-secondary">{d.unmatchedOld} eksisterende {d.unmatchedOld === 1 ? "linje" : "linjer"} uten motstykke blir stående.</p>}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Avbryt</AlertDialogCancel>
            {review && <Button asChild variant="outline"><Link to={paths.lesPaNytt(review.row.invoiceId, { kjoring: review.row.runId, retur })}>Se forslaget</Link></Button>}
            <AlertDialogAction disabled={busy || ops.length === 0} onClick={(e) => { e.preventDefault(); void apply(); }}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}Bruk</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canWrite && <ApplyAllDialog rows={rows} open={applyAll} onOpenChange={setApplyAll} onDone={setMsg} />}

      <AlertDialog open={!!discard} onOpenChange={(o) => !busy && !o && setDiscard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Forkaste forslaget?</AlertDialogTitle>
            <AlertDialogDescription>Fakturaen blir som den er nå. Du kan lese den på nytt senere.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Avbryt</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void doDiscard(); }}>Forkast</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
