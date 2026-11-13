import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { recheckInvoiceLinesSum } from "@/fakturaer/lib/linesSum";
import { classifyStep, parseRequeueResult, runSequential, type BulkGroup, type SequentialProgress, type StepOutcome } from "@/fakturaer/lib/bulkReread";
import type { BulkInvoice } from "@/fakturaer/hooks/useBulkRereadGroups";

export interface StepResult { invoice: BulkInvoice; outcome: StepOutcome; runId: string | null; note: string | null }
export type RunState =
  | { phase: "idle" }
  | { phase: "running"; group: BulkGroup; progress: SequentialProgress }
  | { phase: "done"; group: BulkGroup; progress: SequentialProgress; message: string };

/** Ikke-typet RPC (PENDING-SQL 20261113_line_extraction_release_requeue). 404 = ikke kjørt ennå. */
async function callRequeue(legalEntityId: string, ids: string[]): Promise<{ requeued: number; skipped: { invoice_id: string; reason: string }[] } | "mangler" | null> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Du må være innlogget.");
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/rm_requeue_invoice_line_extraction`, {
    method: "POST",
    headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_legal_entity_id: legalEntityId, p_invoice_ids: ids }),
  });
  if (res.status === 404) return "mangler";
  if (res.status === 401 || res.status === 403) throw new Error("Du har ikke skrivetilgang til fakturaer.");
  if (!res.ok) return null;
  return parseRequeueResult(await res.json().catch(() => null));
}

function parseBegin(d: unknown): { ok: boolean; code: string | null; runId: string | null } {
  if (d && typeof d === "object" && !Array.isArray(d)) {
    const o = d as Record<string, unknown>;
    if (o.ok === true && typeof o.run_id === "string") return { ok: true, code: null, runId: o.run_id };
    if (typeof o.code === "string") return { ok: false, code: o.code, runId: null };
  }
  return { ok: false, code: "ukjent", runId: null };
}

/**
 * Kjører én gruppe for frosset selskap. Én kjøring om gangen (synkron lås), stopp etter pågående steg.
 * Gruppe 2 gir bare forslag; ingenting tas i bruk her.
 */
export function useBulkRereadRun(legalEntityId: string | null) {
  const qc = useQueryClient();
  const lock = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const [state, setState] = useState<RunState>({ phase: "idle" });
  const [results, setResults] = useState<StepResult[]>([]);

  const start = useCallback(async (group: BulkGroup, invoices: readonly BulkInvoice[]) => {
    if (lock.current || !legalEntityId || invoices.length === 0) return;
    lock.current = true;
    const le = legalEntityId;
    const ac = new AbortController();
    abort.current = ac;
    setResults([]);
    setState({ phase: "running", group, progress: { done: 0, total: invoices.length, stopped: null } });
    try {
      if (group === "uten_linjer") {
        let requeued = 0; const skipped: { invoice_id: string; reason: string }[] = [];
        for (let i = 0; i < invoices.length; i += 200) {
          const r = await callRequeue(le, invoices.slice(i, i + 200).map((x) => x.id));
          if (r === "mangler") { setState({ phase: "done", group, progress: { done: 0, total: invoices.length, stopped: null }, message: "Databaseendringen for dette steget er ikke kjørt ennå. Ingenting er endret." }); return; }
          if (!r) { setState({ phase: "done", group, progress: { done: i, total: invoices.length, stopped: null }, message: "Ukjent svar fra serveren. Last siden på nytt og kontroller antallet før du prøver igjen." }); return; }
          requeued += r.requeued; skipped.push(...r.skipped);
        }
        setState({ phase: "done", group, progress: { done: invoices.length, total: invoices.length, stopped: null },
          message: `${requeued.toLocaleString("nb-NO")} faktura(er) lagt i lesekøen. ${skipped.length ? `${skipped.length} hoppet over (har linjer, rettelser, godkjenning eller leses nå). ` : ""}De leses av den vanlige køen de neste minuttene.` });
        return;
      }
      const step = async (inv: BulkInvoice): Promise<StepOutcome> => {
        if (group === "ikke_kontrollert") {
          try {
            const r = await recheckInvoiceLinesSum(inv.id);
            setResults((p) => [...p, { invoice: inv, outcome: r ? "forslag" : "hoppet_over", runId: null, note: r?.lines_sum_status ?? null }]);
            return r ? "forslag" : "hoppet_over";
          } catch (e) {
            setResults((p) => [...p, { invoice: inv, outcome: "feilet", runId: null, note: e instanceof Error ? e.message : null }]);
            return "feilet";
          }
        }
        const { data, error } = await supabase.rpc("rm_begin_invoice_reread", { p_invoice_id: inv.id });
        const begin = error ? { ok: false, code: "feilet", runId: null } : parseBegin(data);
        let preview: { code: string | null } | null = null;
        if (begin.ok && begin.runId) {
          try {
            const r = await supabase.functions.invoke("reread-invoice-preview", { body: { run_id: begin.runId } });
            const code = r.data && typeof r.data === "object" && "code" in r.data && typeof r.data.code === "string" ? r.data.code : null;
            preview = { code: r.error ? code ?? "ukjent_utfall" : code };
          } catch { preview = null; }
        }
        const outcome = classifyStep(begin, preview);
        setResults((p) => [...p, { invoice: inv, outcome, runId: begin.runId, note: begin.ok ? preview?.code ?? null : begin.code }]);
        return outcome;
      };
      const progress = await runSequential(invoices, step, { signal: ac.signal, onStep: (_i, _o, p) => setState({ phase: "running", group, progress: p }) });
      const msg = progress.stopped === "ai_feil" ? "Stoppet: AI-tjenesten feilet. Resten er ikke startet."
        : progress.stopped === "avbrutt" ? "Stoppet etter pågående steg." : "Ferdig.";
      setState({ phase: "done", group, progress, message: msg });
    } finally {
      lock.current = false;
      abort.current = null;
      void qc.invalidateQueries({ queryKey: ["bulk-reread-groups"] });
      void qc.invalidateQueries({ queryKey: ["invoice-reading-health"] });
    }
  }, [legalEntityId, qc]);

  const stop = useCallback(() => abort.current?.abort(), []);
  return { state, results, start, stop, running: state.phase === "running" };
}
